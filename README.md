# promotel

> **promotel**: **Prom**etheus to **O**pen**Tel**emetry conversion library for JavaScript/TypeScript

A pure TypeScript implementation for converting Prometheus metrics to OpenTelemetry Protocol (OTLP) format. Promotel provides fast, reliable conversion between Prometheus and OTLP formats with full type safety and comprehensive protobuf support.

## Features

- 🚀 **High Performance**: Zero-copy protobuf parsing and generation
- 🛡️ **Type Safe**: Full TypeScript support with generated protobuf types
- 🔄 **Format Flexibility**: Prometheus content negotiation between protobuf and text formats
- 🌐 **HTTP Integration**: Built-in HTTP client for fetching and pushing metrics
- 🔧 **Prom-Client Integration**: Direct integration with prom-client registries
- 🏗️ **Pipeline Architecture**: Flexible metrics pipeline with pluggable sources
- ⚡ **CLI Tool**: Standalone server for automated metric conversion
- 📊 **Complete Metric Support**: Counters, gauges, histograms, and summaries

## Installation

```bash
npm install @platformatic/promotel
```

**Requirements**: Node.js 18+

## Quick Start

### Standalone Server

The easiest way to get started is with the CLI server for automated conversion:

```bash
npx @platformatic/promotel \
  --prometheus-url http://my-app:9090/metrics \
  --otlp-url http://otel-collector:4318/v1/metrics \
  --interval 30000 \
  --service-name my-service \
  --service-version 1.0.0
```

This will automatically fetch metrics from your Prometheus endpoint every 30 seconds and push them to your OpenTelemetry collector.

### In-Process Bridge

For Node.js applications using prom-client, use the automated bridge:

```typescript
import { PromClientBridge } from '@platformatic/promotel';
import { register } from 'prom-client';

const bridge = new PromClientBridge({
  registry: register, // Your prom-client registry
  otlpEndpoint: 'http://otel-collector:4318/v1/metrics',
  interval: 15000, // 15 seconds
  conversionOptions: {
    serviceName: 'my-app',
    serviceVersion: '1.2.3'
  }
});

bridge.start(); // Begins automatic metric collection and pushing
```

### HTTP-Based Pipeline

For fetching from external Prometheus endpoints:

```typescript
import { gather, dispatch, convert } from '@platformatic/promotel';

// Gather from Prometheus endpoint
const writeRequest = await gather({
  url: 'http://app:9090/metrics'
});

// Convert to OTLP
const otlpData = convert(writeRequest);

// Dispatch to OTLP endpoint
await dispatch(otlpData, {
  url: 'http://otel-collector:4318/v1/metrics'
});
```

## API Reference

### Core Functions

#### `parse(text: string): prometheus.IWriteRequest`

Parses Prometheus text exposition format into protobuf WriteRequest.

```typescript
const writeRequest = parse(`
# HELP cpu_usage CPU usage percentage
# TYPE cpu_usage gauge
cpu_usage{cpu="0"} 45.2
cpu_usage{cpu="1"} 38.7
`);
```

#### `convert(writeRequest, options?): opentelemetry.proto.collector.metrics.v1.IExportMetricsServiceRequest`

Converts Prometheus WriteRequest to OTLP format.

**Parameters:**
- `writeRequest`: Prometheus protobuf WriteRequest
- `options`: Conversion options (optional)
  - `serviceName?: string` - Service name (default: 'promotel-js')
  - `serviceVersion?: string` - Service version (default: '0.1.0')
  - `defaultTimestamp?: number` - Default timestamp in milliseconds

```typescript
const otlpData = convert(writeRequest, {
  serviceName: 'payment-service',
  serviceVersion: '2.1.0',
  defaultTimestamp: Date.now()
});
```

#### `encode(data): Uint8Array`

Encodes OTLP ExportMetricsServiceRequest to protobuf bytes.

```typescript
const bytes = encode(otlpData);
// Send bytes over HTTP, gRPC, etc.
```

### HTTP Client Functions

#### `gather(options): Promise<prometheus.IWriteRequest>`

Fetches metrics from a Prometheus HTTP endpoint with content negotiation.

**Options:**
- `url: string` - Prometheus metrics endpoint URL
- `headers?: Record<string, string>` - Additional HTTP headers
- `signal?: AbortSignal` - Abort signal for request cancellation

```typescript
const writeRequest = await gather({
  url: 'https://my-app.com/metrics',
  headers: { 'Authorization': 'Bearer token123' },
  signal: AbortSignal.timeout(5000)
});
```

#### `dispatch(data, options): Promise<void>`

Pushes OTLP data to an OpenTelemetry collector endpoint.

**Options:**
- `url: string` - OTLP metrics endpoint URL
- `headers?: Record<string, string>` - Additional HTTP headers
- `signal?: AbortSignal` - Abort signal for request cancellation

```typescript
await dispatch(otlpData, {
  url: 'http://jaeger:14268/api/traces',
  headers: { 'Content-Encoding': 'gzip' }
});
```

### Prom-Client Integration

#### `getFromRegistry(options?): Promise<prometheus.IWriteRequest>`

Extracts metrics from a prom-client registry as protobuf WriteRequest.

**Options:**
- `registry?: Registry` - Prom-client registry (defaults to default registry)

```typescript
import { register, Counter } from 'prom-client';

const counter = new Counter({
  name: 'my_counter',
  help: 'Example counter',
  registers: [register]
});

const writeRequest = await getFromRegistry({ registry: register });
```

### Classes

#### `PromClientBridge`

Automated bridge that periodically converts metrics from a prom-client registry and pushes to an OTLP endpoint.

**Constructor Options:**
- `registry: Registry` - Prom-client registry
- `otlpEndpoint: string | OTLPEndpointOptions` - OTLP endpoint configuration
- `interval?: number` - Collection interval in milliseconds (default: 60000)
- `conversionOptions?: ConversionOptions` - OTLP conversion options
- `onError?: (error: Error) => void` - Error handler

**Methods:**
- `start(): void` - Start periodic collection
- `stop(): void` - Stop periodic collection
- `collectAndPush(): Promise<void>` - Manual collection trigger

```typescript
const bridge = new PromClientBridge({
  registry: myRegistry,
  otlpEndpoint: {
    url: 'http://collector:4318/v1/metrics',
    headers: { 'x-api-key': 'secret' }
  },
  interval: 30000,
  onError: (error) => console.error('Bridge error:', error)
});

bridge.start();

// Later...
bridge.stop();
```

#### `MetricsPipeline`

Flexible pipeline for metrics collection, conversion, and delivery with pluggable data sources.

**Constructor Options:**
- `source: MetricsSource` - Metrics data source implementation
- `otlpEndpoint: string | OTLPEndpointOptions` - OTLP endpoint configuration
- `interval?: number` - Collection interval in milliseconds (default: 60000)
- `conversionOptions?: ConversionOptions` - OTLP conversion options
- `onError?: (error: Error) => void` - Error handler

**Custom Source Example:**
```typescript
class DatabaseMetricsSource implements MetricsSource {
  async fetch(): Promise<prometheus.IWriteRequest> {
    const metrics = await this.queryDatabase();
    return this.convertToPrometheus(metrics);
  }
}

const pipeline = new MetricsPipeline({
  source: new DatabaseMetricsSource(),
  otlpEndpoint: 'http://collector:4318/v1/metrics'
});
```

### CLI Tool

The CLI provides a standalone server for automated metric conversion:

```bash
npx @platformatic/promotel \
  --prometheus-url http://app:9090/metrics \
  --otlp-url http://collector:4318/v1/metrics \
  --interval 30000 \
  --service-name my-service \
  --service-version 1.0.0
```

**Options:**
- `--prometheus-url` - Source Prometheus metrics endpoint
- `--otlp-url` - Destination OTLP endpoint
- `--interval` - Collection interval in milliseconds (default: 60000)
- `--service-name` - Service name for OTLP data (default: 'promotel-js')
- `--service-version` - Service version for OTLP data (default: '0.1.0')
- `--prometheus-headers` - JSON string of headers for Prometheus requests
- `--otlp-headers` - JSON string of headers for OTLP requests

### Protobuf Types

Promotel exports generated protobuf types for direct usage:

```typescript
import { prometheus, opentelemetry } from '@platformatic/promotel';

// Prometheus types
const writeRequest: prometheus.IWriteRequest = {
  timeseries: [],
  metadata: []
};

// OpenTelemetry types
const exportRequest: opentelemetry.proto.collector.metrics.v1.IExportMetricsServiceRequest = {
  resource_metrics: []
};
```

### Error Classes

```typescript
import { PrometheusParseError, OTLPConversionError } from '@platformatic/promotel';

try {
  parse('invalid metrics');
} catch (error) {
  if (error instanceof PrometheusParseError) {
    console.log(`Parse error at line ${error.lineNumber}: ${error.message}`);
  }
}

try {
  await dispatch(data, { url: 'invalid-url' });
} catch (error) {
  if (error instanceof OTLPConversionError) {
    console.log(`OTLP error: ${error.message}`);
  }
}
```

## Advanced Usage

### Low-Level Conversion

For direct conversion of Prometheus data without the automated pipelines:

```typescript
import { parse, convert, encode } from '@platformatic/promotel';

// Parse Prometheus text format
const prometheusText = `
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 1027
`;

const writeRequest = parse(prometheusText);
const otlpData = convert(writeRequest, {
  serviceName: 'my-service',
  serviceVersion: '1.0.0'
});

// Encode as protobuf for transmission
const bytes = encode(otlpData);
```

### Working with Protobuf Types

```typescript
import { prometheus, encodeWriteRequest, decodeWriteRequest } from '@platformatic/promotel';

// Create WriteRequest manually
const writeRequest: prometheus.IWriteRequest = {
  timeseries: [{
    labels: [{ name: 'job', value: 'api' }],
    samples: [{ value: 42, timestamp: Date.now() }]
  }],
  metadata: [{
    type: prometheus.MetricMetadata.MetricType.GAUGE,
    metric_family_name: 'memory_usage',
    help: 'Memory usage in bytes'
  }]
};

// Serialize to bytes
const bytes = encodeWriteRequest(writeRequest);

// Parse from bytes
const decoded = decodeWriteRequest(bytes);
```

### Custom Metrics Pipeline

```typescript
class CloudWatchSource implements MetricsSource {
  async fetch(): Promise<prometheus.IWriteRequest> {
    const metrics = await this.getCloudWatchMetrics();
    return this.transformToPrometheus(metrics);
  }

  private async getCloudWatchMetrics() {
    // Fetch from CloudWatch API
  }

  private transformToPrometheus(metrics: any[]): prometheus.IWriteRequest {
    // Convert CloudWatch metrics to Prometheus format
  }
}

const pipeline = new MetricsPipeline({
  source: new CloudWatchSource(),
  otlpEndpoint: process.env.OTLP_ENDPOINT!,
  conversionOptions: {
    serviceName: 'cloudwatch-bridge'
  },
  onError: (error) => {
    console.error('Pipeline failed:', error);
    // Send to monitoring system
  }
});
```

## Development

### Building

```bash
npm install
npm run build
```

### Testing

```bash
# Run all tests
npm test

# Run tests with test environment
npm run test:with-env

# Type checking
npm run typecheck

# Linting
npm run lint
```

### Protobuf Generation

```bash
# Fetch latest protobuf definitions
npm run fetch:protos

# Generate TypeScript types
npm run generate:types
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Run `npm run lint` and `npm run typecheck`
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## License

MIT © [Platformatic Inc.](https://platformatic.dev)
