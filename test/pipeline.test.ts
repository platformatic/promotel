/**
 * Tests for MetricsPipeline class
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MetricsPipeline, type MetricsSource } from '../src/pipeline.js';
import type { prometheus } from '../proto/protobuf.js';
import { createWriteRequest, createTimeSeries, createSample, createLabel } from '../src/prometheus-proto.js';

// Mock metrics source for testing
class MockMetricsSource implements MetricsSource {
  private shouldThrow: boolean;
  private data: prometheus.IWriteRequest;

  constructor(shouldThrow = false, customData?: prometheus.IWriteRequest) {
    this.shouldThrow = shouldThrow;
    this.data = customData || createWriteRequest({
      timeseries: [
        createTimeSeries({
          labels: [createLabel('__metric_name', 'test_metric')],
          samples: [createSample(42, Date.now())]
        })
      ],
      metadata: []
    });
  }

  async fetch(): Promise<prometheus.IWriteRequest> {
    if (this.shouldThrow) {
      throw new Error('Mock source error');
    }
    return this.data;
  }

  updateData(data: prometheus.IWriteRequest): void {
    this.data = data;
  }

  setShouldThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }
}

describe('MetricsPipeline', () => {
  
  describe('Constructor and Configuration', () => {
    
    it('should create pipeline with string endpoint', () => {
      const source = new MockMetricsSource();
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://localhost:4318/v1/metrics'
      });

      assert.strictEqual(pipeline.running, false, 'Should not be running initially');
      
      const config = pipeline.config;
      assert.strictEqual(config.otlpEndpoint.url, 'http://localhost:4318/v1/metrics');
      assert.strictEqual(config.interval, 60000, 'Should use default interval');
      assert.deepStrictEqual(config.conversionOptions, {}, 'Should have empty conversion options by default');
    });

    it('should create pipeline with endpoint options object', () => {
      const source = new MockMetricsSource();
      const otlpEndpoint = {
        url: 'http://collector:4318/v1/metrics',
        headers: { 'x-api-key': 'secret' }
      };
      
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint,
        interval: 30000,
        conversionOptions: {
          serviceName: 'test-service',
          serviceVersion: '1.0.0'
        }
      });

      const config = pipeline.config;
      assert.strictEqual(config.otlpEndpoint.url, 'http://collector:4318/v1/metrics');
      assert.deepStrictEqual(config.otlpEndpoint.headers, { 'x-api-key': 'secret' });
      assert.strictEqual(config.interval, 30000);
      assert.strictEqual(config.conversionOptions.serviceName, 'test-service');
      assert.strictEqual(config.conversionOptions.serviceVersion, '1.0.0');
    });
    
  });

  describe('Lifecycle Management', () => {
    
    it('should handle start/stop lifecycle correctly', () => {
      const source = new MockMetricsSource();
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://httpbin.org/post',
        interval: 300000 // Long interval to avoid automatic triggers
      });

      // Initially not running
      assert.strictEqual(pipeline.running, false);

      // Start pipeline
      pipeline.start();
      assert.strictEqual(pipeline.running, true);

      // Should throw if started again
      assert.throws(
        () => pipeline.start(),
        /already running/i,
        'Should throw if started twice'
      );

      // Stop pipeline
      pipeline.stop();
      assert.strictEqual(pipeline.running, false);

      // Should be safe to stop again
      pipeline.stop(); // Should not throw
      assert.strictEqual(pipeline.running, false);
    });

    it('should stop pipeline even if not started', () => {
      const source = new MockMetricsSource();
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://httpbin.org/post'
      });

      // Should be safe to stop when not running
      assert.doesNotThrow(() => pipeline.stop());
      assert.strictEqual(pipeline.running, false);
    });
    
  });

  describe('Manual Collection', () => {
    
    it('should perform manual collect and push successfully', async () => {
      const source = new MockMetricsSource();
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://httpbin.org/post', // Use httpbin for reliable testing
        conversionOptions: {
          serviceName: 'pipeline-test'
        }
      });

      // Manual collection should work
      await pipeline.collectAndPush();
      
      // Should still not be running (manual collection doesn't start interval)
      assert.strictEqual(pipeline.running, false);
    });

    it('should handle source fetch errors', async () => {
      const source = new MockMetricsSource(true); // Will throw on fetch
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://httpbin.org/post'
      });

      await assert.rejects(
        async () => await pipeline.collectAndPush(),
        /Failed to collect and push metrics.*Mock source error/i,
        'Should propagate source errors'
      );
    });

    it('should handle OTLP push errors', async () => {
      const source = new MockMetricsSource();
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://localhost:9999/v1/metrics' // Invalid endpoint
      });

      await assert.rejects(
        async () => await pipeline.collectAndPush(),
        /Failed to collect and push metrics/i,
        'Should handle push errors'
      );
    });
    
  });

  describe('Error Handling', () => {
    
    it('should call error handler for collection failures when running', async () => {
      const source = new MockMetricsSource();
      let capturedError: Error | null = null;
      
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://localhost:9999/v1/metrics', // Invalid endpoint
        interval: 100, // Very short interval
        onError: (error) => {
          capturedError = error;
        }
      });

      // Start pipeline
      pipeline.start();
      
      // Wait for error to occur
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Stop pipeline
      pipeline.stop();
      
      // Should have captured an error
      assert.ok(capturedError, 'Should have captured an error');
      assert.ok(capturedError.message.includes('Failed to collect and push'), 'Error should be about collection failure');
    });

    it('should throw errors when no error handler is provided', async () => {
      const source = new MockMetricsSource(true); // Will throw on fetch
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://httpbin.org/post'
        // No onError handler
      });

      await assert.rejects(
        async () => await pipeline.collectAndPush(),
        /Failed to collect and push metrics.*Mock source error/i,
        'Should throw when no error handler is provided'
      );
    });
    
  });

  describe('Data Flow', () => {
    
    it('should properly convert and transmit different metric types', async () => {
      // Create realistic test data with different metric types
      const testData = createWriteRequest({
        timeseries: [
          // Counter
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'http_requests_total'),
              createLabel('method', 'GET'),
              createLabel('status', '200')
            ],
            samples: [createSample(100, Date.now())]
          }),
          // Gauge  
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'memory_usage_bytes'),
              createLabel('instance', 'server1')
            ],
            samples: [createSample(1024000, Date.now())]
          })
        ],
        metadata: []
      });

      const source = new MockMetricsSource(false, testData);
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://httpbin.org/post',
        conversionOptions: {
          serviceName: 'data-flow-test',
          serviceVersion: '2.0.0'
        }
      });

      // Should successfully collect and convert the data
      await pipeline.collectAndPush();
    });

    it('should handle empty metrics gracefully', async () => {
      const emptyData = createWriteRequest({ timeseries: [], metadata: [] });
      const source = new MockMetricsSource(false, emptyData);
      
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://httpbin.org/post'
      });

      // Should handle empty data without errors
      await pipeline.collectAndPush();
    });
    
  });

  describe('Custom Sources', () => {
    
    it('should work with custom metrics sources', async () => {
      class CustomSource implements MetricsSource {
        async fetch(): Promise<prometheus.IWriteRequest> {
          // Simulate custom data source (e.g., database, file, etc.)
          return createWriteRequest({
            timeseries: [
              createTimeSeries({
                labels: [
                  createLabel('__metric_name', 'custom_metric'),
                  createLabel('source', 'database')
                ],
                samples: [createSample(999, Date.now())]
              })
            ],
            metadata: []
          });
        }
      }

      const source = new CustomSource();
      const pipeline = new MetricsPipeline({
        source,
        otlpEndpoint: 'http://httpbin.org/post',
        conversionOptions: {
          serviceName: 'custom-source-test'
        }
      });

      // Should work with any source that implements the interface
      await pipeline.collectAndPush();
    });
    
  });
  
});