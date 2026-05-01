import type { NeatGraph } from './graph.js'

// Stub. SIGTERM/SIGINT save, periodic save, and load-on-startup land in #6.
export async function loadGraphFromDisk(_graph: NeatGraph, _outPath: string): Promise<void> {
  return
}

export async function saveGraphToDisk(_graph: NeatGraph, _outPath: string): Promise<void> {
  return
}

export function startPersistLoop(_graph: NeatGraph, _outPath: string, _intervalMs = 60_000): () => void {
  return () => {}
}
