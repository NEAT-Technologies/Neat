import { describe, it, expect } from 'vitest'
import { checkCompatibility, compatPairs } from '../src/compat.js'

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
