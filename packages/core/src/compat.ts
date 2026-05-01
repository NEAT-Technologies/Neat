import semver from 'semver'
import compatData from '../compat.json' with { type: 'json' }

export interface CompatibilityResult {
  compatible: boolean
  reason?: string
  minDriverVersion?: string
}

interface CompatPair {
  driver: string
  engine: string
  minDriverVersion: string
  // The driver constraint only kicks in once the engine is at this major or higher.
  // Older engines (e.g. PostgreSQL 13) accept the older driver fine.
  minEngineVersion?: string
  reason: string
}

interface CompatMatrix {
  pairs: CompatPair[]
}

const matrix = compatData as CompatMatrix

// Engines like Postgres/MySQL only carry a major in the version field, so semver
// won't always parse them cleanly. Compare as integers when both sides look like
// majors; otherwise fall back to semver.coerce.
function engineMeetsThreshold(engineVersion: string, threshold: string): boolean {
  const e = parseInt(engineVersion, 10)
  const t = parseInt(threshold, 10)
  if (Number.isFinite(e) && Number.isFinite(t)) return e >= t

  const ec = semver.coerce(engineVersion)
  const tc = semver.coerce(threshold)
  if (ec && tc) return semver.gte(ec, tc)

  // Can't reason → don't claim incompatibility.
  return false
}

export function checkCompatibility(
  driver: string,
  driverVersion: string,
  engine: string,
  engineVersion: string,
): CompatibilityResult {
  const pair = matrix.pairs.find((p) => p.driver === driver && p.engine === engine)
  if (!pair) return { compatible: true }

  if (pair.minEngineVersion && !engineMeetsThreshold(engineVersion, pair.minEngineVersion)) {
    return { compatible: true }
  }

  const driverCoerced = semver.coerce(driverVersion)
  if (!driverCoerced) return { compatible: true }

  if (semver.lt(driverCoerced, pair.minDriverVersion)) {
    return {
      compatible: false,
      reason: pair.reason,
      minDriverVersion: pair.minDriverVersion,
    }
  }

  return { compatible: true }
}

// Exported so #4 (extract) can iterate the configured pairs to build
// `compatibleDrivers` lists on DatabaseNodes.
export function compatPairs(): readonly CompatPair[] {
  return matrix.pairs
}

export type { CompatPair }
