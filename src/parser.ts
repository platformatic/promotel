/**
 * Prometheus text exposition format parser
 *
 * Parses Prometheus metrics from the text exposition format directly into
 * Prometheus protobuf WriteRequest objects.
 *
 * Reference: https://prometheus.io/docs/instrumenting/exposition_formats/#text-based-format
 */

import {
  createWriteRequest,
  createTimeSeries,
  createMetricMetadata,
  MetricType,
  createLabel,
  createSample
} from './prometheus-proto.js';
import type { prometheus } from '../proto/protobuf.js';
import { PrometheusParseError } from './errors.js';

/**
 * Parse Prometheus text exposition format into a Prometheus protobuf WriteRequest
 */
export function parse(text: string): prometheus.IWriteRequest {

  const lines = text.split('\n');
  const metricMetadata = new Map<string, prometheus.IMetricMetadata>();
  const timeSeriesByFamily = new Map<string, prometheus.ITimeSeries[]>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line || line.startsWith('#')) {
      // Handle help and type comments
      if (line && line.startsWith('# HELP ')) {
        const match = line.match(/^# HELP ([^\s]+) (.+)$/);
        if (match) {
          const [, metricName, help] = match;
          if (metricName && help) {
            const metadata = getOrCreateMetricMetadata(metricMetadata, metricName);
            metadata.help = help;
          }
        }
      } else if (line && line.startsWith('# TYPE ')) {
        const match = line.match(/^# TYPE ([^\s]+) ([^\s]+)$/);
        if (match) {
          const [, metricName, typeStr] = match;
          if (metricName && typeStr) {
            const metadata = getOrCreateMetricMetadata(metricMetadata, metricName);
            metadata.type = parseMetricType(typeStr);
          }
        }
      }
      continue;
    }

    try {
      if (parseAndAddMetricLine(line, timeSeriesByFamily, metricMetadata)) {
        // Line successfully parsed and added
      }
    } catch (error) {
      throw new PrometheusParseError(
        `Failed to parse line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
        line,
        i + 1
      );
    }
  }

  // Convert to WriteRequest
  const timeseries: prometheus.ITimeSeries[] = [];
  const metadata: prometheus.IMetricMetadata[] = [];

  // Add all metadata
  for (const [familyName, metadataObj] of metricMetadata) {
    const completeMetadata = createMetricMetadata({
      type: metadataObj.type || MetricType.UNKNOWN,
      metric_family_name: familyName,
      ...(metadataObj.help && { help: metadataObj.help }),
      ...(metadataObj.unit && { unit: metadataObj.unit })
    });
    metadata.push(completeMetadata);
  }

  // Add all time series
  for (const timeSeriesList of timeSeriesByFamily.values()) {
    for (const ts of timeSeriesList) {
      const timeSeriesObj = createTimeSeries({
        labels: ts.labels || [],
        samples: ts.samples || []
      });
      timeseries.push(timeSeriesObj);
    }
  }

  return createWriteRequest({ timeseries, metadata });
}

/**
 * Parse a single metric line and add it directly to the time series collections
 */
function parseAndAddMetricLine(
  line: string,
  timeSeriesByFamily: Map<string, prometheus.ITimeSeries[]>,
  metricMetadata: Map<string, prometheus.IMetricMetadata>
): boolean {
  // Match metric_name{label="value"} value [timestamp]
  const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[^}]*\})?) ([+-]?(?:\d*\.)?(?:\d+\.?\d*)?(?:[eE][+-]?\d+)?) ?(\d+)?$/);

  if (!match) {
    return false; // Skip invalid lines
  }

  const [, nameWithLabels, valueStr, timestampStr] = match;

  if (!nameWithLabels || !valueStr) {
    return false;
  }

  // Parse name and labels directly without custom return type
  const braceIndex = nameWithLabels.indexOf('{');
  const name = braceIndex === -1 ? nameWithLabels : nameWithLabels.slice(0, braceIndex);
  const labelsStr = braceIndex === -1 ? '' : nameWithLabels.slice(braceIndex + 1, -1);
  const labels = parseLabels(labelsStr);

  const value = parseFloat(valueStr);
  const timestamp = timestampStr ? parseInt(timestampStr, 10) : Date.now();

  if (isNaN(value)) {
    throw new Error(`Invalid value: ${valueStr}`);
  }

  // Add directly to time series collections
  const baseName = extractBaseMetricName(name);

  // Get or create time series list for this family
  if (!timeSeriesByFamily.has(baseName)) {
    timeSeriesByFamily.set(baseName, []);
  }
  const timeSeriesList = timeSeriesByFamily.get(baseName)!;

  // For histogram/summary metrics, we need to handle different suffixes properly
  let processedLabels = [...labels];

  // Add metric family name as synthetic label for OTLP conversion
  processedLabels.push(createLabel('__metric_name', baseName));

  // Add suffix information as a synthetic label for proper grouping
  if (name.endsWith('_sum')) {
    processedLabels.push(createLabel('__suffix', 'sum'));
  } else if (name.endsWith('_count')) {
    processedLabels.push(createLabel('__suffix', 'count'));
  } else if (name.endsWith('_bucket')) {
    processedLabels.push(createLabel('__suffix', 'bucket'));
  }

  // Find or create a time series with matching labels
  const labelKey = createLabelKey(processedLabels);
  let timeSeries = timeSeriesList.find((ts: prometheus.ITimeSeries) => createLabelKey(ts.labels || []) === labelKey);

  if (!timeSeries) {
    timeSeries = {
      labels: processedLabels,
      samples: []
    };
    timeSeriesList.push(timeSeries);
  }

  // Add the sample
  if (!timeSeries.samples) {
    timeSeries.samples = [];
  }
  timeSeries.samples.push(createSample(value, timestamp));

  // Infer metric type if not explicitly set
  const metadata = getOrCreateMetricMetadata(metricMetadata, baseName);
  if (metadata.type === MetricType.UNKNOWN) {
    metadata.type = inferMetricType(baseName, processedLabels);
  }

  return true;
}

/**
 * Parse labels from a string like 'label1="value1",label2="value2"'
 */
function parseLabels(labelsStr: string): prometheus.ILabel[] {
  const labels: prometheus.ILabel[] = [];

  if (!labelsStr.trim()) {
    return labels;
  }

  // Match label="value" pairs, handling escaped quotes
  const labelRegex = /([a-zA-Z_:][a-zA-Z0-9_:]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let match;

  while ((match = labelRegex.exec(labelsStr)) !== null) {
    const [, key, value] = match;
    if (key && value !== undefined) {
      // Unescape common escape sequences
      const unescapedValue = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
      labels.push(createLabel(key, unescapedValue));
    }
  }

  return labels;
}

/**
 * Extract base metric name from potentially suffixed names
 */
function extractBaseMetricName(name: string): string {
  // Remove histogram/summary suffixes but keep counter _total suffixes
  const suffixes = ['_bucket', '_count', '_sum'];

  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) {
      return name.slice(0, -suffix.length);
    }
  }

  return name;
}

/**
 * Get or create metric metadata
 */
function getOrCreateMetricMetadata(
  metricMetadata: Map<string, prometheus.IMetricMetadata>,
  name: string
): prometheus.IMetricMetadata {
  let metadata = metricMetadata.get(name);
  if (!metadata) {
    metadata = {
      type: MetricType.UNKNOWN,
      metric_family_name: name
    };
    metricMetadata.set(name, metadata);
  }
  return metadata;
}

/**
 * Create a stable key from labels for grouping
 */
function createLabelKey(labels: prometheus.ILabel[]): string {
  return labels
    .slice()
    .sort((a, b) => a.name!.localeCompare(b.name!))
    .map(l => `${l.name}=${l.value}`)
    .join(',');
}

/**
 * Parse metric type string to MetricType enum
 */
function parseMetricType(typeStr: string): MetricType {
  switch (typeStr.toLowerCase()) {
    case 'counter': return MetricType.COUNTER;
    case 'gauge': return MetricType.GAUGE;
    case 'histogram': return MetricType.HISTOGRAM;
    case 'summary': return MetricType.SUMMARY;
    case 'info': return MetricType.INFO;
    case 'stateset': return MetricType.STATESET;
    default: return MetricType.UNKNOWN;
  }
}

/**
 * Infer metric type from metric name and labels
 */
function inferMetricType(baseName: string, labels: prometheus.ILabel[]): MetricType {
  const hasHistogramSuffixes = labels.some(l => l.name === '__suffix' && (l.value === 'bucket' || l.value === 'sum' || l.value === 'count'));
  const hasQuantileLabels = labels.some(l => l.name === 'quantile');

  if (hasHistogramSuffixes && !hasQuantileLabels) {
    return MetricType.HISTOGRAM;
  }

  if (hasQuantileLabels) {
    return MetricType.SUMMARY;
  }

  // Check if it's likely a counter (monotonic, often ends with _total)
  if (baseName.endsWith('_total') || baseName.includes('count') || baseName.includes('requests')) {
    return MetricType.COUNTER;
  }

  // Default to gauge for simple numeric values
  return MetricType.GAUGE;
}
