require("dotenv").config();
const { NodeSDK } = require("@opentelemetry/sdk-node");
// This is a helper function that will automatically enable instrumentations for you
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { registerInstrumentations } = require("@opentelemetry/instrumentation");

const logsAPI = require("@opentelemetry/api-logs");
const { LoggerProvider, BatchLogRecordProcessor } = require("@opentelemetry/sdk-logs");
const { WinstonInstrumentation } = require("@opentelemetry/instrumentation-winston");

const { PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");

// Exporters are used to send telemetry data to the backend (or the collector)
const { OTLPLogExporter } = require("@opentelemetry/exporter-logs-otlp-http");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto");
const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-proto");

const otelCollectorURL = process.env.OTEL_COLLECTOR_URL || "http://localhost:4318/v1";

// Set up the logger provider to work with winston
const loggerProvider = new LoggerProvider();
loggerProvider.addLogRecordProcessor(
  new BatchLogRecordProcessor(new OTLPLogExporter({ url: otelCollectorURL + "/logs" })),
);
logsAPI.logs.setGlobalLoggerProvider(loggerProvider);
registerInstrumentations({ instrumentations: [new WinstonInstrumentation({})] });

// Setup OTel SDK
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: otelCollectorURL + "/traces",
  }),

  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: otelCollectorURL + "/metrics",
    }),
    // Default is 60s; export every 10s so metrics show up quickly in the demo
    exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS) || 10000,
  }),

  instrumentations: [getNodeAutoInstrumentations()], // 🪄 The magic...
});

sdk.start();

// Flush batched telemetry before exit so spans/logs are not lost
const shutdown = () => {
  Promise.allSettled([sdk.shutdown(), loggerProvider.shutdown()]).finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
