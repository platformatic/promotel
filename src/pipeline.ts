/**
 * Unified metrics pipeline for Prometheus to OTLP conversion
 * 
 * Provides a common abstraction for collecting metrics, converting to OTLP,
 * and pushing to endpoints with configurable data sources.
 */

import type { prometheus } from '../proto/protobuf.js';
import { convert } from './otlp.js';
import { dispatch, type OTLPEndpointOptions } from './http-client.js';
import { OTLPConversionError } from './errors.js';
import type { ConversionOptions } from './otlp.js';

/**
 * Interface for different metrics data sources
 */
export interface MetricsSource {
  /**
   * Fetch metrics data as a Prometheus WriteRequest
   */
  fetch(): Promise<prometheus.IWriteRequest>;
}

/**
 * Configuration options for the metrics pipeline
 */
export interface MetricsPipelineOptions {
  /** The metrics data source */
  source: MetricsSource;
  /** OTLP endpoint configuration */
  otlpEndpoint: string | OTLPEndpointOptions;
  /** Interval in milliseconds between collections (default: 60000) */
  interval?: number;
  /** Conversion options for Prometheus to OTLP conversion */
  conversionOptions?: ConversionOptions;
  /** Error handler for pipeline failures */
  onError?: (error: Error) => void;
}

/**
 * Unified metrics pipeline that handles the full flow:
 * Metrics Source → Prometheus Protobuf → OTLP Conversion → Push to Endpoint
 */
export class MetricsPipeline {
  private source: MetricsSource;
  private otlpEndpoint: OTLPEndpointOptions;
  private interval: number;
  private conversionOptions: ConversionOptions;
  private onError: (error: Error) => void;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(options: MetricsPipelineOptions) {
    this.source = options.source;
    this.otlpEndpoint = typeof options.otlpEndpoint === 'string'
      ? { url: options.otlpEndpoint }
      : options.otlpEndpoint;
    this.interval = options.interval || 60000;
    this.conversionOptions = options.conversionOptions || {};
    this.onError = options.onError || ((error) => {
      throw error;
    });
  }

  /**
   * Start the pipeline - begins periodic collection and conversion
   */
  start(): void {
    if (this.isRunning) {
      throw new OTLPConversionError('Pipeline is already running', 'pipeline_already_running');
    }

    this.isRunning = true;
    
    // Run immediately, then on interval
    this.collectAndPush().catch(this.onError);
    
    this.intervalId = setInterval(() => {
      this.collectAndPush().catch(this.onError);
    }, this.interval);
  }

  /**
   * Stop the pipeline - stops periodic collection
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Manually trigger a single collection and push cycle
   */
  async collectAndPush(): Promise<void> {
    try {
      // Fetch metrics from the configured source
      const writeRequest = await this.source.fetch();
      
      // Convert WriteRequest to OTLP
      const otlpData = convert(writeRequest, this.conversionOptions);
      
      // Dispatch to OTLP endpoint
      await dispatch(otlpData, this.otlpEndpoint);
      
    } catch (error) {
      throw new OTLPConversionError(
        `Failed to collect and push metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'pipeline_execution_error'
      );
    }
  }

  /**
   * Check if the pipeline is currently running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Get current configuration
   */
  get config(): {
    otlpEndpoint: OTLPEndpointOptions;
    interval: number;
    conversionOptions: ConversionOptions;
  } {
    return {
      otlpEndpoint: this.otlpEndpoint,
      interval: this.interval,
      conversionOptions: this.conversionOptions,
    };
  }
}