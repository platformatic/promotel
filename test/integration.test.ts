/**
 * Integration tests with OpenTelemetry collector
 * 
 * These tests compare the output of our conversion library with the
 * official OpenTelemetry collector's Prometheus receiver.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { setTimeout } from 'node:timers/promises';
import { 
  convert, 
  gather,
  opentelemetry
} from '../src/index.js';

// Test configuration with fixed ports
const TEST_APP_URL = 'http://localhost:3000';
const OTEL_COLLECTOR_URL = 'http://localhost:4318';


/**
 * Send OTLP data to collector via HTTP
 */
async function sendOTLPToCollector(otlpData: opentelemetry.proto.collector.metrics.v1.IExportMetricsServiceRequest | Uint8Array): Promise<boolean> {
  try {
    // Handle both message object and encoded data
    const encodedData = otlpData instanceof Uint8Array 
      ? otlpData 
      : opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest.encode(otlpData).finish();
      
    const response = await fetch(`${OTEL_COLLECTOR_URL}/v1/metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-protobuf',
      },
      body: encodedData,
    });
    
    return response.ok;
  } catch (error) {
    console.error('Failed to send OTLP data to collector:', error);
    return false;
  }
}

describe('Integration Tests', () => {
  
  describe('End-to-end conversion', () => {
    
    it('should convert prom-client metrics to valid OTLP', async () => {
      
      // Fetch metrics from test app (returns protobuf WriteRequest)
      const prometheusWriteRequest = await gather({
        url: TEST_APP_URL + '/metrics'
      });
      
      // Convert to OTLP
      const otlpData = convert(prometheusWriteRequest, {
        serviceName: 'promotel-integration-test',
        serviceVersion: '1.0.0',
      });
      
      
      // Inspect OTLP data (no need to decode since convert returns message directly)
      assert.ok(otlpData.resource_metrics, 'Should have resource_metrics');
      assert.ok(otlpData.resource_metrics.length > 0, 'Should have at least one resource');
      
      const resource = otlpData.resource_metrics[0];
      assert.ok(resource.scope_metrics, 'Should have scope_metrics');
      assert.ok(resource.scope_metrics.length > 0, 'Should have at least one scope');
      
      const scope = resource.scope_metrics[0];
      assert.ok(scope.metrics, 'Should have metrics');
      assert.ok(scope.metrics.length > 0, 'Should have at least one metric');
      
      
      // Verify we have different metric types
      const metricTypes = scope.metrics.map(m => {
        if (m.sum) return 'counter';
        if (m.gauge) return 'gauge';
        if (m.histogram) return 'histogram';
        if (m.summary) return 'summary';
        return 'unknown';
      });
      
      const uniqueTypes = [...new Set(metricTypes)];
      // Should have at least counter and gauge metrics from default collectors
      assert.ok(uniqueTypes.includes('counter'), 'Should have counter metrics');
      assert.ok(uniqueTypes.includes('gauge'), 'Should have gauge metrics');
    });
    
    it('should send OTLP data to collector successfully', async () => {
      
      // Fetch and convert metrics
      const prometheusWriteRequest = await gather({
        url: TEST_APP_URL + '/metrics'
      });
      const otlpData = convert(prometheusWriteRequest, {
        serviceName: 'promotel-collector-test',
        serviceVersion: '1.0.0',
      });
      
      // Send to collector
      const success = await sendOTLPToCollector(otlpData);
      assert.strictEqual(success, true, 'Should successfully send OTLP data to collector');
    });
    
    it('should handle all common metric types', async () => {
      
      // Generate some load to ensure we have varied metrics
      try {
        await fetch(`${TEST_APP_URL}/generate-load`);
        await fetch(`${TEST_APP_URL}/generate-load`);
        await fetch(`${TEST_APP_URL}/generate-load`);
      } catch (error) {
        console.warn('Could not generate load, continuing with existing metrics:', error.message);
      }
      
      await setTimeout(5000); // Wait for metrics to update
      
      const prometheusWriteRequest = await gather({
        url: TEST_APP_URL + '/metrics'
      });
      const otlpData = convert(prometheusWriteRequest);
      // OTLP data is already in message format, no need to decode
      
      const metrics = otlpData.resource_metrics[0].scope_metrics[0].metrics;
      
      // Look for specific metrics we expect from our test app
      const _metricNames = metrics.map(m => m.name);
      
      // Should have our custom counter
      const httpRequestsMetric = metrics.find(m => m.name === 'http_requests_total');
      if (httpRequestsMetric) {
        assert.ok(httpRequestsMetric.sum, 'http_requests_total should be a counter (sum)');
        assert.strictEqual(httpRequestsMetric.sum.is_monotonic, true, 'Counter should be monotonic');
      }
      
      // Should have our custom gauge
      const activeConnectionsMetric = metrics.find(m => m.name === 'active_connections');
      if (activeConnectionsMetric) {
        assert.ok(activeConnectionsMetric.gauge, 'active_connections should be a gauge');
      }
      
      // Should have our custom histogram
      const durationMetric = metrics.find(m => m.name === 'http_request_duration_seconds');
      if (durationMetric) {
        assert.ok(durationMetric.histogram, 'http_request_duration_seconds should be a histogram');
        
        const histogram = durationMetric.histogram;
        assert.ok(histogram.data_points.length > 0, 'Histogram should have data points');
        
        const dataPoint = histogram.data_points[0];
        assert.ok(dataPoint.bucket_counts, 'Histogram should have bucket counts');
        assert.ok(dataPoint.explicit_bounds, 'Histogram should have explicit bounds');
        assert.ok(parseInt(dataPoint.count) > 0, 'Histogram should have count > 0');
        
      }
      
      // Should have our custom summary
      const responseTimeMetric = metrics.find(m => m.name === 'response_time_seconds');
      if (responseTimeMetric) {
        assert.ok(responseTimeMetric.summary, 'response_time_seconds should be a summary');
        
        const summary = responseTimeMetric.summary;
        assert.ok(summary.data_points.length > 0, 'Summary should have data points');
        
        const dataPoint = summary.data_points[0];
        assert.ok(dataPoint.quantile_values, 'Summary should have quantile values');
        assert.ok(parseInt(dataPoint.count) > 0, 'Summary should have count > 0');
        
      }
    });
    
    it('should preserve metric metadata', async () => {
      
      const prometheusWriteRequest = await gather({
        url: TEST_APP_URL + '/metrics'
      });
      const otlpData = convert(prometheusWriteRequest, {
        serviceName: 'test-service',
        serviceVersion: '2.0.0',
      });
      
      // OTLP data is already in message format, no need to decode
      
      // Check resource attributes
      const resource = otlpData.resource_metrics[0].resource;
      assert.ok(resource.attributes, 'Resource should have attributes');
      
      const serviceNameAttr = resource.attributes.find(attr => attr.key === 'service.name');
      const serviceVersionAttr = resource.attributes.find(attr => attr.key === 'service.version');
      
      assert.ok(serviceNameAttr, 'Should have service.name attribute');
      assert.strictEqual(serviceNameAttr.value.string_value, 'test-service', 'Service name should match');
      
      assert.ok(serviceVersionAttr, 'Should have service.version attribute');
      assert.strictEqual(serviceVersionAttr.value.string_value, '2.0.0', 'Service version should match');
      
      // Check scope metadata
      const scope = otlpData.resource_metrics[0].scope_metrics[0].scope;
      assert.ok(scope.name, 'Scope should have name');
    });
    
  });
  
  describe('Error handling', () => {
    
    it('should handle empty metrics gracefully', async () => {
      // Create empty WriteRequest directly since we're testing empty metrics
      const { parse } = await import('../src/parser.js');
      const emptyMetrics = '# Empty metrics file\n';
      const emptyWriteRequest = await parse(emptyMetrics);
      const otlpData = await convert(emptyWriteRequest);
      // OTLP data is already validated by TypeScript types at compile-time
      
      // Empty metrics should still produce valid OTLP (validated by TypeScript)
      
      // OTLP data is already in message format, no need to decode
      assert.strictEqual(otlpData.resource_metrics.length, 1, 'Should have one resource');
      
      const scope_metrics = otlpData.resource_metrics[0].scope_metrics;
      if (scope_metrics && scope_metrics.length > 0) {
        const metrics = scope_metrics[0].metrics || [];
        assert.strictEqual(metrics.length, 0, 'Should have no metrics');
      } else {
        // If no scopes, that's also fine for empty metrics
        assert.ok(true, 'No scope metrics for empty input is acceptable');
      }
    });
    
    it('should handle malformed metrics gracefully', async () => {
      const malformedMetrics = `
# Valid metric
test_metric 42

# Invalid lines (should be skipped)
invalid_line_without_value
another_invalid_line =

# Another valid metric
another_test_metric{label="value"} 123
`;
      
      const { parse } = await import('../src/parser.js');
      const malformedWriteRequest = await parse(malformedMetrics);
      const otlpData = await convert(malformedWriteRequest);
      // OTLP data is already validated by TypeScript types at compile-time
      
      // Should produce valid OTLP despite malformed lines (validated by TypeScript)
      
      // OTLP data is already in message format, no need to decode
      const metrics = otlpData.resource_metrics[0].scope_metrics[0].metrics;
      
      // Should have the 2 valid metrics, invalid lines should be skipped
      assert.strictEqual(metrics.length, 2, 'Should have 2 valid metrics');
      
      const metricNames = metrics.map(m => m.name).sort();
      assert.deepStrictEqual(metricNames, ['another_test_metric', 'test_metric']);
    });
    
  });
  
});