const { Kafka } = require('kafkajs')

const kafka = new Kafka({ clientId: 'demo', brokers: ['kafka:9092'] })
const producer = kafka.producer()
const consumer = kafka.consumer({ groupId: 'demo-group' })

async function publish() {
  await producer.send({
    topic: 'orders',
    messages: [{ value: 'hello' }],
  })
}

async function listen() {
  await consumer.subscribe({ topic: 'shipments', fromBeginning: true })
}

module.exports = { publish, listen }
