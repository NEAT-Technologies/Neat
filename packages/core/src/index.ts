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
  handleSpan,
  makeSpanHandler,
  markStaleEdges,
  readErrorEvents,
  startStalenessLoop,
  type IngestContext,
} from './ingest.js'
