/**
 * Tests for OTLP conversion and message structure validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  convert,
  parse,
  encode
} from '../src/index.js';

describe('OTLP Conversion', () => {
  
  describe('Message Structure Validation', () => {
    
    it('should generate correct histogram OTLP data structure', () => {
      const prometheusText = `
# HELP http_request_duration_seconds HTTP request duration
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} 100
http_request_duration_seconds_bucket{le="0.5"} 150
http_request_duration_seconds_bucket{le="1.0"} 180
http_request_duration_seconds_bucket{le="+Inf"} 200
http_request_duration_seconds_sum 45.2
http_request_duration_seconds_count 200
`;
      
      const writeRequest = parse(prometheusText);
      const otlpData = convert(writeRequest);
      
      // Validate structure
      assert.ok(otlpData.resource_metrics, 'Should have resource_metrics');
      assert.ok(Array.isArray(otlpData.resource_metrics), 'resource_metrics should be array');
      assert.strictEqual(otlpData.resource_metrics!.length, 1, 'Should have 1 resource');
      
      const resource = otlpData.resource_metrics![0]!;
      assert.ok(resource.scope_metrics, 'Should have scope_metrics');
      assert.strictEqual(resource.scope_metrics!.length, 1, 'Should have 1 scope');
      
      const scope = resource.scope_metrics![0]!;
      assert.ok(scope.metrics, 'Should have metrics');
      assert.strictEqual(scope.metrics!.length, 1, 'Should have 1 metric');
      
      const metric = scope.metrics![0]!;
      assert.strictEqual(metric.name, 'http_request_duration_seconds');
      assert.strictEqual(metric.description, 'HTTP request duration');
      assert.ok(metric.histogram, 'Should have histogram data');
    });
    
    it('should generate correct summary OTLP data structure', () => {
      const prometheusText = `
# HELP response_time_seconds Response time summary
# TYPE response_time_seconds summary
response_time_seconds{quantile="0.5"} 0.1
response_time_seconds{quantile="0.9"} 0.3
response_time_seconds{quantile="0.99"} 0.8
response_time_seconds_sum 12.5
response_time_seconds_count 100
`;
      
      const writeRequest = parse(prometheusText);
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0]!.scope_metrics![0]!.metrics![0]!;
      assert.strictEqual(metric.name, 'response_time_seconds');
      assert.ok(metric.summary, 'Should have summary data');
      
      const summary = metric.summary!;
      assert.ok(summary.data_points, 'Should have data_points');
      assert.strictEqual(summary.data_points!.length, 1, 'Should have 1 data point');
      
      const dataPoint = summary.data_points![0]!;
      assert.strictEqual(dataPoint.count, 100, 'Count should be 100');
      assert.strictEqual(dataPoint.sum, 12.5, 'Sum should be 12.5');
      assert.ok(dataPoint.quantile_values, 'Should have quantile_values');
      assert.strictEqual(dataPoint.quantile_values!.length, 3, 'Should have 3 quantiles');
    });
    
    it('should generate correct counter OTLP data structure', () => {
      const prometheusText = `
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 1027
http_requests_total{method="POST",status="200"} 123
`;
      
      const writeRequest = parse(prometheusText);
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0]!.scope_metrics![0]!.metrics![0]!;
      assert.strictEqual(metric.name, 'http_requests_total');
      assert.ok(metric.sum, 'Should have sum data (for counter)');
      
      const sum = metric.sum!;
      assert.strictEqual(sum.is_monotonic, true, 'Counter should be monotonic');
      assert.strictEqual(sum.aggregation_temporality, 2, 'Should be CUMULATIVE');
      assert.ok(sum.data_points, 'Should have data_points');
      assert.strictEqual(sum.data_points!.length, 2, 'Should have 2 data points');
      
      const dataPoint1 = sum.data_points![0]!;
      assert.strictEqual(dataPoint1.as_double, 1027, 'First value should be 1027');
      assert.ok(dataPoint1.attributes, 'Should have attributes');
      assert.strictEqual(dataPoint1.attributes!.length, 2, 'Should have 2 attributes');
      
      const dataPoint2 = sum.data_points![1]!;
      assert.strictEqual(dataPoint2.as_double, 123, 'Second value should be 123');
    });
    
    it('should generate correct gauge OTLP data structure', () => {
      const prometheusText = `
# HELP memory_usage_bytes Current memory usage
# TYPE memory_usage_bytes gauge
memory_usage_bytes{instance="server1"} 52428800
memory_usage_bytes{instance="server2"} 48234567
`;
      
      const writeRequest = parse(prometheusText);
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0]!.scope_metrics![0]!.metrics![0]!;
      assert.strictEqual(metric.name, 'memory_usage_bytes');
      assert.ok(metric.gauge, 'Should have gauge data');
      
      const gauge = metric.gauge!;
      assert.ok(gauge.data_points, 'Should have data_points');
      assert.strictEqual(gauge.data_points!.length, 2, 'Should have 2 data points');
      
      const dataPoint = gauge.data_points![0]!;
      assert.ok(dataPoint.as_double !== undefined, 'Should have as_double value');
      assert.ok(dataPoint.attributes, 'Should have attributes');
      assert.strictEqual(dataPoint.attributes!.length, 1, 'Should have 1 attribute');
      
      const attribute = dataPoint.attributes![0]!;
      assert.strictEqual(attribute.key, 'instance', 'Attribute key should be instance');
      assert.strictEqual(attribute.value!.string_value, 'server1', 'Attribute value should be server1');
    });
    
    it('should handle mixed metric types', () => {
      const prometheusText = `
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET"} 100

# HELP memory_usage_bytes Current memory usage  
# TYPE memory_usage_bytes gauge
memory_usage_bytes 52428800

# HELP request_duration_seconds Request duration
# TYPE request_duration_seconds histogram
request_duration_seconds_bucket{le="0.1"} 10
request_duration_seconds_bucket{le="+Inf"} 15
request_duration_seconds_sum 1.5
request_duration_seconds_count 15

# HELP response_time_seconds Response time
# TYPE response_time_seconds summary
response_time_seconds{quantile="0.5"} 0.1
response_time_seconds_sum 5.0
response_time_seconds_count 50
`;
      
      const writeRequest = parse(prometheusText);
      const otlpData = convert(writeRequest);
      
      // Should have 4 metrics total
      const metrics = otlpData.resource_metrics![0]!.scope_metrics![0]!.metrics!;
      assert.strictEqual(metrics.length, 4, 'Should have 4 metrics');
      
      // Verify each metric type is present
      const metricNames = metrics.map(m => m.name);
      assert.ok(metricNames.includes('http_requests_total'), 'Should have counter metric');
      assert.ok(metricNames.includes('memory_usage_bytes'), 'Should have gauge metric');
      assert.ok(metricNames.includes('request_duration_seconds'), 'Should have histogram metric');
      assert.ok(metricNames.includes('response_time_seconds'), 'Should have summary metric');
    });
    
  });
  
  describe('Encoding', () => {
    
    it('should encode OTLP message to bytes', () => {
      const prometheusText = `
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET"} 100
`;
      
      const writeRequest = parse(prometheusText);
      const otlpData = convert(writeRequest);
      const encoded = encode(otlpData);
      
      assert.ok(encoded instanceof Uint8Array, 'Should return Uint8Array');
      assert.ok(encoded.length > 0, 'Should have non-zero length');
    });
    
    it('should handle encoding of complex histogram data', () => {
      const prometheusText = `
# HELP http_request_duration_seconds HTTP request duration
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} 100
http_request_duration_seconds_bucket{le="0.5"} 150
http_request_duration_seconds_bucket{le="1.0"} 180
http_request_duration_seconds_bucket{le="+Inf"} 200
http_request_duration_seconds_sum 45.2
http_request_duration_seconds_count 200
`;
      
      const writeRequest = parse(prometheusText);
      const otlpData = convert(writeRequest);
      
      // Should not throw when encoding complex histogram data
      assert.doesNotThrow(() => {
        const encoded = encode(otlpData);
        assert.ok(encoded.length > 0, 'Should produce non-empty encoded data');
      });
    });
    
  });
  
});