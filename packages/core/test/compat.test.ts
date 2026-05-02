import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  checkCompatibility,
  checkDeprecatedApi,
  checkNodeEngineConstraint,
  checkPackageConflict,
  compatPairs,
  deprecatedApis,
  ensureCompatLoaded,
  nodeEngineConstraints,
  packageConflicts,
  resetCompatMatrix,
} from '../src/compat.js'

describe('checkCompatibility', () => {
  describe('pg / postgresql', () => {
    it('flags pg 7.4.0 against PostgreSQL 15 as incompatible (the demo case)', () => {
      const r = checkCompatibility('pg', '7.4.0', 'postgresql', '15')
      expect(r.compatible).toBe(false)
      expect(r.minDriverVersion).toBe('8.0.0')
      expect(r.reason).toMatch(/scram/i)
    })

    it('flags pg 7.4.0 against PostgreSQL 14 as incompatible', () => {
      expect(checkCompatibility('pg', '7.4.0', 'postgresql', '14').compatible).toBe(false)
    })

    it('lets pg 7.4.0 against PostgreSQL 13 pass — engine threshold not reached', () => {
      expect(checkCompatibility('pg', '7.4.0', 'postgresql', '13').compatible).toBe(true)
    })

    it('lets pg 8.0.0 against PostgreSQL 15 pass', () => {
      expect(checkCompatibility('pg', '8.0.0', 'postgresql', '15').compatible).toBe(true)
    })

    it('lets pg 8.11.3 against PostgreSQL 16 pass', () => {
      expect(checkCompatibility('pg', '8.11.3', 'postgresql', '16').compatible).toBe(true)
    })
  })

  describe('mysql2 / mysql', () => {
    it('flags mysql2 2.3.0 against MySQL 8 as incompatible', () => {
      const r = checkCompatibility('mysql2', '2.3.0', 'mysql', '8')
      expect(r.compatible).toBe(false)
      expect(r.minDriverVersion).toBe('3.0.0')
      expect(r.reason).toMatch(/caching_sha2/i)
    })

    it('lets mysql2 2.3.0 against MySQL 5 pass', () => {
      expect(checkCompatibility('mysql2', '2.3.0', 'mysql', '5').compatible).toBe(true)
    })

    it('lets mysql2 3.6.0 against MySQL 8 pass', () => {
      expect(checkCompatibility('mysql2', '3.6.0', 'mysql', '8').compatible).toBe(true)
    })
  })

  describe('mongoose / mongodb', () => {
    it('flags mongoose 6.10.0 against MongoDB 7 as incompatible', () => {
      const r = checkCompatibility('mongoose', '6.10.0', 'mongodb', '7')
      expect(r.compatible).toBe(false)
      expect(r.minDriverVersion).toBe('7.0.0')
    })

    it('lets mongoose 6.10.0 against MongoDB 6 pass', () => {
      expect(checkCompatibility('mongoose', '6.10.0', 'mongodb', '6').compatible).toBe(true)
    })

    it('lets mongoose 7.5.0 against MongoDB 7 pass', () => {
      expect(checkCompatibility('mongoose', '7.5.0', 'mongodb', '7').compatible).toBe(true)
    })
  })

  describe('unknown pairs', () => {
    it('returns compatible for an unknown driver/engine combination', () => {
      expect(checkCompatibility('bun:sqlite', '1.0.0', 'sqlite', '3').compatible).toBe(true)
    })

    it('returns compatible when only the driver matches but engine is different', () => {
      expect(checkCompatibility('pg', '7.4.0', 'cockroachdb', '23').compatible).toBe(true)
    })
  })

  describe('version coercion edge cases', () => {
    it('handles a "v"-prefixed driver version', () => {
      expect(checkCompatibility('pg', 'v7.4.0', 'postgresql', '15').compatible).toBe(false)
    })

    it('returns compatible when driver version is unparseable', () => {
      // Refuse to claim incompatibility on garbage input.
      expect(checkCompatibility('pg', 'nightly-build', 'postgresql', '15').compatible).toBe(true)
    })
  })

  describe('compatPairs() export', () => {
    it('exposes the configured matrix for #4 to read', () => {
      const pairs = compatPairs()
      expect(pairs.length).toBe(6)
      expect(pairs.map((p) => `${p.driver}/${p.engine}`).sort()).toEqual([
        'mongoose/mongodb',
        'mysql-connector-python/mysql',
        'mysql2/mysql',
        'pg/postgresql',
        'psycopg2/postgresql',
        'pymongo/mongodb',
      ])
    })
  })
})

describe('checkNodeEngineConstraint', () => {
  it('flags a service whose engines.node excludes the required version', () => {
    const constraint = nodeEngineConstraints().find((c) => c.package === 'next')!
    const r = checkNodeEngineConstraint(constraint, '14.2.0', '>=16')
    expect(r.compatible).toBe(false)
    expect(r.requiredNodeVersion).toBe('18.17.0')
  })

  it('passes when engines.node admits the required version', () => {
    const constraint = nodeEngineConstraints().find((c) => c.package === 'next')!
    expect(checkNodeEngineConstraint(constraint, '14.2.0', '>=20').compatible).toBe(true)
  })

  it('passes when the package version is below the constraint trigger', () => {
    const constraint = nodeEngineConstraints().find((c) => c.package === 'next')!
    expect(checkNodeEngineConstraint(constraint, '13.5.0', '>=16').compatible).toBe(true)
  })

  it('refuses to claim a conflict when engines.node is unset', () => {
    const constraint = nodeEngineConstraints().find((c) => c.package === 'next')!
    expect(checkNodeEngineConstraint(constraint, '14.2.0', undefined).compatible).toBe(true)
  })
})

describe('checkPackageConflict', () => {
  it('flags @tanstack/react-query 5+ paired with React 17', () => {
    const conflict = packageConflicts().find(
      (c) => c.package === '@tanstack/react-query',
    )!
    const r = checkPackageConflict(conflict, '5.0.0', '17.0.2')
    expect(r.compatible).toBe(false)
    expect(r.foundVersion).toBe('17.0.2')
    expect(r.requires).toEqual({ name: 'react', minVersion: '18.0.0' })
  })

  it('flags @tanstack/react-query 5+ when the required peer is missing entirely', () => {
    const conflict = packageConflicts().find(
      (c) => c.package === '@tanstack/react-query',
    )!
    const r = checkPackageConflict(conflict, '5.0.0', undefined)
    expect(r.compatible).toBe(false)
  })

  it('passes when both packages are above the threshold', () => {
    const conflict = packageConflicts().find(
      (c) => c.package === '@tanstack/react-query',
    )!
    expect(checkPackageConflict(conflict, '5.18.0', '18.2.0').compatible).toBe(true)
  })
})

describe('checkDeprecatedApi', () => {
  it('flags any declared version of a deprecated package without a max', () => {
    const rule = deprecatedApis().find((d) => d.package === 'node-uuid')!
    expect(checkDeprecatedApi(rule, '1.4.0').compatible).toBe(false)
  })

  it('respects packageMaxVersion when set', () => {
    const rule = deprecatedApis().find((d) => d.package === 'request')!
    expect(checkDeprecatedApi(rule, '2.88.0').compatible).toBe(false)
    expect(checkDeprecatedApi(rule, '99.0.0').compatible).toBe(true)
  })
})

describe('ensureCompatLoaded — NEAT_COMPAT_URL', () => {
  const originalEnv = process.env.NEAT_COMPAT_URL
  let originalFetch: typeof fetch

  beforeEach(() => {
    resetCompatMatrix()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NEAT_COMPAT_URL
    else process.env.NEAT_COMPAT_URL = originalEnv
    globalThis.fetch = originalFetch
    resetCompatMatrix()
  })

  it('merges a remote extension into the bundled matrix', async () => {
    process.env.NEAT_COMPAT_URL = 'https://example.test/compat-' + Date.now() + '.json'
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
          return {
            pairs: [
              {
                kind: 'driver-engine',
                driver: 'redis',
                engine: 'redis',
                minDriverVersion: '4.0.0',
                minEngineVersion: '7',
                reason: 'redis 7 changed RESP3 negotiation; redis < 4 lacks the handshake.',
              },
            ],
          }
        },
      }) as unknown as Response) as unknown as typeof fetch

    await ensureCompatLoaded()
    const pair = compatPairs().find((p) => p.driver === 'redis' && p.engine === 'redis')
    expect(pair).toBeDefined()
    expect(pair?.minDriverVersion).toBe('4.0.0')
  })

  it('falls back silently to the bundled matrix when fetch fails', async () => {
    process.env.NEAT_COMPAT_URL = 'https://example.test/missing-' + Date.now() + '.json'
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    await ensureCompatLoaded()
    expect(compatPairs().length).toBeGreaterThanOrEqual(6)
  })
})
