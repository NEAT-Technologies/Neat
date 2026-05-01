import { describe, it, expect, beforeEach } from 'vitest'
import { getGraph, resetGraph } from '../src/graph.js'

describe('graph singleton', () => {
  beforeEach(() => resetGraph())

  it('returns the same instance across calls', () => {
    const a = getGraph()
    const b = getGraph()
    expect(a).toBe(b)
  })

  it('starts empty', () => {
    const g = getGraph()
    expect(g.order).toBe(0)
    expect(g.size).toBe(0)
  })

  it('is a multi directed graph', () => {
    const g = getGraph()
    expect(g.type).toBe('directed')
    expect(g.multi).toBe(true)
  })
})
