const { createClient } = require('redis')

const client = createClient({ url: 'redis://cache.internal:6379' })

module.exports = { client }
