/**
 * PromClientBridge - In-process conversion class for prom-client registries
 */

import type { Registry } from 'prom-client';
import type { prometheus } from '../proto/protobuf.js';
import { MetricsPipeline, type MetricsSource } from './pipeline.js';
import { getFromRegistry } from './prom-client.js';
import type { OTLPEndpointOptions } from './http-client.js';
import type { ConversionOptions } from './otlp.js';

/**
 * Metrics source that fetches from a prom-client registry
 */
class RegistrySource implements MetricsSource {
  private registry: Registry;

  constructor(registry: Registry) {
    this.registry = registry;
  }

  async fetch(): Promise<prometheus.IWriteRequest> {
    return await getFromRegistry({ registry: this.registry });
  }
}

export interface PromClientBridgeOptions {
  /** prom-client registry to read metrics from */
  registry: Registry;
  /** OTLP endpoint to push metrics to */
  otlpEndpoint: string | OTLPEndpointOptions;
  /** Interval in milliseconds between metric collections (default: 60000) */
  interval?: number;
  /** Conversion options */
  conversionOptions?: ConversionOptions;
  /** Custom error handler */
  onError?: (error: Error) => void;
}

/**
 * Bridge class that automatically converts metrics from a prom-client registry 
 * and pushes them to an OTLP endpoint at regular intervals
 */
export class PromClientBridge extends MetricsPipeline {
  constructor(options: PromClientBridgeOptions) {
    const source = new RegistrySource(options.registry);
    
    super({
      source,
      otlpEndpoint: options.otlpEndpoint,
      ...(options.interval !== undefined && { interval: options.interval }),
      ...(options.conversionOptions && { conversionOptions: options.conversionOptions }),
      ...(options.onError && { onError: options.onError }),
    });
  }
}