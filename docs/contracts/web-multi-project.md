---
name: web-multi-project
description: Web shell scopes every backend call to the user-selected project. AppShell owns project state. Project changes trigger data refresh. No hardcoded project names. The runtime corollary of ADR-026.
governs:
  - "packages/web/app/components/AppShell.tsx"
  - "packages/web/app/components/TopBar.tsx"
  - "packages/web/app/components/GraphCanvas.tsx"
  - "packages/web/app/components/Inspector.tsx"
  - "packages/web/app/components/StatusBar.tsx"
  - "packages/web/app/components/Rail.tsx"
  - "packages/web/lib/proxy.ts"
  - "packages/web/lib/fixtures.ts"
  - "packages/web/app/api/**"
adr: [ADR-057, ADR-062, ADR-026, ADR-051]
---

# Web shell multi-project routing contract

The second of four web-shell contracts. Sibling contracts: [`web-completeness.md`](./web-completeness.md), [`web-debugging.md`](./web-debugging.md), [`web-bootstrap.md`](./web-bootstrap.md).

When NEAT runs against an unfamiliar codebase (medusa, the canonical MVP-success-PR target), the web shell must show *that codebase's* graph. The backend already supports multi-project routing per ADR-026; this contract makes the frontend honor it consistently.

Today's gap (per `audit/09-gaps-and-stubs.md`): *"Multi-project — graph not re-fetched on project change."*

## Binding rules

### 1. Single source of truth

`AppShell.tsx` owns the `project` state via `useState<string>`. Every component that fetches backend data accepts `project` as a prop or reads it from a context. No component manages its own project state.

### 2. Initial project resolution chain

In order, first non-empty wins:

1. URL query param: `?project=X`
2. `localStorage.getItem('neat:lastProject')` — survives reload
3. First entry from `GET /projects` if registry is non-empty
4. `'default'` fallback (only allowed value of `'default'` in branching logic)

Steps 1-2 run synchronously inside the `useState` lazy initializer; step 3 is async and runs from a `useEffect` after mount only when steps 1-2 produced no value. AppShell is rendered client-only (see rule 2a below), so the synchronous reads are safe — no server-side execution to disagree with.

### 2a. AppShell renders client-only (ADR-062, supersedes the 2026-05-11 SSR-safety amendment)

`packages/web/app/page.tsx` mounts AppShell via `next/dynamic` with `{ ssr: false }`. The Next.js server emits the static HTML shell (head, fonts, CSS link, empty `<body>`); the entire AppShell tree builds on the client.

Required shape:

```tsx
// packages/web/app/page.tsx
import dynamic from 'next/dynamic'
const AppShell = dynamic(() => import('./components/AppShell').then((m) => m.AppShell), {
  ssr: false,
})
```

Consequences:

- AppShell may read `window.*` / `localStorage.*` / `document.*` / `navigator.*` synchronously during its render path. The lazy-initializer pattern for rule 2 is the contract surface, not a workaround.
- There is no server-side first render to keep byte-identical. The earlier ADR-057 "rule 2a — SSR-safe execution" amendment is superseded; its body is retained in `decisions.md` for historical context only.
- Other routes (`/incidents`, `/api/**`) keep server-side rendering — only the AppShell subtree is client-only.

Forbidden:

- Removing `{ ssr: false }` from the `dynamic(...)` call without a superseding ADR. The two costs the SSR-safe amendment imposed (the `'default'`-flash and the double-fetch on every `useEffect([project])` consumer) re-appear immediately if AppShell starts SSR-ing again.

### 3. Project change triggers data refresh

When `project` changes — switcher click, URL update, deep link — every component that depends on it re-fetches via `useEffect(..., [project])`. No stale data from the previous project carries over. GraphCanvas, Inspector, StatusBar, Incidents page — all of them.

### 4. URL stays in sync

Updating the project state writes the new value to the URL (`?project=X`) so the page can be shared / bookmarked / deep-linked. Reading the URL on load is the first step of the resolution chain (rule #2).

### 5. API proxy routes accept `project`

All routes under `packages/web/app/api/` accept `?project=X` as a query param (or path-scoped `/projects/:project/X` if the proxy uses that shape). The route forwards to the matching backend endpoint per ADR-026's dual-mount.

### 6. TopBar surfaces the active project

The user always knows which codebase NEAT is currently graphing — no ambiguity, no implicit defaults. TopBar renders the project name visibly. The switcher (uses `GET /projects` per ADR-051) is reachable via at most one click.

### 7. Project switcher is a real control

Not a stub. Clicking an entry calls `setProject(name)` and updates the URL. Per ADR-056 (web-completeness), no empty handler permitted.

### 8. No hardcoded project names in branching logic

`'default'` is allowed only as the explicit fallback in `AppShell.tsx`'s state initializer. No `'medusa'`, no `'neat'`, no `if (project === 'demo')` anywhere in `packages/web/`. Same rule as the cross-cutting "no demo-name hardcoding" (cross-cutting rule 8) but extended to the web track.

Allowed locations for project-name string literals:

- `'default'` in `AppShell.tsx` state initializer
- Test fixtures (`packages/web/lib/fixtures.ts` — though even there, "demo" is a fixture name, not a code branch)
- Comments and docstrings

## Authority

- **State owner:** `packages/web/app/components/AppShell.tsx`
- **Display + switcher:** `packages/web/app/components/TopBar.tsx`
- **Project-aware proxy:** `packages/web/lib/proxy.ts`
- **Project-aware API routes:** `packages/web/app/api/**/route.ts`

## Enforcement

`it.todo` block in `contracts.test.ts` for ADR-057:

- AppShell.tsx initializes project from URL → localStorage → /projects → 'default' (regex-check the source for the resolution chain).
- Every component file that imports `proxy.ts` or fetches from `/api/` accepts `project: string` as a prop.
- Every API proxy route under `packages/web/app/api/` forwards `project` query/path to the backend.
- No hardcoded project names (`medusa`, `neat`, `demo`, etc.) in branching logic under `packages/web/app/components/` or `packages/web/lib/` (excluding fixtures.ts).
- Multi-project re-fetch test: render AppShell with `project=A`, change to `B`, assert all data-fetching hooks re-ran. Requires Vitest + React Testing Library — new tooling for the web track. Flag in PR.
- **Client-only boundary: `app/page.tsx` imports `dynamic` from `next/dynamic` and mounts AppShell with `{ ssr: false }` (ADR-062).**

Full rationale: [ADR-057](../decisions.md#adr-057--web-shell-multi-project-routing), [ADR-062](../decisions.md#adr-062--web-shell-renders-client-only-ssr-disabled-at-the-appshell-boundary).
