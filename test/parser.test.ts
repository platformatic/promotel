/**
 * Tests for Prometheus parser
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parse } from '../src/parser.js';

describe('Prometheus Parser', () => {
  
  describe('parse', () => {
    
    it('should parse simple counter metric', () => {
      const prometheusText = `
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 1027
http_requests_total{method="POST",status="200"} 123
`;
      
      const writeRequest = parse(prometheusText);
      
      assert.strictEqual(writeRequest.metadata.length, 1);
      assert.strictEqual(writeRequest.timeseries.length, 2);
      
      const metadata = writeRequest.metadata[0]!;
      assert.strictEqual(metadata.metric_family_name, 'http_requests_total');
      assert.strictEqual(metadata.type, 1); // COUNTER
      assert.strictEqual(metadata.help, 'Total HTTP requests');
      
      const firstTimeSeries = writeRequest.timeseries[0]!;
      assert.deepStrictEqual(firstTimeSeries.labels, [
        { name: 'method', value: 'GET' },
        { name: 'status', value: '200' },
        { name: '__metric_name', value: 'http_requests_total' }
      ]);
      assert.strictEqual(firstTimeSeries.samples.length, 1);
      assert.strictEqual(firstTimeSeries.samples[0]!.value, 1027);
      
      const secondTimeSeries = writeRequest.timeseries[1]!;
      assert.deepStrictEqual(secondTimeSeries.labels, [
        { name: 'method', value: 'POST' },
        { name: 'status', value: '200' },
        { name: '__metric_name', value: 'http_requests_total' }
      ]);
      assert.strictEqual(secondTimeSeries.samples.length, 1);
      assert.strictEqual(secondTimeSeries.samples[0]!.value, 123);
    });
    
    it('should parse gauge metric with timestamp', () => {
      const prometheusText = `
# HELP memory_usage_bytes Current memory usage
# TYPE memory_usage_bytes gauge
memory_usage_bytes{instance="server1"} 52428800 1640995200000
`;
      
      const writeRequest = parse(prometheusText);
      
      assert.strictEqual(writeRequest.metadata.length, 1);
      assert.strictEqual(writeRequest.timeseries.length, 1);
      
      const metadata = writeRequest.metadata[0]!;
      assert.strictEqual(metadata.metric_family_name, 'memory_usage_bytes');
      assert.strictEqual(metadata.type, 2); // GAUGE
      assert.strictEqual(metadata.help, 'Current memory usage');
      
      const timeSeries = writeRequest.timeseries[0]!;
      assert.deepStrictEqual(timeSeries.labels, [
        { name: 'instance', value: 'server1' },
        { name: '__metric_name', value: 'memory_usage_bytes' }
      ]);
      assert.strictEqual(timeSeries.samples.length, 1);
      assert.strictEqual(timeSeries.samples[0]!.value, 52428800);
      assert.strictEqual(timeSeries.samples[0]!.timestamp, 1640995200000);
    });
    
    it('should parse histogram metric', () => {
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
      
      assert.strictEqual(writeRequest.metadata.length, 1);
      assert.strictEqual(writeRequest.timeseries.length, 6);
      
      const metadata = writeRequest.metadata[0]!;
      assert.strictEqual(metadata.metric_family_name, 'http_request_duration_seconds');
      assert.strictEqual(metadata.type, 3); // HISTOGRAM
      assert.strictEqual(metadata.help, 'HTTP request duration');
      
      // Check bucket values - should have 'le' label
      const bucketTimeSeries = writeRequest.timeseries.filter(ts => ts.labels.some(l => l.name === 'le'));
      assert.strictEqual(bucketTimeSeries.length, 4);
      
      // Check sum and count values - should have synthetic __suffix labels
      const sumTimeSeries = writeRequest.timeseries.filter(ts => ts.labels.some(l => l.name === '__suffix' && l.value === 'sum'));
      const countTimeSeries = writeRequest.timeseries.filter(ts => ts.labels.some(l => l.name === '__suffix' && l.value === 'count'));
      assert.strictEqual(sumTimeSeries.length, 1);
      assert.strictEqual(countTimeSeries.length, 1);
      
      // Check specific values
      assert.strictEqual(sumTimeSeries[0]!.samples[0]!.value, 45.2);
      assert.strictEqual(countTimeSeries[0]!.samples[0]!.value, 200);
    });
    
    it('should parse summary metric', () => {
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
      
      assert.strictEqual(writeRequest.metadata.length, 1);
      assert.strictEqual(writeRequest.timeseries.length, 5);
      
      const metadata = writeRequest.metadata[0]!;
      assert.strictEqual(metadata.metric_family_name, 'response_time_seconds');
      assert.strictEqual(metadata.type, 5); // SUMMARY
      assert.strictEqual(metadata.help, 'Response time summary');
      
      // Check quantile values - should have 'quantile' label
      const quantileTimeSeries = writeRequest.timeseries.filter(ts => ts.labels.some(l => l.name === 'quantile'));
      assert.strictEqual(quantileTimeSeries.length, 3);
      
      // Check sum and count values - should have synthetic __suffix labels
      const sumTimeSeries = writeRequest.timeseries.filter(ts => ts.labels.some(l => l.name === '__suffix' && l.value === 'sum'));
      const countTimeSeries = writeRequest.timeseries.filter(ts => ts.labels.some(l => l.name === '__suffix' && l.value === 'count'));
      assert.strictEqual(sumTimeSeries.length, 1);
      assert.strictEqual(countTimeSeries.length, 1);
      
      // Check specific values
      assert.strictEqual(sumTimeSeries[0]!.samples[0]!.value, 12.5);
      assert.strictEqual(countTimeSeries[0]!.samples[0]!.value, 100);
    });
    
    it('should handle escaped label values', () => {
      const prometheusText = `
metric_with_escaped_labels{message="Line 1\\nLine 2",quote="\\"quoted\\"",backslash="\\\\"} 1
`;
      
      const writeRequest = parse(prometheusText);
      
      assert.strictEqual(writeRequest.metadata.length, 1);
      assert.strictEqual(writeRequest.timeseries.length, 1);
      
      const timeSeries = writeRequest.timeseries[0]!;
      const messageLabel = timeSeries.labels.find(l => l.name === 'message');
      const quoteLabel = timeSeries.labels.find(l => l.name === 'quote');
      const backslashLabel = timeSeries.labels.find(l => l.name === 'backslash');
      
      assert.strictEqual(messageLabel?.value, 'Line 1\nLine 2');
      assert.strictEqual(quoteLabel?.value, '"quoted"');
      assert.strictEqual(backslashLabel?.value, '\\');
    });
    
    it('should handle metrics without labels', () => {
      const prometheusText = `
simple_metric 42.0
`;
      
      const writeRequest = parse(prometheusText);
      
      assert.strictEqual(writeRequest.metadata.length, 1);
      assert.strictEqual(writeRequest.timeseries.length, 1);
      
      const metadata = writeRequest.metadata[0]!;
      assert.strictEqual(metadata.metric_family_name, 'simple_metric');
      
      const timeSeries = writeRequest.timeseries[0]!;
      assert.deepStrictEqual(timeSeries.labels, [
        { name: '__metric_name', value: 'simple_metric' }
      ]);
      assert.strictEqual(timeSeries.samples[0]!.value, 42.0);
    });
    
    it('should handle scientific notation', () => {
      const prometheusText = `
scientific_metric 1.23e+10
negative_exp_metric 4.56e-3
`;
      
      const writeRequest = parse(prometheusText);
      
      assert.strictEqual(writeRequest.metadata.length, 2);
      assert.strictEqual(writeRequest.timeseries.length, 2);
      assert.strictEqual(writeRequest.timeseries[0]!.samples[0]!.value, 1.23e10);
      assert.strictEqual(writeRequest.timeseries[1]!.samples[0]!.value, 4.56e-3);
    });
    
  });
  
});