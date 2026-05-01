// OTel bootstrap. Required first via `node -r ./otel.js index.js` so the auto
// instrumentations patch http/express/pg before the app code loads.
const { NodeSDK } = require('@opentelemetry/sdk-node')
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node')
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')

const sdk = new NodeSDK({
  serviceName: 'service-b',
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
})

sdk.start()
