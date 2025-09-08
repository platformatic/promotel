/**
 * Tests for index.ts exports
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import Long from 'long';
import { 
  encode,
  parse,
  convert,
  ConversionOptions,
  PrometheusParseError,
  OTLPConversionError,
  prometheus,
  opentelemetry
} from '../src/index.js';
import { createWriteRequest, createTimeSeries, createSample, createLabel } from '../src/prometheus-proto.js';

describe('Index Exports', () => {
  
  describe('encode function', () => {
    
    it('should encode OTLP data to Uint8Array', () => {
      // Create minimal OTLP data
      const otlpData = {
        resource_metrics: [{
          resource: {
            attributes: [
              { key: 'service.name', value: { string_value: 'test-service' } }
            ]
          },
          scope_metrics: [{
            scope: { name: 'test-scope' },
            metrics: [{
              name: 'test_metric',
              gauge: {
                data_points: [{
                  as_double: 42,
                  time_unix_nano: Long.fromNumber(1640995200000 * 1000000)
                }]
              }
            }]
          }]
        }]
      };
      
      const encoded = encode(otlpData);
      
      assert.ok(encoded instanceof Uint8Array, 'Should return Uint8Array');
      assert.ok(encoded.length > 0, 'Should have non-zero length');
    });
    
    it('should encode empty OTLP data', () => {
      const emptyOtlpData = { resource_metrics: [] };
      
      const encoded = encode(emptyOtlpData);
      
      assert.ok(encoded instanceof Uint8Array, 'Should return Uint8Array for empty data');
      assert.ok(encoded.length >= 0, 'Should handle empty data encoding');
    });
    
    it('should handle complex OTLP data', () => {
      const complexOtlpData = {
        resource_metrics: [{
          resource: {
            attributes: [
              { key: 'service.name', value: { string_value: 'complex-service' } },
              { key: 'service.version', value: { string_value: '1.2.3' } }
            ]
          },
          scope_metrics: [{
            scope: { name: 'complex-scope', version: '2.0.0' },
            metrics: [
              {
                name: 'counter_metric',
                sum: {
                  data_points: [{ as_double: 100, time_unix_nano: Long.fromNumber(1640995200000 * 1000000) }],
                  aggregation_temporality: 2,
                  is_monotonic: true
                }
              },
              {
                name: 'gauge_metric',
                gauge: {
                  data_points: [{ as_double: 50, time_unix_nano: Long.fromNumber(1640995200000 * 1000000) }]
                }
              }
            ]
          }]
        }]
      };
      
      const encoded = encode(complexOtlpData);
      
      assert.ok(encoded instanceof Uint8Array, 'Should encode complex data');
      assert.ok(encoded.length > 100, 'Complex data should produce substantial output');
    });
    
  });
  
  describe('Exported types and classes', () => {
    
    it('should export ConversionOptions type', () => {
      // Test that the type can be used
      const options: ConversionOptions = {
        serviceName: 'test-service',
        serviceVersion: '1.0.0',
        defaultTimestamp: Date.now()
      };
      
      assert.strictEqual(options.serviceName, 'test-service');
      assert.strictEqual(options.serviceVersion, '1.0.0');
      assert.ok(typeof options.defaultTimestamp === 'number');
    });
    
    it('should export PrometheusParseError', () => {
      const error = new PrometheusParseError('Test parse error', 'bad line', 42);
      
      assert.ok(error instanceof PrometheusParseError);
      assert.strictEqual(error.name, 'PrometheusParseError');
      assert.strictEqual(error.message, 'Test parse error');
      assert.strictEqual(error.line, 'bad line');
      assert.strictEqual(error.lineNumber, 42);
    });
    
    it('should export OTLPConversionError', () => {
      const error = new OTLPConversionError('Test conversion error', 'test_metric');
      
      assert.ok(error instanceof OTLPConversionError);
      assert.strictEqual(error.name, 'OTLPConversionError');
      assert.strictEqual(error.message, 'Test conversion error');
      assert.strictEqual(error.metric, 'test_metric');
    });
    
    it('should export protobuf types', () => {
      assert.ok(prometheus, 'Should export prometheus types');
      assert.ok(opentelemetry, 'Should export opentelemetry types');
      
      // Test that we can use the types
      assert.ok(prometheus.WriteRequest, 'Should have WriteRequest constructor');
      assert.ok(opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest, 'Should have OTLP request constructor');
    });
    
  });
  
  describe('Integration of exported functions', () => {
    
    it('should work together: parse -> convert -> encode', () => {
      // Test the full pipeline using exported functions
      const prometheusText = `
# HELP test_counter A test counter
# TYPE test_counter counter
test_counter{label="value"} 42
`;
      
      // Parse
      const writeRequest = parse(prometheusText);
      assert.ok(writeRequest.timeseries, 'Parse should return timeseries');
      assert.strictEqual(writeRequest.timeseries.length, 1);
      
      // Convert
      const otlpData = convert(writeRequest, {
        serviceName: 'integration-test',
        serviceVersion: '1.0.0'
      });
      assert.ok(otlpData.resource_metrics, 'Convert should return OTLP data');
      
      // Encode
      const encoded = encode(otlpData);
      assert.ok(encoded instanceof Uint8Array, 'Encode should return bytes');
      assert.ok(encoded.length > 0, 'Should have encoded data');
    });
    
    it('should handle empty metrics through the pipeline', () => {
      const emptyText = '# Empty metrics\n';
      
      const writeRequest = parse(emptyText);
      const otlpData = convert(writeRequest);
      const encoded = encode(otlpData);
      
      assert.ok(encoded instanceof Uint8Array, 'Should handle empty metrics');
    });
    
    it('should preserve metric data through the pipeline', () => {
      const prometheusText = `
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 1027
http_requests_total{method="POST",status="200"} 123

# HELP memory_usage_bytes Memory usage
# TYPE memory_usage_bytes gauge
memory_usage_bytes{instance="server1"} 1073741824
`;
      
      const writeRequest = parse(prometheusText);
      assert.strictEqual(writeRequest.timeseries.length, 3, 'Should parse 3 timeseries');
      
      const otlpData = convert(writeRequest, {
        serviceName: 'preservation-test'
      });
      
      const metrics = otlpData.resource_metrics![0].scope_metrics![0].metrics!;
      assert.strictEqual(metrics.length, 2, 'Should have 2 distinct metrics');
      
      // Find counter metric
      const counterMetric = metrics.find(m => m.name === 'http_requests_total');
      assert.ok(counterMetric, 'Should have counter metric');
      assert.ok(counterMetric.sum, 'Counter should be sum type');
      assert.strictEqual(counterMetric.sum.data_points!.length, 2, 'Counter should have 2 data points');
      
      // Find gauge metric
      const gaugeMetric = metrics.find(m => m.name === 'memory_usage_bytes');
      assert.ok(gaugeMetric, 'Should have gauge metric');
      assert.ok(gaugeMetric.gauge, 'Gauge should be gauge type');
      assert.strictEqual(gaugeMetric.gauge.data_points!.length, 1, 'Gauge should have 1 data point');
      
      const encoded = encode(otlpData);
      assert.ok(encoded.length > 200, 'Should produce substantial encoded data');
    });
    
  });
  
});