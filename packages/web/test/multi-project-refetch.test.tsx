import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// GraphCanvas, Inspector, StatusBar, and Rail each dynamic-import or render
// libraries (cytoscape, eventsource polyfills) that don't run cleanly under
// jsdom. We stub them with project-aware fetchers so the test still observes
// each consumer's "did I re-fetch when project changed?" behavior — which is
// the actual contract under test (ADR-057 §3), not their internal rendering.
vi.mock('../app/components/GraphCanvas', () => ({
  GraphCanvas: ({ project }: { project: string }) => {
    fetch(`/api/graph?project=${encodeURIComponent(project)}`)
    return <div data-testid="graph-canvas" data-project={project} />
  },
}))
vi.mock('../app/components/Inspector', () => ({
  Inspector: ({ project }: { project: string }) => {
    fetch(`/api/graph/node/test?project=${encodeURIComponent(project)}`)
    return <div data-testid="inspector" data-project={project} />
  },
}))
vi.mock('../app/components/StatusBar', () => ({
  StatusBar: ({ project }: { project: string }) => {
    fetch(`/api/stale-events?project=${encodeURIComponent(project)}`)
    return <div data-testid="statusbar" data-project={project} />
  },
}))
vi.mock('../app/components/Rail', () => ({
  Rail: ({ project }: { project: string }) => {
    fetch(`/api/policies/violations?project=${encodeURIComponent(project)}`)
    return <div data-testid="rail" data-project={project} />
  },
}))
vi.mock('../app/components/Toaster', () => ({ Toaster: () => null }))
vi.mock('../app/components/DebugPanel', () => ({ DebugPanel: () => null }))

import { AppShell } from '../app/components/AppShell'

interface MockResponseInit {
  status?: number
  body?: unknown
}
function jsonResponse({ status = 200, body = {} }: MockResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ADR-057 §3 — project change triggers data refresh in every consumer', () => {
  const fetchCalls: string[] = []

  beforeEach(() => {
    fetchCalls.length = 0
    window.history.replaceState({}, '', '/?project=alpha')
    // localStorage intentionally not cleared — URL `?project=alpha` takes
    // precedence over localStorage in AppShell's resolution chain (ADR-057
    // §2), so leftover values can't shift the test outcome.

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        fetchCalls.push(url)
        if (url.includes('/api/projects')) {
          return jsonResponse({ body: [{ name: 'alpha' }, { name: 'beta' }] })
        }
        if (url.includes('/api/health')) {
          return jsonResponse({ body: { ok: true } })
        }
        return jsonResponse({ body: {} })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('every data-fetching consumer re-fires when the user switches project via TopBar', async () => {
    const user = userEvent.setup()
    render(<AppShell />)

    // Initial render: AppShell's lazy initializer reads ?project=alpha from
    // the URL synchronously, so every project-scoped consumer fetches with
    // project=alpha on first mount. No 'default' flash, no double-fetch —
    // that's the ADR-062 §1 guarantee this test depends on.
    await waitFor(() => {
      expect(fetchCalls.some((u) => u.includes('project=alpha'))).toBe(true)
    })
    const alphaConsumers = new Set(
      fetchCalls
        .filter((u) => u.includes('project=alpha'))
        .map((u) => u.split('?')[0]),
    )
    expect(alphaConsumers.size).toBeGreaterThanOrEqual(3)
    const alphaCountAtSwitch = fetchCalls.filter((u) => u.includes('project=alpha')).length

    // Open the project switcher and click "beta". This is the real change
    // vector — window.history.replaceState wouldn't trigger a re-render
    // because AppShell only reads the URL inside the useState lazy
    // initializer, which runs once.
    const switcher = await screen.findByLabelText(/active project: alpha/i)
    await act(async () => {
      await user.click(switcher)
    })
    const betaItem = await screen.findByRole('menuitem', { name: 'beta' })
    await act(async () => {
      await user.click(betaItem)
    })

    // Each consumer that depends on project should now have re-fetched
    // against beta — the contract surface from ADR-057 §3.
    await waitFor(() => {
      const betaConsumers = new Set(
        fetchCalls
          .filter((u) => u.includes('project=beta'))
          .map((u) => u.split('?')[0]),
      )
      expect(betaConsumers.size).toBe(alphaConsumers.size)
    })

    // And nothing should have fetched against alpha after the switch — no
    // late-firing useEffect double-firing on the old project.
    const alphaCountAfter = fetchCalls.filter((u) => u.includes('project=alpha')).length
    expect(alphaCountAfter).toBe(alphaCountAtSwitch)
  })
})
