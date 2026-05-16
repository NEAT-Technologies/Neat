/**
 * Version-skew check for `neatd start` (ADR-049 §Lifecycle — non-fatal
 * advisory).
 *
 * A globally installed `neat.is` binary may run an older version than the
 * `neat.is` available on npm — happens when the operator has not run
 * `npm install -g neat.is@latest` since the last publish. The six packages
 * move in lockstep (publish-system contract / ADR-052), so the registry
 * version of `neat.is` mirrors the local `@neat.is/core` version.
 *
 * On daemon start we compare the two and log a single advisory line when
 * the registry is ahead. The check is fail-open by design — registry
 * unreachable, slow, or returning an unexpected payload all resolve to
 * "no warning, daemon proceeds normally."
 */

import { setTimeout as delay } from 'node:timers/promises'

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/neat.is/latest'
const DEFAULT_TIMEOUT_MS = 2000

export interface VersionSkewCheckOptions {
  // The local version the running daemon reports. Production: read from the
  // bundled @neat.is/core package.json. Tests pass a literal.
  localVersion: string
  // Override the registry URL (tests point at a mock server).
  registryUrl?: string
  // Timeout for the registry fetch. Defaults to 2s.
  timeoutMs?: number
  // Injected so tests can simulate slow responses without real timers.
  fetchImpl?: typeof fetch
  // Sink for the advisory line. Defaults to console.warn.
  warn?: (message: string) => void
}

export interface VersionSkewCheckResult {
  // The version the registry reported, or null on any fetch / parse failure.
  remoteVersion: string | null
  // Whether the local version is behind the registry's.
  skewed: boolean
  // Whether the advisory was emitted.
  warned: boolean
}

/**
 * Fail-open registry lookup. Returns the version string or null on any
 * non-success path (network, timeout, parse, missing field).
 */
async function fetchRegistryVersion(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const controller = new AbortController()
  let timedOut = false
  const timer = delay(timeoutMs).then(() => {
    timedOut = true
    controller.abort()
  })
  try {
    const res = await Promise.race([
      fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } }),
      timer.then(() => null),
    ])
    if (timedOut || !res) return null
    if (!res.ok) return null
    const body = (await res.json()) as { version?: unknown }
    if (typeof body.version !== 'string' || body.version.length === 0) return null
    return body.version
  } catch {
    return null
  } finally {
    // Make sure the abort fires so the delay promise resolves even on
    // success — keeps the process from hanging on test teardown.
    if (!timedOut) controller.abort()
  }
}

/**
 * Compare two semver-shaped strings. Returns true when `local` is strictly
 * older than `remote`. We don't use a real semver library because the
 * advisory is intentionally coarse — any non-equal pair where the registry
 * looks newer is enough to suggest a re-install. The implementation does a
 * plain segment-by-segment integer compare and tolerates pre-release
 * suffixes by stripping them off.
 */
export function isLocalBehind(local: string, remote: string): boolean {
  if (local === remote) return false
  const parse = (v: string): number[] => {
    const core = v.split(/[-+]/)[0] ?? v
    return core.split('.').map((s) => {
      const n = Number.parseInt(s, 10)
      return Number.isFinite(n) ? n : 0
    })
  }
  const a = parse(local)
  const b = parse(remote)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av < bv) return true
    if (av > bv) return false
  }
  return false
}

export async function checkVersionSkew(
  opts: VersionSkewCheckOptions,
): Promise<VersionSkewCheckResult> {
  const url = opts.registryUrl ?? NPM_REGISTRY_URL
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = opts.fetchImpl ?? fetch
  const warn = opts.warn ?? ((m) => console.warn(m))

  const remote = await fetchRegistryVersion(url, timeoutMs, fetchImpl)
  if (!remote) return { remoteVersion: null, skewed: false, warned: false }

  if (!isLocalBehind(opts.localVersion, remote)) {
    return { remoteVersion: remote, skewed: false, warned: false }
  }

  warn(
    `[neatd] running neat.is@${opts.localVersion} but neat.is@${remote} is on npm — run \`npm install -g neat.is@latest\` to update`,
  )
  return { remoteVersion: remote, skewed: true, warned: true }
}
