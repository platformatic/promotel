/**
 * Tests for PromClientBridge class
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { setTimeout as sleep } from 'node:timers/promises';
import { PromClientBridge } from '../src/bridge.ts';
import { createMockOTLPEndpoint } from './test-utils.ts';

describe('PromClientBridge', () => {
  
  describe('Bridge functionality', () => {
    
    it('should create bridge instance with proper configuration', async () => {
      // Dynamically import prom-client to avoid hard dependency
      const { register, Counter } = await import('prom-client');
      
      // Create a test metric
      const testCounter = new Counter({
        name: 'test_bridge_requests_total',
        help: 'Test counter for bridge',
      });
      testCounter.inc(5);
      
      const bridge = new PromClientBridge({
        registry: register,
        otlpEndpoint: 'http://localhost:4318/v1/metrics',
        interval: 5000,
        conversionOptions: {
          serviceName: 'bridge-test'
        }
      });
      
      assert.strictEqual(bridge.running, false, 'Should not be running initially');
      
      const config = bridge.config;
      assert.strictEqual(config.otlpEndpoint.url, 'http://localhost:4318/v1/metrics');
      assert.strictEqual(config.interval, 5000);
      assert.strictEqual(config.conversionOptions.serviceName, 'bridge-test');
    });
    
    it('should perform manual collect and push', async () => {
      // Dynamically import prom-client to avoid hard dependency
      const { register, Counter } = await import('prom-client');
      const mockEndpoint = await createMockOTLPEndpoint();
      
      // Clear registry and create a test metric
      register.clear();
      const testCounter = new Counter({
        name: 'test_manual_requests_total',
        help: 'Test counter for manual collection',
      });
      testCounter.inc(3);
      
      const bridge = new PromClientBridge({
        registry: register,
        otlpEndpoint: mockEndpoint.url,
        interval: 60000 // Long interval, we'll trigger manually
      });
      
      try {
        // Manual collection should work
        await bridge.collectAndPush();
        assert.strictEqual(mockEndpoint.requests.length, 1, 'Should push one payload');
      } finally {
        register.clear();
        await mockEndpoint.close();
      }
    });
    
    it('should handle start/stop lifecycle', async () => {
      // Dynamically import prom-client to avoid hard dependency
      const { register, Counter } = await import('prom-client');
      const mockEndpoint = await createMockOTLPEndpoint();
      
      // Clear registry and create a test metric
      register.clear();
      const testCounter = new Counter({
        name: 'test_lifecycle_requests_total',
        help: 'Test counter for lifecycle',
      });
      testCounter.inc(1);
      
      const bridge = new PromClientBridge({
        registry: register,
        otlpEndpoint: mockEndpoint.url,
        interval: 30000 // Long enough that it won't trigger during test
      });
      
      try {
        // Start bridge
        bridge.start();
        assert.strictEqual(bridge.running, true, 'Should be running after start');
        
        // Should throw if started again
        assert.throws(
          () => bridge.start(),
          /already running/i,
          'Should throw if started twice'
        );

        await sleep(50);
        
        // Stop bridge
        bridge.stop();
        assert.strictEqual(bridge.running, false, 'Should not be running after stop');
        
        // Should be safe to stop again
        bridge.stop(); // Should not throw
        assert.ok(mockEndpoint.requests.length > 0, 'Should push at least one payload when started');
      } finally {
        bridge.stop();
        register.clear();
        await mockEndpoint.close();
      }
    });
    
    it('should handle errors gracefully', async () => {
      // Dynamically import prom-client to avoid hard dependency
      const { register } = await import('prom-client');
      
      let _errorCaught: Error | null = null;
      
      const bridge = new PromClientBridge({
        registry: register,
        otlpEndpoint: 'http://localhost:9999/v1/metrics', // Invalid endpoint
        interval: 60000,
        onError: (error) => {
          _errorCaught = error;
        }
      });
      
      await assert.rejects(
        async () => await bridge.collectAndPush(),
        /Failed to collect and push/i,
        'Should throw error for invalid endpoint'
      );
    });
    
  });
  
});