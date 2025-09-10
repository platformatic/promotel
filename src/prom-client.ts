/**
 * Prom-client registry integration
 *
 * Converts prom-client registry metrics directly into Prometheus protobuf WriteRequest objects.
 */

import type { Registry } from 'prom-client';
import { register } from 'prom-client';
import type { prometheus } from '../proto/protobuf.js';
import { parse } from './parser.js';
import { PrometheusParseError } from './errors.js';

/**
 * Options for fetching metrics from a prom-client registry
 */
export interface PromClientOptions {
  /** Prom-client registry instance (defaults to default registry) */
  registry?: Registry;
  /** Content type for metrics format (optional, defaults to registry default) */
  contentType?: string;
}

/**
 * Convert prom-client registry metrics to Prometheus protobuf WriteRequest
 */
export async function getFromRegistry(options: PromClientOptions = {}): Promise<prometheus.IWriteRequest> {
  const { registry = register } = options;
  
  try {
    // Get metrics in text format from the registry
    const metricsText = await registry.metrics();
    
    // Parse the text format directly to Prometheus protobuf WriteRequest
    return parse(metricsText);
    
  } catch (error) {
    throw new PrometheusParseError(
      `Failed to get metrics from prom-client registry: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

