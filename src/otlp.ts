/**
 * OTLP (OpenTelemetry Protocol) protobuf generation
 *
 * Converts Prometheus protobuf WriteRequest directly to OTLP protobuf format.
 */

import type { prometheus, opentelemetry } from '../proto/protobuf.js';
import Long from 'long';

/**
 * Conversion options
 */
export interface ConversionOptions {
  serviceName?: string;
  serviceVersion?: string;
  defaultTimestamp?: number; // Unix timestamp in milliseconds
}

function toNumber(value: number | Long | null | undefined, defaultValue: number): number {
  if (value == null) return defaultValue;
  if (typeof value === 'number') return value;
  return value.toNumber();
}


/**
 * Convert Prometheus WriteRequest to OTLP protobuf message format
 */
export function convert(
  writeRequest: prometheus.IWriteRequest,
  options: ConversionOptions = {}
): opentelemetry.proto.collector.metrics.v1.IExportMetricsServiceRequest {
  const defaultTimestamp = options.defaultTimestamp || Date.now();
  const serviceName = options.serviceName || 'promotel-js';
  const serviceVersion = options.serviceVersion || '0.1.0';

  // Group metrics by metadata
  const metricsByFamily = new Map<string, {
    metadata?: prometheus.IMetricMetadata;
    timeSeries: prometheus.ITimeSeries[];
  }>();

  // Process metadata
  if (writeRequest.metadata && Array.isArray(writeRequest.metadata)) {
    for (const metadata of writeRequest.metadata) {
      if (!metricsByFamily.has(metadata.metric_family_name!)) {
        metricsByFamily.set(metadata.metric_family_name!, {
          metadata,
          timeSeries: []
        });
      } else {
        const family = metricsByFamily.get(metadata.metric_family_name!)!;
        family.metadata = metadata;
      }
    }
  }

  // Process time series
  if (writeRequest.timeseries && Array.isArray(writeRequest.timeseries)) {
    for (const timeSeries of writeRequest.timeseries) {
      // Determine metric family name from labels
      const metricFamilyName = determineMetricFamilyName(timeSeries);

      if (!metricsByFamily.has(metricFamilyName)) {
        metricsByFamily.set(metricFamilyName, {
          timeSeries: []
        });
      }

      metricsByFamily.get(metricFamilyName)!.timeSeries.push(timeSeries);
    }
  }

  // Convert to OTLP metrics
  const otlpMetrics = [];
  for (const [familyName, family] of metricsByFamily) {
    const metric = convertFamilyToOTLPMetric(familyName, family, defaultTimestamp);
    if (metric) {
      otlpMetrics.push(metric);
    }
  }

  const scopeMetrics = {
    scope: {
      name: serviceName,
      version: serviceVersion,
    },
    metrics: otlpMetrics,
  };

  const resourceMetrics = {
    resource: {
      attributes: [
        { key: 'service.name', value: { string_value: serviceName } },
        { key: 'service.version', value: { string_value: serviceVersion } },
      ],
    },
    scope_metrics: [scopeMetrics],
  };

  return {
    resource_metrics: [resourceMetrics],
  };
}

/**
 * Convert a metric family to OTLP metric
 */
function convertFamilyToOTLPMetric(
  familyName: string,
  family: { metadata?: prometheus.IMetricMetadata; timeSeries: prometheus.ITimeSeries[] },
  defaultTimestamp: number
): opentelemetry.proto.metrics.v1.IMetric | null {
  if (!family.timeSeries || family.timeSeries.length === 0) {
    return null;
  }

  const metricType = family.metadata?.type || 2; // Default to GAUGE
  const help = family.metadata?.help;
  const unit = family.metadata?.unit;

  const otlpMetric: opentelemetry.proto.metrics.v1.IMetric = {
    name: familyName,
  };

  if (help) {
    otlpMetric.description = help;
  }

  if (unit) {
    otlpMetric.unit = unit;
  }

  switch (metricType) {
    case 1: // COUNTER
      otlpMetric.sum = createSumData(family.timeSeries, defaultTimestamp, true);
      break;

    case 2: // GAUGE
      otlpMetric.gauge = createGaugeData(family.timeSeries, defaultTimestamp);
      break;

    case 3: // HISTOGRAM
      otlpMetric.histogram = createHistogramData(family.timeSeries, defaultTimestamp);
      break;

    case 5: // SUMMARY
      otlpMetric.summary = createSummaryData(family.timeSeries, defaultTimestamp);
      break;

    default:
      // Treat unknown as gauge
      otlpMetric.gauge = createGaugeData(family.timeSeries, defaultTimestamp);
      break;
  }

  return otlpMetric;
}

/**
 * Create OTLP Sum data (for counters)
 */
function createSumData(timeSeries: prometheus.ITimeSeries[], defaultTimestamp: number, isMonotonic: boolean) {
  const dataPoints = timeSeries.flatMap(ts =>
    (ts.samples || []).map((sample: prometheus.ISample) => ({
      attributes: labelsToAttributes(ts.labels || []),
      time_unix_nano: timestampToNano(Number(sample.timestamp) || defaultTimestamp),
      as_double: sample.value ?? null,
    }))
  );

  return {
    data_points: dataPoints,
    aggregation_temporality: 2, // CUMULATIVE
    is_monotonic: isMonotonic,
  };
}

/**
 * Create OTLP Gauge data
 */
function createGaugeData(timeSeries: prometheus.ITimeSeries[], defaultTimestamp: number) {
  const dataPoints = timeSeries.flatMap(ts =>
    (ts.samples || []).map((sample: prometheus.ISample) => ({
      attributes: labelsToAttributes(ts.labels || []),
      time_unix_nano: timestampToNano(Number(sample.timestamp) || defaultTimestamp),
      as_double: sample.value ?? null,
    }))
  );

  return {
    data_points: dataPoints,
  };
}

/**
 * Create OTLP Histogram data
 */
function createHistogramData(timeSeries: prometheus.ITimeSeries[], defaultTimestamp: number): opentelemetry.proto.metrics.v1.IHistogram {
  // Group by label set (excluding special labels) and build data points directly
  const dataPointsMap = new Map<string, opentelemetry.proto.metrics.v1.IHistogramDataPoint>();

  for (const ts of timeSeries) {
    const labels = (ts.labels || []).filter((l: prometheus.ILabel) => !l.name?.startsWith('__') && l.name !== 'le');
    const suffixLabel = (ts.labels || []).find((l: prometheus.ILabel) => l.name === '__suffix');
    const leLabel = (ts.labels || []).find((l: prometheus.ILabel) => l.name === 'le');

    const labelKey = labels.map((l: prometheus.ILabel) => `${l.name}=${l.value}`).sort().join(',');

    if (!dataPointsMap.has(labelKey)) {
      dataPointsMap.set(labelKey, {
        attributes: labelsToAttributes(labels),
        time_unix_nano: timestampToNano(defaultTimestamp),
        count: 0,
        sum: 0,
        bucket_counts: [],
        explicit_bounds: [],
      });
    }

    const dataPoint = dataPointsMap.get(labelKey)!;
    const buckets: { bound: number; count: number }[] = [];

    for (const sample of ts.samples || []) {
      if (suffixLabel?.value === 'bucket' && leLabel) {
        const bound = leLabel.value === '+Inf' ? Infinity : parseFloat(leLabel.value!);
        buckets.push({ bound, count: sample.value! });
      } else if (suffixLabel?.value === 'sum') {
        dataPoint.sum = sample.value!;
      } else if (suffixLabel?.value === 'count') {
        dataPoint.count = sample.value!;
      }

      dataPoint.time_unix_nano = timestampToNano(toNumber(sample.timestamp, defaultTimestamp));
    }

    // Sort buckets and populate arrays
    if (buckets.length > 0) {
      const sortedBuckets = buckets.sort((a, b) => a.bound - b.bound);
      dataPoint.bucket_counts = sortedBuckets.map(bucket => bucket.count);
      dataPoint.explicit_bounds = sortedBuckets
        .filter(bucket => bucket.bound !== Infinity)
        .map(bucket => bucket.bound);
    }
  }

  return {
    data_points: Array.from(dataPointsMap.values()),
    aggregation_temporality: 2, // CUMULATIVE
  };
}

/**
 * Create OTLP Summary data
 */
function createSummaryData(timeSeries: prometheus.ITimeSeries[], defaultTimestamp: number): opentelemetry.proto.metrics.v1.ISummary {
  // Group by label set (excluding special labels) and build data points directly
  const dataPointsMap = new Map<string, opentelemetry.proto.metrics.v1.ISummaryDataPoint>();

  for (const ts of timeSeries) {
    const labels = (ts.labels || []).filter((l: prometheus.ILabel) => !l.name?.startsWith('__') && l.name !== 'quantile');
    const suffixLabel = (ts.labels || []).find((l: prometheus.ILabel) => l.name === '__suffix');
    const quantileLabel = (ts.labels || []).find((l: prometheus.ILabel) => l.name === 'quantile');

    const labelKey = labels.map((l: prometheus.ILabel) => `${l.name}=${l.value}`).sort().join(',');

    if (!dataPointsMap.has(labelKey)) {
      dataPointsMap.set(labelKey, {
        attributes: labelsToAttributes(labels),
        time_unix_nano: timestampToNano(defaultTimestamp),
        count: 0,
        sum: 0,
        quantile_values: [],
      });
    }

    const dataPoint = dataPointsMap.get(labelKey)!;

    for (const sample of ts.samples || []) {
      if (quantileLabel && !suffixLabel) {
        const quantile = parseFloat(quantileLabel.value!);
        // Add to existing quantile_values array
        dataPoint.quantile_values!.push({ quantile, value: sample.value! });
      } else if (suffixLabel?.value === 'sum') {
        dataPoint.sum = sample.value!;
      } else if (suffixLabel?.value === 'count') {
        dataPoint.count = sample.value!;
      }

      dataPoint.time_unix_nano = timestampToNano(toNumber(sample.timestamp, defaultTimestamp));
    }
  }

  // Sort quantiles for all data points
  for (const dataPoint of dataPointsMap.values()) {
    if (dataPoint.quantile_values && dataPoint.quantile_values.length > 0) {
      dataPoint.quantile_values.sort((a, b) => (a.quantile || 0) - (b.quantile || 0));
    }
  }

  return {
    data_points: Array.from(dataPointsMap.values()),
  };
}

/**
 * Convert Prometheus labels to OTLP attributes
 */
function labelsToAttributes(labels: prometheus.ILabel[]): opentelemetry.proto.common.v1.IKeyValue[] {
  return (labels || [])
    .filter((label: prometheus.ILabel) => !label.name?.startsWith('__'))
    .map((label: prometheus.ILabel) => ({
      key: label.name!,
      value: { string_value: label.value! },
    }));
}

/**
 * Convert timestamp from milliseconds to nanoseconds
 */
function timestampToNano(timestampMs: number): Long {
  const nanos = timestampMs * 1_000_000;
  return Long.fromNumber(nanos);
}

/**
 * Determine metric family name from time series labels
 */
function determineMetricFamilyName(timeSeries: prometheus.ITimeSeries): string {
  // Look for synthetic __metric_name label added by parser
  const metricNameLabel = (timeSeries.labels || []).find((l: prometheus.ILabel) => l.name === '__metric_name');
  if (metricNameLabel) {
    return metricNameLabel.value!;
  }

  // Fallback to unknown if no metric name label found
  return 'unknown_metric';
}
