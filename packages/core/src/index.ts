export { getGraph, resetGraph, type NeatGraph } from './graph.js'
export { extractFromDirectory, type ExtractResult } from './extract.js'
export {
  checkCompatibility,
  compatPairs,
  type CompatibilityResult,
  type CompatPair,
} from './compat.js'
export { loadGraphFromDisk, saveGraphToDisk, startPersistLoop } from './persist.js'
export { buildApi, type BuildApiOptions } from './api.js'
export {
  buildOtelReceiver,
  logSpanHandler,
  parseOtlpRequest,
  type ParsedSpan,
  type SpanHandler,
  type BuildOtelReceiverOptions,
  type OtlpTracesRequest,
} from './otel.js'
export {
  startOtelGrpcReceiver,
  type BuildOtelGrpcReceiverOptions,
  type OtelGrpcReceiver,
} from './otel-grpc.js'
export {
  handleSpan,
  makeSpanHandler,
  markStaleEdges,
  readErrorEvents,
  readStaleEvents,
  startStalenessLoop,
  stitchTrace,
  thresholdForEdgeType,
  type IngestContext,
  type MarkStaleOptions,
  type StaleEvent,
  type StalenessLoopOptions,
} from './ingest.js'
export { getBlastRadius, getRootCause } from './traverse.js'
export {
  computeGraphDiff,
  loadSnapshotForDiff,
  type GraphDiff,
  type PersistedSnapshot,
} from './diff.js'
