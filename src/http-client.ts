/**
 * HTTP client utilities for fetching from Prometheus endpoints and pushing to OTLP endpoints
 */

import { request } from 'undici';
import { OTLPConversionError } from './errors.js';
import protobuf from '../proto/protobuf.js';
import type { prometheus, opentelemetry } from '../proto/protobuf.js';

const { opentelemetry: otlpProto } = protobuf;
import { decodeWriteRequest } from './prometheus-proto.js';

export interface PrometheusEndpointOptions {
  url: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface OTLPEndpointOptions {
  url: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Gather Prometheus metrics from an HTTP endpoint with proper content negotiation.
 * Always returns Prometheus WriteRequest (protobuf format).
 * Handles both protobuf and text format responses internally.
 */
export async function gather(options: PrometheusEndpointOptions): Promise<prometheus.IWriteRequest> {
  const { url, signal, headers = {} } = options;

  try {
    const response = await request(url, {
      method: 'GET',
      headers: {
        // Content negotiation: prefer protobuf, fallback to text formats
        'Accept': 'application/vnd.google.protobuf;proto=io.prometheus.client.MetricFamily;encoding=delimited;q=1.0, text/plain;version=0.0.4;q=0.8, text/plain;q=0.4, */*;q=0.1',
        ...headers
      },
      signal
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new OTLPConversionError(
        `Failed to fetch Prometheus metrics: ${response.statusCode}`,
        'http_fetch_error'
      );
    }

    const contentType = response.headers['content-type'] as string || '';

    // Handle protobuf format
    if (contentType.includes('application/vnd.google.protobuf') || contentType.includes('application/x-protobuf')) {
      const protobufData = await response.body.arrayBuffer();
      return decodeWriteRequest(new Uint8Array(protobufData));
    }

    // Handle text formats - parse to protobuf WriteRequest
    if (contentType.includes('text/plain') || contentType.includes('text/')) {
      const textData = await response.body.text();
      const { parse } = await import('./parser.js');
      return parse(textData);
    }

    throw new OTLPConversionError(
      `Unsupported content-type: ${contentType}`,
      'invalid_content_type'
    );

  } catch (error) {
    if (error instanceof OTLPConversionError) {
      throw error;
    }

    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      throw new OTLPConversionError(
        'Request was aborted',
        'timeout'
      );
    }

    throw new OTLPConversionError(
      `Failed to fetch Prometheus metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'http_fetch_error'
    );
  }
}

/**
 * Dispatch OTLP metrics to an HTTP endpoint
 */
export async function dispatch(
  data: opentelemetry.proto.collector.metrics.v1.IExportMetricsServiceRequest | Uint8Array,
  options: OTLPEndpointOptions
): Promise<void> {
  // Handle both message object and encoded data
  const encodedData = data instanceof Uint8Array
    ? data
    : otlpProto.proto.collector.metrics.v1.ExportMetricsServiceRequest.encode(data).finish();
  const { url, signal, headers = {} } = options;

  try {
    const response = await request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-protobuf',
        ...headers
      },
      body: encodedData,
      signal
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const responseText = await response.body.text().catch(() => '');
      throw new OTLPConversionError(
        `Failed to push OTLP metrics: ${response.statusCode}${responseText ? ` - ${responseText}` : ''}`,
        'otlp_push_error'
      );
    }
  } catch (error) {
    if (error instanceof OTLPConversionError) {
      throw error;
    }

    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      throw new OTLPConversionError(
        'Request was aborted',
        'timeout'
      );
    }

    throw new OTLPConversionError(
      `Failed to push OTLP metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'otlp_push_error'
    );
  }
}
