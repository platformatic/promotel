/**
 * ProMOTel-JS: Prometheus to OpenTelemetry (OTLP) Conversion Library
 *
 * A pure TypeScript implementation for converting Prometheus metrics
 * to OpenTelemetry Protocol (OTLP) format.
 */

// Main conversion function
export { convert } from './otlp.js';

// Parser functions for advanced usage
export { parse } from './parser.js';

// Prometheus protobuf functions
export {
  decodeWriteRequest,
  MetricType
} from './prometheus-proto.js';

// Generated protobuf types and encoding functions
import protobuf from '../proto/protobuf.js';
import type { opentelemetry } from '../proto/protobuf.js';
const { prometheus, opentelemetry: otlpProto } = protobuf;
export { prometheus, otlpProto as opentelemetry };

// Encoding helper function
export function encode(data: opentelemetry.proto.collector.metrics.v1.IExportMetricsServiceRequest): Uint8Array {
  return otlpProto.proto.collector.metrics.v1.ExportMetricsServiceRequest.encode(data).finish();
}

// Type definitions and error classes
export {
  type ConversionOptions,
} from './otlp.js';

export {
  PrometheusParseError,
  OTLPConversionError,
} from './errors.js';

// HTTP client functions
export {
  gather,
  dispatch,
  type PrometheusEndpointOptions,
  type OTLPEndpointOptions,
} from './http-client.js';

// Prom-client integration
export {
  getFromRegistry,
  type PromClientOptions,
} from './prom-client.js';

// Bridge class for in-process conversion
export {
  PromClientBridge,
  type PromClientBridgeOptions,
} from './bridge.js';

// Core pipeline for unified metrics processing
export {
  MetricsPipeline,
  type MetricsSource,
  type MetricsPipelineOptions,
} from './pipeline.js';
