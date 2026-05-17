import { describe, it, expect, vi } from 'vitest'
import { checkVersionSkew, isLocalBehind } from '../src/version-skew.js'

describe('isLocalBehind', () => {
  it('returns true when local is strictly older', () => {
    expect(isLocalBehind('0.3.4', '0.3.5')).toBe(true)
    expect(isLocalBehind('0.3.5', '0.4.0')).toBe(true)
    expect(isLocalBehind('0.2.99', '0.3.0')).toBe(true)
  })

  it('returns false when local equals remote', () => {
    expect(isLocalBehind('0.3.5', '0.3.5')).toBe(false)
  })

  it('returns false when local is newer', () => {
    expect(isLocalBehind('0.3.6', '0.3.5')).toBe(false)
    expect(isLocalBehind('0.4.0', '0.3.99')).toBe(false)
  })

  it('strips pre-release suffixes before compare', () => {
    expect(isLocalBehind('0.3.5-rc.1', '0.3.5')).toBe(false)
    expect(isLocalBehind('0.3.4', '0.3.5-rc.1')).toBe(true)
  })
})

describe('checkVersionSkew', () => {
  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('emits the advisory when registry is ahead of local (issue #282)', async () => {
    const warn = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ version: '0.3.6' }))
    const result = await checkVersionSkew({
      localVersion: '0.3.5',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn,
    })
    expect(result.remoteVersion).toBe('0.3.6')
    expect(result.skewed).toBe(true)
    expect(result.warned).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = warn.mock.calls[0]![0] as string
    expect(msg).toContain('neat.is@0.3.5')
    expect(msg).toContain('neat.is@0.3.6')
    expect(msg).toContain('npm install -g neat.is@latest')
  })

  it('does not warn when local matches registry (issue #282)', async () => {
    const warn = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ version: '0.3.5' }))
    const result = await checkVersionSkew({
      localVersion: '0.3.5',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn,
    })
    expect(result.skewed).toBe(false)
    expect(result.warned).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not warn when local is ahead of registry (e.g. local dev build)', async () => {
    const warn = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ version: '0.3.5' }))
    const result = await checkVersionSkew({
      localVersion: '0.3.6',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn,
    })
    expect(result.skewed).toBe(false)
    expect(result.warned).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails open when the registry fetch throws (issue #282)', async () => {
    const warn = vi.fn()
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    const result = await checkVersionSkew({
      localVersion: '0.3.5',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn,
    })
    expect(result.remoteVersion).toBeNull()
    expect(result.skewed).toBe(false)
    expect(result.warned).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails open when the registry returns a malformed body', async () => {
    const warn = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ notVersion: '0.3.6' }))
    const result = await checkVersionSkew({
      localVersion: '0.3.5',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn,
    })
    expect(result.remoteVersion).toBeNull()
    expect(result.warned).toBe(false)
  })

  it('fails open when the registry returns a non-success status', async () => {
    const warn = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('not found', { status: 404 }),
    )
    const result = await checkVersionSkew({
      localVersion: '0.3.5',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn,
    })
    expect(result.remoteVersion).toBeNull()
    expect(result.warned).toBe(false)
  })

  it('fails open and does not throw when the fetch times out', async () => {
    const warn = vi.fn()
    // fetchImpl never resolves before the timeout fires.
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        }),
    )
    const result = await checkVersionSkew({
      localVersion: '0.3.5',
      timeoutMs: 25,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn,
    })
    expect(result.remoteVersion).toBeNull()
    expect(result.warned).toBe(false)
  })
})
