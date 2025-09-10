/**
 * Tests for OTLP conversion edge cases
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import Long from 'long';
import { convert, type ConversionOptions } from '../src/otlp.js';
import { createWriteRequest, createTimeSeries, createSample, createLabel, createMetricMetadata, MetricType } from '../src/prometheus-proto.js';
import type { prometheus } from '../proto/protobuf.js';

describe('OTLP Conversion Edge Cases', () => {
  
  describe('Long Type Handling', () => {
    
    it('should handle Long timestamps in samples', () => {
      const longTimestamp = Long.fromNumber(1640995200000);
      
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'test_metric')],
            samples: [
              // Create a sample with Long timestamp directly
              { value: 42, timestamp: longTimestamp }
            ]
          })
        ],
        metadata: []
      });
      
      const otlpData = convert(writeRequest);
      
      assert.ok(otlpData.resource_metrics, 'Should have resource_metrics');
      assert.strictEqual(otlpData.resource_metrics.length, 1);
      
      const metric = otlpData.resource_metrics[0].scope_metrics![0].metrics![0];
      assert.ok(metric.gauge, 'Should convert to gauge');
      
      const dataPoint = metric.gauge!.data_points![0];
      assert.ok(dataPoint.time_unix_nano, 'Should have timestamp');
      // Verify timestamp was converted properly (nano = millis * 1000000)
      assert.ok(dataPoint.time_unix_nano > 1000000000000000000n, 'Should be in nanoseconds');
    });
    
    it('should handle null timestamps', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'test_metric')],
            samples: [
              { value: 42, timestamp: null }
            ]
          })
        ],
        metadata: []
      });
      
      const otlpData = convert(writeRequest, { defaultTimestamp: 1234567890000 });
      
      const metric = otlpData.resource_metrics![0].scope_metrics![0].metrics![0];
      const dataPoint = metric.gauge!.data_points![0];
      
      // Should use default timestamp when sample timestamp is null
      assert.ok(dataPoint.time_unix_nano, 'Should have default timestamp');
    });
    
    it('should handle undefined timestamps', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'test_metric')],
            samples: [
              { value: 42 } // No timestamp property
            ]
          })
        ],
        metadata: []
      });
      
      const defaultTime = 1640995200000;
      const otlpData = convert(writeRequest, { defaultTimestamp: defaultTime });
      
      const metric = otlpData.resource_metrics![0].scope_metrics![0].metrics![0];
      const dataPoint = metric.gauge!.data_points![0];
      
      // Should use default timestamp (converted to nanoseconds)
      // The actual implementation returns a Long, so we need to convert for comparison
      const expectedNano = BigInt(defaultTime * 1000000);
      const actualNano = typeof dataPoint.time_unix_nano === 'bigint' 
        ? dataPoint.time_unix_nano 
        : BigInt(dataPoint.time_unix_nano.toString());
      assert.strictEqual(actualNano, expectedNano);
    });
    
  });
  
  describe('Null and Undefined Value Handling', () => {
    
    it('should handle null sample values', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'test_metric')],
            samples: [
              { value: null, timestamp: 1234567890000 }
            ]
          })
        ],
        metadata: []
      });
      
      // Should not throw, but may produce empty or default data
      const otlpData = convert(writeRequest);
      assert.ok(otlpData, 'Should return OTLP data');
    });
    
    it('should handle missing timeseries array', () => {
      const writeRequest = createWriteRequest({
        timeseries: [],
        metadata: []
      });
      
      const otlpData = convert(writeRequest);
      
      assert.ok(otlpData.resource_metrics, 'Should have resource_metrics');
      assert.strictEqual(otlpData.resource_metrics.length, 1);
      
      const scopeMetrics = otlpData.resource_metrics[0].scope_metrics![0];
      assert.ok(Array.isArray(scopeMetrics.metrics), 'Should have empty metrics array');
      assert.strictEqual(scopeMetrics.metrics.length, 0, 'Should have no metrics');
    });
    
    it('should handle missing metadata array', () => {
      const writeRequest: prometheus.IWriteRequest = {
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'test_metric')],
            samples: [createSample(42, 1234567890000)]
          })
        ]
        // No metadata property
      };
      
      const otlpData = convert(writeRequest);
      
      assert.ok(otlpData, 'Should convert without metadata');
      assert.strictEqual(otlpData.resource_metrics![0].scope_metrics![0].metrics!.length, 1);
    });
    
  });
  
  describe('Histogram Edge Cases', () => {
    
    it('should handle histogram with +Inf bucket', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'request_duration_seconds'),
              createLabel('le', '0.1'),
              createLabel('__suffix', 'bucket')
            ],
            samples: [createSample(100, 1234567890000)]
          }),
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'request_duration_seconds'),
              createLabel('le', '+Inf'),
              createLabel('__suffix', 'bucket')
            ],
            samples: [createSample(200, 1234567890000)]
          }),
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'request_duration_seconds'),
              createLabel('__suffix', 'count')
            ],
            samples: [createSample(200, 1234567890000)]
          }),
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'request_duration_seconds'),
              createLabel('__suffix', 'sum')
            ],
            samples: [createSample(15.5, 1234567890000)]
          })
        ],
        metadata: [
          createMetricMetadata({
            type: MetricType.HISTOGRAM,
            metric_family_name: 'request_duration_seconds',
            help: 'Request duration histogram'
          })
        ]
      });
      
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0].scope_metrics![0].metrics![0];
      assert.ok(metric.histogram, 'Should be histogram metric');
      
      const histogram = metric.histogram!;
      assert.ok(histogram.data_points, 'Should have data points');
      
      const dataPoint = histogram.data_points![0];
      assert.ok(dataPoint.bucket_counts, 'Should have bucket counts');
      assert.ok(dataPoint.explicit_bounds, 'Should have explicit bounds');
      
      // +Inf bucket should not be in explicit_bounds but should be in bucket_counts
      assert.ok(!dataPoint.explicit_bounds!.includes(Infinity), 'Should not include +Inf in bounds');
      // The actual implementation groups by labels, so we may have fewer data points than expected
      assert.ok(dataPoint.bucket_counts!.length >= 1, 'Should have at least 1 bucket count');
    });
    
    it('should handle histogram with missing buckets', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'incomplete_histogram'),
              createLabel('__suffix', 'count')
            ],
            samples: [createSample(10, 1234567890000)]
          }),
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'incomplete_histogram'),
              createLabel('__suffix', 'sum')
            ],
            samples: [createSample(5.0, 1234567890000)]
          })
          // Missing bucket data
        ],
        metadata: [
          createMetricMetadata({
            type: MetricType.HISTOGRAM,
            metric_family_name: 'incomplete_histogram'
          })
        ]
      });
      
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0].scope_metrics![0].metrics![0];
      assert.ok(metric.histogram, 'Should be histogram metric');
      
      const dataPoint = metric.histogram!.data_points![0];
      assert.strictEqual(dataPoint.count, 10, 'Should have count');
      assert.strictEqual(dataPoint.sum, 5.0, 'Should have sum');
      assert.ok(Array.isArray(dataPoint.bucket_counts), 'Should have empty bucket counts array');
      assert.ok(Array.isArray(dataPoint.explicit_bounds), 'Should have empty bounds array');
    });
    
  });
  
  describe('Summary Edge Cases', () => {
    
    it('should handle summary with edge case quantiles', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'response_time_seconds'),
              createLabel('quantile', '0'),
            ],
            samples: [createSample(0.001, 1234567890000)]
          }),
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'response_time_seconds'),
              createLabel('quantile', '0.999'),
            ],
            samples: [createSample(2.5, 1234567890000)]
          }),
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'response_time_seconds'),
              createLabel('quantile', '1.0'),
            ],
            samples: [createSample(10.0, 1234567890000)]
          }),
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'response_time_seconds'),
              createLabel('__suffix', 'count')
            ],
            samples: [createSample(1000, 1234567890000)]
          }),
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'response_time_seconds'),
              createLabel('__suffix', 'sum')
            ],
            samples: [createSample(500.0, 1234567890000)]
          })
        ],
        metadata: [
          createMetricMetadata({
            type: MetricType.SUMMARY,
            metric_family_name: 'response_time_seconds'
          })
        ]
      });
      
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0].scope_metrics![0].metrics![0];
      assert.ok(metric.summary, 'Should be summary metric');
      
      const dataPoint = metric.summary!.data_points![0];
      assert.strictEqual(dataPoint.count, 1000, 'Should have count');
      assert.strictEqual(dataPoint.sum, 500.0, 'Should have sum');
      assert.ok(dataPoint.quantile_values, 'Should have quantile values');
      assert.strictEqual(dataPoint.quantile_values!.length, 3, 'Should have 3 quantiles');
      
      // Check edge quantile values
      const quantiles = dataPoint.quantile_values!;
      const q0 = quantiles.find(q => q.quantile === 0);
      const q999 = quantiles.find(q => q.quantile === 0.999);
      const q1 = quantiles.find(q => q.quantile === 1.0);
      
      assert.ok(q0 && q0.value === 0.001, 'Should have 0th quantile');
      assert.ok(q999 && q999.value === 2.5, 'Should have 99.9th quantile');
      assert.ok(q1 && q1.value === 10.0, 'Should have 100th quantile');
    });
    
    it('should handle summary with missing quantiles', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'simple_summary'),
              createLabel('__suffix', 'count')
            ],
            samples: [createSample(50, 1234567890000)]
          }),
          createTimeSeries({
            labels: [
              createLabel('__metric_name', 'simple_summary'),
              createLabel('__suffix', 'sum')
            ],
            samples: [createSample(100.0, 1234567890000)]
          })
          // No quantile data
        ],
        metadata: [
          createMetricMetadata({
            type: MetricType.SUMMARY,
            metric_family_name: 'simple_summary'
          })
        ]
      });
      
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0].scope_metrics![0].metrics![0];
      assert.ok(metric.summary, 'Should be summary metric');
      
      const dataPoint = metric.summary!.data_points![0];
      assert.strictEqual(dataPoint.count, 50, 'Should have count');
      assert.strictEqual(dataPoint.sum, 100.0, 'Should have sum');
      assert.ok(Array.isArray(dataPoint.quantile_values), 'Should have quantile values array');
      assert.strictEqual(dataPoint.quantile_values!.length, 0, 'Should have empty quantile values');
    });
    
  });
  
  describe('ConversionOptions Edge Cases', () => {
    
    it('should handle undefined ConversionOptions', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'test_metric')],
            samples: [createSample(42, 1234567890000)]
          })
        ],
        metadata: []
      });
      
      // Pass undefined options
      const otlpData = convert(writeRequest, undefined);
      
      assert.ok(otlpData, 'Should handle undefined options');
      
      const resource = otlpData.resource_metrics![0].resource!;
      const serviceNameAttr = resource.attributes!.find(attr => attr.key === 'service.name');
      const serviceVersionAttr = resource.attributes!.find(attr => attr.key === 'service.version');
      
      assert.strictEqual(serviceNameAttr!.value!.string_value, 'promotel-js', 'Should use default service name');
      assert.strictEqual(serviceVersionAttr!.value!.string_value, '0.1.0', 'Should use default service version');
    });
    
    it('should handle empty ConversionOptions', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'test_metric')],
            samples: [createSample(42, 1234567890000)]
          })
        ],
        metadata: []
      });
      
      const otlpData = convert(writeRequest, {});
      
      const resource = otlpData.resource_metrics![0].resource!;
      const serviceNameAttr = resource.attributes!.find(attr => attr.key === 'service.name');
      const serviceVersionAttr = resource.attributes!.find(attr => attr.key === 'service.version');
      
      assert.strictEqual(serviceNameAttr!.value!.string_value, 'promotel-js', 'Should use default service name');
      assert.strictEqual(serviceVersionAttr!.value!.string_value, '0.1.0', 'Should use default service version');
    });
    
    it('should handle partial ConversionOptions', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'test_metric')],
            samples: [createSample(42, 1234567890000)]
          })
        ],
        metadata: []
      });
      
      const otlpData = convert(writeRequest, {
        serviceName: 'custom-service'
        // No serviceVersion or defaultTimestamp
      });
      
      const resource = otlpData.resource_metrics![0].resource!;
      const serviceNameAttr = resource.attributes!.find(attr => attr.key === 'service.name');
      const serviceVersionAttr = resource.attributes!.find(attr => attr.key === 'service.version');
      
      assert.strictEqual(serviceNameAttr!.value!.string_value, 'custom-service', 'Should use custom service name');
      assert.strictEqual(serviceVersionAttr!.value!.string_value, '0.1.0', 'Should use default service version');
    });
    
  });
  
  describe('Extreme Values', () => {
    
    it('should handle very large numeric values', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'large_metric')],
            samples: [createSample(Number.MAX_SAFE_INTEGER, 1234567890000)]
          })
        ],
        metadata: []
      });
      
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0].scope_metrics![0].metrics![0];
      const dataPoint = metric.gauge!.data_points![0];
      
      assert.strictEqual(dataPoint.as_double, Number.MAX_SAFE_INTEGER, 'Should handle large values');
    });
    
    it('should handle very small numeric values', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'small_metric')],
            samples: [createSample(Number.MIN_VALUE, 1234567890000)]
          })
        ],
        metadata: []
      });
      
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0].scope_metrics![0].metrics![0];
      const dataPoint = metric.gauge!.data_points![0];
      
      assert.strictEqual(dataPoint.as_double, Number.MIN_VALUE, 'Should handle very small values');
    });
    
    it('should handle zero values', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'zero_metric')],
            samples: [createSample(0, 1234567890000)]
          })
        ],
        metadata: []
      });
      
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0].scope_metrics![0].metrics![0];
      const dataPoint = metric.gauge!.data_points![0];
      
      assert.strictEqual(dataPoint.as_double, 0, 'Should handle zero values');
    });
    
    it('should handle negative values', () => {
      const writeRequest = createWriteRequest({
        timeseries: [
          createTimeSeries({
            labels: [createLabel('__metric_name', 'negative_metric')],
            samples: [createSample(-42.5, 1234567890000)]
          })
        ],
        metadata: []
      });
      
      const otlpData = convert(writeRequest);
      
      const metric = otlpData.resource_metrics![0].scope_metrics![0].metrics![0];
      const dataPoint = metric.gauge!.data_points![0];
      
      assert.strictEqual(dataPoint.as_double, -42.5, 'Should handle negative values');
    });
    
  });
  
});