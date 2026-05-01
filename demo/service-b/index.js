const express = require('express')
const { Pool } = require('pg')

const app = express()
const port = Number(process.env.PORT ?? 3001)

// Connection params come from the standard PG* env vars (PGHOST, PGUSER,
// PGPASSWORD, PGDATABASE, PGPORT) which pg reads automatically.
const pool = new Pool()

app.get('/query', async (_req, res) => {
  try {
    const r = await pool.query('SELECT now() as now')
    res.json({ now: r.rows[0].now })
  } catch (err) {
    // pg 7.4.0 + Postgres 15 → scram-sha-256 auth failure surfaces here.
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.listen(port, () => {
  console.log(`service-b listening on :${port}`)
})
