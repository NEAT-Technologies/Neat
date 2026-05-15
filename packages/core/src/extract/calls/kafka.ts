import path from 'node:path'
import { infraId } from '@neat.is/types'
import { lineOf, snippet, type ExternalEndpoint, type SourceFile } from './shared.js'

// Match `producer.send({ topic: "orders" ... })` and `producer.send({
// topic: 'orders' })` plus the two-arg form `producer.send("orders", ...)`.
// Kafka client libraries vary; these two forms cover kafkajs + node-rdkafka
// well enough for static extraction. Same shape covers consumer.subscribe.
const PRODUCER_TOPIC_RE =
  /(?:producer|kafkaProducer)[\s\S]{0,40}?\.send\s*\(\s*\{[\s\S]{0,200}?topic\s*:\s*['"`]([^'"`]+)['"`]/g
const CONSUMER_TOPIC_RE =
  /(?:consumer|kafkaConsumer)[\s\S]{0,40}?\.(?:subscribe|run)\s*\(\s*\{[\s\S]{0,200}?topic[s]?\s*:\s*(?:\[\s*)?['"`]([^'"`]+)['"`]/g

function findAll(re: RegExp, text: string): { topic: string; index: number }[] {
  re.lastIndex = 0
  const out: { topic: string; index: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ topic: m[1]!, index: m.index })
  }
  return out
}

export function kafkaEndpointsFromFile(
  file: SourceFile,
  serviceDir: string,
): ExternalEndpoint[] {
  const out: ExternalEndpoint[] = []
  const seen = new Set<string>()
  const make = (topic: string, edgeType: 'PUBLISHES_TO' | 'CONSUMES_FROM'): void => {
    const key = `${edgeType}|${topic}`
    if (seen.has(key)) return
    seen.add(key)
    const line = lineOf(file.content, topic)
    out.push({
      infraId: infraId('kafka-topic', topic),
      name: topic,
      kind: 'kafka-topic',
      edgeType,
      // `producer.send({topic: 'x'})` / `consumer.subscribe({topic: 'x'})` —
      // framework-aware (kafkajs / node-rdkafka shape). Verified-call-site
      // tier (ADR-066).
      confidenceKind: 'verified-call-site',
      evidence: {
        file: path.relative(serviceDir, file.path),
        line,
        snippet: snippet(file.content, line),
      },
    })
  }

  for (const { topic } of findAll(PRODUCER_TOPIC_RE, file.content)) make(topic, 'PUBLISHES_TO')
  for (const { topic } of findAll(CONSUMER_TOPIC_RE, file.content)) make(topic, 'CONSUMES_FROM')
  return out
}
