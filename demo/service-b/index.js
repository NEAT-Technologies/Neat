const express = require('express')
const { Pool } = require('pg')

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

app.get('/query', async (_req, res) => {
  try {
    const r = await pool.query('SELECT now() as now')
    res.json({ now: r.rows[0].now })
  } catch (err) {
    // pg 7.4.0 + Postgres 15 → scram-sha-256 auth failure surfaces here.
    // No span carries db.system: postgresql for this query (pg 7.4.0 is too
    // old for @opentelemetry/instrumentation-pg). Instead, the trace
    // stitcher in @neat/core sees the erroring service-a → service-b span,
    // walks the static graph, and writes an INFERRED CONNECTS_TO edge to
    // payments-db. See ADR-014.
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.listen(port, () => {
  console.log(`service-b listening on :${port}`)
})
