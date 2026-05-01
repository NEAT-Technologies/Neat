export interface CompatibilityResult {
  compatible: boolean
  reason?: string
  minDriverVersion?: string
}

// Stub. The real compat matrix and compat.json land in #5.
export function checkCompatibility(
  _driver: string,
  _driverVersion: string,
  _engine: string,
  _engineVersion: string,
): CompatibilityResult {
  return { compatible: true }
}
