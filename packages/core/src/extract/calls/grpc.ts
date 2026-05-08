import path from 'node:path'
import { infraId } from '@neat.is/types'
import { lineOf, snippet, type ExternalEndpoint, type SourceFile } from './shared.js'

// gRPC client construction in JS/TS:
//
//   const client = new orders_proto.OrderService(...)
//   const client = new OrdersClient('orders.internal:50051', ...)
//
// We catch `new <Name>Client(...)` and `new <namespace>.<Name>Service(...)`
// patterns and use the symbol name as the inferred service id. The address
// argument, when statically resolvable, becomes the host hint on the
// resulting CALLS edge — but resolution is best-effort.
const GRPC_CLIENT_RE = /new\s+([A-Z][A-Za-z0-9_]*)Client\s*\(\s*['"`]?([^,'"`)]+)?/g

function isLikelyAddress(value: string | undefined): boolean {
  if (!value) return false
  return /:\d{2,5}$/.test(value) || value.includes('.')
}

export function grpcEndpointsFromFile(
  file: SourceFile,
  serviceDir: string,
): ExternalEndpoint[] {
  const out: ExternalEndpoint[] = []
  const seen = new Set<string>()
  GRPC_CLIENT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = GRPC_CLIENT_RE.exec(file.content)) !== null) {
    const symbol = m[1]!
    const addr = m[2]?.trim()
    const name = isLikelyAddress(addr) ? addr! : symbol
    if (seen.has(name)) continue
    seen.add(name)
    const line = lineOf(file.content, m[0])
    out.push({
      infraId: infraId('grpc-service', name),
      name,
      kind: 'grpc-service',
      edgeType: 'CALLS',
      evidence: {
        file: path.relative(serviceDir, file.path),
        line,
        snippet: snippet(file.content, line),
      },
    })
  }
  return out
}
