const express = require('express')
const axios = require('axios')

const app = express()
const port = Number(process.env.PORT ?? 3000)
const serviceB = process.env.SERVICE_B_URL ?? 'http://service-b:3001'

app.get('/data', async (_req, res) => {
  try {
    const r = await axios.get(`${serviceB}/query`, { timeout: 5000 })
    res.json({ ok: true, data: r.data })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.listen(port, () => {
  console.log(`service-a listening on :${port}`)
})
