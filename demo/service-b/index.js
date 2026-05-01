const express = require('express')
const { Pool } = require('pg')
const { trace, SpanStatusCode, SpanKind } = require('@opentelemetry/api')

const app = express()
const port = Number(process.env.PORT ?? 3001)

// Connection params come from the standard PG* env vars (PGHOST, PGUSER,
// PGPASSWORD, PGDATABASE, PGPORT) which pg reads automatically.
//
// connectionTimeoutMillis: pg 7.4.0 has no SCRAM-SHA-256 path, so against
// PG 15 the auth handshake never completes — pool.query would hang
// indefinitely instead of throwing. The 4s ceiling forces a real error
// up to the catch block so the span can close and export.
const pool = new Pool({ connectionTimeoutMillis: 4000 })

// !!! TEMPORARY — REMOVE WHEN M3 TRACE STITCHING LANDS !!!
//
// @opentelemetry/instrumentation-pg only supports pg >= 8.x. pg 7.4.0 (the
// version that breaks against PG 15 — the whole point of the demo) is too old
// for the auto-instrumenter to hook into, so no span gets emitted with
// `db.system: postgresql`. Without that span, neat-core's ingest can't draw
// the OBSERVED CONNECTS_TO edge service-b → payments-db, which M2's
// verification gate expects.
//
// The systems-level fix is M3's planned trace stitcher: when an upstream span
// errors, walk the static graph from that service along EXTRACTED edges and
// write INFERRED edges. Once that lands, this manual span is debt — pull
// `tracedQuery` and the `@opentelemetry/api` import, drop the call site back
// to plain `pool.query(...)`, and verify the demo still works.
//
// Tracking: docs/decisions.md ADR-014, docs/milestones.md M3 notes.
const tracer = trace.getTracer('service-b')

async function tracedQuery(sql) {
  return tracer.startActiveSpan(
    'pg.query',
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'postgresql',
        'db.name': process.env.PGDATABASE ?? 'neatdemo',
        'db.user': process.env.PGUSER ?? 'neat',
        'db.statement': sql,
        'server.address': process.env.PGHOST ?? 'payments-db',
        'server.port': Number(process.env.PGPORT ?? 5432),
      },
    },
    async (span) => {
      try {
        const result = await pool.query(sql)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        throw err
      } finally {
        span.end()
      }
    },
  )
}

app.get('/query', async (_req, res) => {
  try {
    const r = await tracedQuery('SELECT now() as now')
    res.json({ now: r.rows[0].now })
  } catch (err) {
    // pg 7.4.0 + Postgres 15 → scram-sha-256 auth failure surfaces here.
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.listen(port, () => {
  console.log(`service-b listening on :${port}`)
})
