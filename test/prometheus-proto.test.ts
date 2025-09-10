/**
 * Tests for Prometheus protobuf utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createWriteRequest,
  createTimeSeries,
  createMetricMetadata,
  createLabel,
  createSample,
  MetricType,
  decodeWriteRequest
} from '../src/prometheus-proto.js';

describe('Prometheus Protobuf Utilities', () => {
  
  describe('Factory Functions', () => {
    
    it('should create WriteRequest with timeseries and metadata', () => {
      const timeSeries = [createTimeSeries({
        labels: [createLabel('metric_name', 'test_counter')],
        samples: [createSample(42, 1234567890)]
      })];
      
      const metadata = [createMetricMetadata({
        type: MetricType.COUNTER,
        metric_family_name: 'test_counter',
        help: 'Test counter metric'
      })];
      
      const writeRequest = createWriteRequest({ timeseries: timeSeries, metadata });
      
      assert.ok(writeRequest.timeseries, 'Should have timeseries');
      assert.ok(writeRequest.metadata, 'Should have metadata');
      assert.strictEqual(writeRequest.timeseries.length, 1, 'Should have 1 timeseries');
      assert.strictEqual(writeRequest.metadata.length, 1, 'Should have 1 metadata');
      assert.deepStrictEqual(writeRequest.timeseries, timeSeries, 'Timeseries should match');
      assert.deepStrictEqual(writeRequest.metadata, metadata, 'Metadata should match');
    });
    
    it('should create TimeSeries with labels and samples', () => {
      const labels = [
        createLabel('__metric_name', 'http_requests_total'),
        createLabel('method', 'GET'),
        createLabel('status', '200')
      ];
      
      const samples = [
        createSample(100, 1234567890),
        createSample(150, 1234567900)
      ];
      
      const timeSeries = createTimeSeries({ labels, samples });
      
      assert.ok(timeSeries.labels, 'Should have labels');
      assert.ok(timeSeries.samples, 'Should have samples');
      assert.strictEqual(timeSeries.labels.length, 3, 'Should have 3 labels');
      assert.strictEqual(timeSeries.samples.length, 2, 'Should have 2 samples');
      assert.deepStrictEqual(timeSeries.labels, labels, 'Labels should match');
      assert.deepStrictEqual(timeSeries.samples, samples, 'Samples should match');
    });
    
    it('should create MetricMetadata with all fields', () => {
      const metadata = createMetricMetadata({
        type: MetricType.HISTOGRAM,
        metric_family_name: 'request_duration_seconds',
        help: 'Request duration in seconds',
        unit: 'seconds'
      });
      
      assert.strictEqual(metadata.type, MetricType.HISTOGRAM, 'Type should match');
      assert.strictEqual(metadata.metric_family_name, 'request_duration_seconds', 'Name should match');
      assert.strictEqual(metadata.help, 'Request duration in seconds', 'Help should match');
      assert.strictEqual(metadata.unit, 'seconds', 'Unit should match');
    });
    
    it('should create MetricMetadata with optional fields as null', () => {
      const metadata = createMetricMetadata({
        type: MetricType.GAUGE,
        metric_family_name: 'memory_usage_bytes'
        // No help or unit provided
      });
      
      assert.strictEqual(metadata.type, MetricType.GAUGE, 'Type should match');
      assert.strictEqual(metadata.metric_family_name, 'memory_usage_bytes', 'Name should match');
      assert.strictEqual(metadata.help, null, 'Help should be null when not provided');
      assert.strictEqual(metadata.unit, null, 'Unit should be null when not provided');
    });
    
    it('should create Label with name and value', () => {
      const label = createLabel('method', 'POST');
      
      assert.strictEqual(label.name, 'method', 'Name should match');
      assert.strictEqual(label.value, 'POST', 'Value should match');
    });
    
    it('should create Sample with value and timestamp', () => {
      const sample = createSample(3.14159, 1640995200000);
      
      assert.strictEqual(sample.value, 3.14159, 'Value should match');
      assert.strictEqual(sample.timestamp, 1640995200000, 'Timestamp should match');
    });
    
    it('should handle edge case values in Sample', () => {
      const sample1 = createSample(0, 0);
      assert.strictEqual(sample1.value, 0, 'Should handle zero value');
      assert.strictEqual(sample1.timestamp, 0, 'Should handle zero timestamp');
      
      const sample2 = createSample(-42.5, 1234567890123);
      assert.strictEqual(sample2.value, -42.5, 'Should handle negative value');
      assert.strictEqual(sample2.timestamp, 1234567890123, 'Should handle large timestamp');
      
      const sample3 = createSample(Infinity, Date.now());
      assert.strictEqual(sample3.value, Infinity, 'Should handle Infinity value');
    });
    
  });
  
  describe('MetricType Enum', () => {
    
    it('should have correct enum values', () => {
      assert.strictEqual(MetricType.UNKNOWN, 0);
      assert.strictEqual(MetricType.COUNTER, 1);
      assert.strictEqual(MetricType.GAUGE, 2);
      assert.strictEqual(MetricType.HISTOGRAM, 3);
      assert.strictEqual(MetricType.GAUGEHISTOGRAM, 4);
      assert.strictEqual(MetricType.SUMMARY, 5);
      assert.strictEqual(MetricType.INFO, 6);
      assert.strictEqual(MetricType.STATESET, 7);
    });
    
    it('should be usable in metadata creation', () => {
      Object.values(MetricType).forEach(type => {
        if (typeof type === 'number') {
          const metadata = createMetricMetadata({
            type,
            metric_family_name: `test_metric_${type}`
          });
          assert.strictEqual(metadata.type, type, `Should create metadata with type ${type}`);
        }
      });
    });
    
  });
  
  describe('Protobuf Encoding/Decoding', () => {
    
    it('should decode WriteRequest from protobuf binary', async () => {
      // Create test data
      const originalData = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'test_metric'),
              createLabel('label1', 'value1')
            ],
            samples: [createSample(42, 1234567890)]
          })
        ],
        metadata: [
          createMetricMetadata({
            type: MetricType.COUNTER,
            metric_family_name: 'test_metric',
            help: 'Test metric for encoding/decoding'
          })
        ]
      });
      
      // We need protobuf to encode first
      const protobuf = (await import('../proto/protobuf.js')).default;
      const { prometheus } = protobuf;
      const encoded = prometheus.WriteRequest.encode(originalData).finish();
      
      // Test decoding
      const decoded = decodeWriteRequest(encoded);
      
      assert.ok(decoded, 'Should return decoded data');
      assert.ok(decoded.timeseries, 'Should have timeseries');
      assert.ok(decoded.metadata, 'Should have metadata');
      assert.strictEqual(decoded.timeseries.length, 1, 'Should have 1 timeseries');
      assert.strictEqual(decoded.metadata.length, 1, 'Should have 1 metadata');
      
      // Check timeseries
      const decodedTS = decoded.timeseries[0];
      assert.strictEqual(decodedTS.labels.length, 2, 'Should have 2 labels');
      assert.strictEqual(decodedTS.samples.length, 1, 'Should have 1 sample');
      assert.strictEqual(decodedTS.labels[0].name, '__metric_name');
      assert.strictEqual(decodedTS.labels[0].value, 'test_metric');
      assert.strictEqual(decodedTS.samples[0].value, 42);
      
      // Check metadata
      const decodedMeta = decoded.metadata[0];
      assert.strictEqual(decodedMeta.type, MetricType.COUNTER);
      assert.strictEqual(decodedMeta.metric_family_name, 'test_metric');
      assert.strictEqual(decodedMeta.help, 'Test metric for encoding/decoding');
    });
    
    it('should handle empty WriteRequest', async () => {
      const emptyData = createWriteRequest({ timeseries: [], metadata: [] });
      
      // Encode and decode
      const protobuf = (await import('../proto/protobuf.js')).default;
      const { prometheus } = protobuf;
      const encoded = prometheus.WriteRequest.encode(emptyData).finish();
      const decoded = decodeWriteRequest(encoded);
      
      assert.ok(decoded, 'Should return decoded data');
      assert.ok(Array.isArray(decoded.timeseries), 'Should have timeseries array');
      assert.ok(Array.isArray(decoded.metadata), 'Should have metadata array');
      assert.strictEqual(decoded.timeseries.length, 0, 'Should have empty timeseries');
      assert.strictEqual(decoded.metadata.length, 0, 'Should have empty metadata');
    });
    
    it('should handle complex metric data', async () => {
      const complexData = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'http_requests_total'),
              createLabel('method', 'GET'),
              createLabel('status', '200')
            ],
            samples: [
              createSample(100, 1640995200000),
              createSample(110, 1640995260000)
            ]
          }),
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'memory_usage_bytes'),
              createLabel('instance', 'server1')
            ],
            samples: [createSample(1073741824, 1640995200000)]
          })
        ],
        metadata: [
          createMetricMetadata({
            type: MetricType.COUNTER,
            metric_family_name: 'http_requests_total',
            help: 'Total HTTP requests',
            unit: 'requests'
          }),
          createMetricMetadata({
            type: MetricType.GAUGE,
            metric_family_name: 'memory_usage_bytes',
            help: 'Memory usage in bytes',
            unit: 'bytes'
          })
        ]
      });
      
      // Encode and decode
      const protobuf = (await import('../proto/protobuf.js')).default;
      const { prometheus } = protobuf;
      const encoded = prometheus.WriteRequest.encode(complexData).finish();
      const decoded = decodeWriteRequest(encoded);
      
      assert.strictEqual(decoded.timeseries.length, 2, 'Should have 2 timeseries');
      assert.strictEqual(decoded.metadata.length, 2, 'Should have 2 metadata items');
      
      // Verify complex structure is preserved
      const firstTS = decoded.timeseries[0];
      assert.strictEqual(firstTS.labels.length, 3, 'First timeseries should have 3 labels');
      assert.strictEqual(firstTS.samples.length, 2, 'First timeseries should have 2 samples');
      
      const secondTS = decoded.timeseries[1];
      assert.strictEqual(secondTS.labels.length, 2, 'Second timeseries should have 2 labels');
      assert.strictEqual(secondTS.samples.length, 1, 'Second timeseries should have 1 sample');
    });
    
  });
  
});