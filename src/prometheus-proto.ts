/**
 * Prometheus protobuf type utilities using statically generated types
 */

import protobuf from '../proto/protobuf.js';
import type { prometheus } from '../proto/protobuf.js';

const { prometheus: promProto } = protobuf;

/**
 * Create a Prometheus WriteRequest object
 */
export function createWriteRequest(data: {
  timeseries: prometheus.ITimeSeries[];
  metadata: prometheus.IMetricMetadata[];
}): prometheus.IWriteRequest {
  return {
    timeseries: data.timeseries,
    metadata: data.metadata
  };
}

/**
 * Create a Prometheus TimeSeries object
 */
export function createTimeSeries(data: {
  labels: prometheus.ILabel[];
  samples: prometheus.ISample[];
}): prometheus.ITimeSeries {
  return {
    labels: data.labels,
    samples: data.samples
  };
}

/**
 * Create Prometheus MetricMetadata object
 */
export function createMetricMetadata(data: {
  type: number; // MetricType enum value
  metric_family_name: string;
  help?: string;
  unit?: string;
}): prometheus.IMetricMetadata {
  return {
    type: data.type,
    metric_family_name: data.metric_family_name,
    help: data.help ?? null,
    unit: data.unit ?? null
  };
}

/**
 * Create a Prometheus Label object
 */
export function createLabel(name: string, value: string): prometheus.ILabel {
  return { name, value };
}

/**
 * Create a Prometheus Sample object
 */
export function createSample(value: number, timestamp: number): prometheus.ISample {
  return { value, timestamp };
}

/**
 * Prometheus MetricType enum values
 */
export enum MetricType {
  UNKNOWN = 0,
  COUNTER = 1,
  GAUGE = 2,
  HISTOGRAM = 3,
  GAUGEHISTOGRAM = 4,
  SUMMARY = 5,
  INFO = 6,
  STATESET = 7
}


/**
 * Decode WriteRequest from protobuf binary
 */
export function decodeWriteRequest(data: Uint8Array): prometheus.IWriteRequest {
  return promProto.WriteRequest.decode(data);
}
