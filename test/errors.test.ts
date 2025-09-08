/**
 * Tests for error classes
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PrometheusParseError, OTLPConversionError } from '../src/errors.js';

describe('Error Classes', () => {
  
  describe('PrometheusParseError', () => {
    
    it('should create error with message only', () => {
      const error = new PrometheusParseError('Invalid metric format');
      
      assert.strictEqual(error.name, 'PrometheusParseError');
      assert.strictEqual(error.message, 'Invalid metric format');
      assert.strictEqual(error.line, undefined);
      assert.strictEqual(error.lineNumber, undefined);
      assert.ok(error instanceof Error, 'Should be instance of Error');
      assert.ok(error instanceof PrometheusParseError, 'Should be instance of PrometheusParseError');
    });
    
    it('should create error with message and line', () => {
      const errorLine = 'invalid_metric_without_value';
      const error = new PrometheusParseError('Missing value for metric', errorLine);
      
      assert.strictEqual(error.name, 'PrometheusParseError');
      assert.strictEqual(error.message, 'Missing value for metric');
      assert.strictEqual(error.line, 'invalid_metric_without_value');
      assert.strictEqual(error.lineNumber, undefined);
    });
    
    it('should create error with message, line, and line number', () => {
      const errorLine = 'http_requests_total{method="GET"} invalid_value';
      const error = new PrometheusParseError('Invalid metric value', errorLine, 42);
      
      assert.strictEqual(error.name, 'PrometheusParseError');
      assert.strictEqual(error.message, 'Invalid metric value');
      assert.strictEqual(error.line, 'http_requests_total{method="GET"} invalid_value');
      assert.strictEqual(error.lineNumber, 42);
    });
    
    it('should preserve stack trace', () => {
      const error = new PrometheusParseError('Test error');
      
      assert.ok(error.stack, 'Should have stack trace');
      assert.ok(error.stack.includes('PrometheusParseError'), 'Stack should include error name');
      assert.ok(error.stack.includes('Test error'), 'Stack should include error message');
    });
    
    it('should be catchable as generic Error', () => {
      try {
        throw new PrometheusParseError('Parse failed', 'bad line', 10);
      } catch (error) {
        assert.ok(error instanceof Error, 'Should be catchable as Error');
        assert.ok(error instanceof PrometheusParseError, 'Should maintain specific type');
        
        if (error instanceof PrometheusParseError) {
          assert.strictEqual(error.line, 'bad line');
          assert.strictEqual(error.lineNumber, 10);
        }
      }
    });
    
    it('should handle edge case values', () => {
      // Empty strings
      const error1 = new PrometheusParseError('', '', 0);
      assert.strictEqual(error1.message, '');
      assert.strictEqual(error1.line, '');
      assert.strictEqual(error1.lineNumber, 0);
      
      // Large line numbers
      const error2 = new PrometheusParseError('Error at end of large file', 'last line', 999999);
      assert.strictEqual(error2.lineNumber, 999999);
      
      // Special characters in line
      const error3 = new PrometheusParseError('Unicode test', 'metric{label="🚀"} 42', 1);
      assert.strictEqual(error3.line, 'metric{label="🚀"} 42');
    });
    
  });
  
  describe('OTLPConversionError', () => {
    
    it('should create error with message only', () => {
      const error = new OTLPConversionError('Failed to convert histogram');
      
      assert.strictEqual(error.name, 'OTLPConversionError');
      assert.strictEqual(error.message, 'Failed to convert histogram');
      assert.strictEqual(error.metric, undefined);
      assert.ok(error instanceof Error, 'Should be instance of Error');
      assert.ok(error instanceof OTLPConversionError, 'Should be instance of OTLPConversionError');
    });
    
    it('should create error with message and metric name', () => {
      const error = new OTLPConversionError('Invalid metric type', 'http_request_duration_seconds');
      
      assert.strictEqual(error.name, 'OTLPConversionError');
      assert.strictEqual(error.message, 'Invalid metric type');
      assert.strictEqual(error.metric, 'http_request_duration_seconds');
    });
    
    it('should preserve stack trace', () => {
      const error = new OTLPConversionError('Conversion failed');
      
      assert.ok(error.stack, 'Should have stack trace');
      assert.ok(error.stack.includes('OTLPConversionError'), 'Stack should include error name');
      assert.ok(error.stack.includes('Conversion failed'), 'Stack should include error message');
    });
    
    it('should be catchable as generic Error', () => {
      try {
        throw new OTLPConversionError('OTLP push failed', 'cpu_usage');
      } catch (error) {
        assert.ok(error instanceof Error, 'Should be catchable as Error');
        assert.ok(error instanceof OTLPConversionError, 'Should maintain specific type');
        
        if (error instanceof OTLPConversionError) {
          assert.strictEqual(error.metric, 'cpu_usage');
        }
      }
    });
    
    it('should handle complex metric names', () => {
      const complexMetricName = 'http_request_duration_seconds_bucket';
      const error = new OTLPConversionError('Bucket conversion failed', complexMetricName);
      
      assert.strictEqual(error.metric, complexMetricName);
    });
    
    it('should handle edge case values', () => {
      // Empty strings
      const error1 = new OTLPConversionError('', '');
      assert.strictEqual(error1.message, '');
      assert.strictEqual(error1.metric, '');
      
      // Special characters in metric name
      const error2 = new OTLPConversionError('Unicode metric error', 'metric_with_émojis_🎯');
      assert.strictEqual(error2.metric, 'metric_with_émojis_🎯');
      
      // Very long metric names
      const longMetricName = 'very_long_metric_name_that_exceeds_normal_length_limits_' + 'x'.repeat(100);
      const error3 = new OTLPConversionError('Long name error', longMetricName);
      assert.strictEqual(error3.metric, longMetricName);
    });
    
  });
  
  describe('Error Inheritance and Polymorphism', () => {
    
    it('should distinguish between different error types', () => {
      const parseError = new PrometheusParseError('Parse error');
      const otlpError = new OTLPConversionError('OTLP error');
      
      assert.ok(parseError instanceof PrometheusParseError);
      assert.ok(!(parseError instanceof OTLPConversionError));
      
      assert.ok(otlpError instanceof OTLPConversionError);
      assert.ok(!(otlpError instanceof PrometheusParseError));
      
      assert.ok(parseError instanceof Error);
      assert.ok(otlpError instanceof Error);
    });
    
    it('should work correctly in error handling patterns', () => {
      const errors = [
        new PrometheusParseError('Parse error', 'bad line', 5),
        new OTLPConversionError('OTLP error', 'metric_name'),
        new Error('Generic error')
      ];
      
      let parseErrorCount = 0;
      let otlpErrorCount = 0;
      let genericErrorCount = 0;
      
      errors.forEach(error => {
        if (error instanceof PrometheusParseError) {
          parseErrorCount++;
          assert.ok(error.line !== undefined || error.lineNumber !== undefined);
        } else if (error instanceof OTLPConversionError) {
          otlpErrorCount++;
          assert.ok(error.metric !== undefined);
        } else {
          genericErrorCount++;
        }
      });
      
      assert.strictEqual(parseErrorCount, 1);
      assert.strictEqual(otlpErrorCount, 1);
      assert.strictEqual(genericErrorCount, 1);
    });
    
  });
  
});