// Node identity helpers — the single source of truth for node id wire format.
// See ADR-028 and docs/contracts.md Rule 16.
//
// Producers construct ids via these helpers; consumers parse via the inverses.
// Hand-rolled template literals like `service:${name}` are a contract violation
// (caught by packages/core/test/audits/contracts.test.ts).

const SERVICE_PREFIX = 'service:'
const DATABASE_PREFIX = 'database:'
const CONFIG_PREFIX = 'config:'
const INFRA_PREFIX = 'infra:'
const FRONTIER_PREFIX = 'frontier:'

// ServiceNode id: `service:<name>` where <name> is the manifest name verbatim
// (package.json#name for JS/TS, pyproject [project].name for Python). Names
// with slashes (e.g. scoped npm packages `@org/foo`) are kept as-is — no
// transformation. See ADR-028 §5 for workspace-collision deferral.
export function serviceId(name: string): string {
  return `${SERVICE_PREFIX}${name}`
}

export function parseServiceId(id: string): string | null {
  return id.startsWith(SERVICE_PREFIX) ? id.slice(SERVICE_PREFIX.length) : null
}

// DatabaseNode id: `database:<host>`. Port is intentionally excluded; two DBs
// on the same host different ports collide. See ADR-028 §6 for deferral.
export function databaseId(host: string): string {
  return `${DATABASE_PREFIX}${host}`
}

export function parseDatabaseId(id: string): string | null {
  return id.startsWith(DATABASE_PREFIX) ? id.slice(DATABASE_PREFIX.length) : null
}

// ConfigNode id: `config:<relPath>` where <relPath> is the path relative to
// the scan root, with forward slashes regardless of platform. ConfigNodes
// record file existence only (ADR-016).
export function configId(relPath: string): string {
  return `${CONFIG_PREFIX}${relPath}`
}

export function parseConfigId(id: string): string | null {
  return id.startsWith(CONFIG_PREFIX) ? id.slice(CONFIG_PREFIX.length) : null
}

// InfraNode id: `infra:<kind>:<name>`. <kind> is a free string sub-type
// (kafka-topic, redis, grpc-service, lambda, queue, etc.) per ADR-022.
export function infraId(kind: string, name: string): string {
  return `${INFRA_PREFIX}${kind}:${name}`
}

export function parseInfraId(id: string): { kind: string; name: string } | null {
  if (!id.startsWith(INFRA_PREFIX)) return null
  const rest = id.slice(INFRA_PREFIX.length)
  const colon = rest.indexOf(':')
  if (colon === -1) return null
  return { kind: rest.slice(0, colon), name: rest.slice(colon + 1) }
}

// FrontierNode id: `frontier:<host>` where <host> is host:port from the OTel
// peer attribute. Promoted to a typed node id (typically serviceId(...)) once
// an alias resolves; the FrontierNode is removed and edges are rewritten.
export function frontierId(host: string): string {
  return `${FRONTIER_PREFIX}${host}`
}

export function parseFrontierId(id: string): string | null {
  return id.startsWith(FRONTIER_PREFIX) ? id.slice(FRONTIER_PREFIX.length) : null
}
