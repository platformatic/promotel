/**
 * Tests for HTTP client functionality
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  gather,
  dispatch,
} from '../src/http-client.js';
import { convert } from '../src/index.js';

describe('gather', () => {
  it('should fetch metrics from test app endpoint', async () => {
    const prometheusWriteRequest = await gather({
      url: 'http://localhost:3000/metrics'
    });

    assert.ok(typeof prometheusWriteRequest === 'object', 'Should return object (WriteRequest)');
    assert.ok(prometheusWriteRequest.timeseries, 'Should have timeseries property');
    assert.ok(Array.isArray(prometheusWriteRequest.timeseries), 'timeseries should be array');
  });

  it('should handle abort signal', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    await assert.rejects(
      async () => await gather({
        url: 'http://httpbin.org/delay/10', // External service with 10s delay
        signal: controller.signal
      }),
      /Request was aborted/i,
      'Should abort for slow endpoint when signal is aborted'
    );
  });

  it('should handle invalid URL', async () => {
    await assert.rejects(
      async () => await gather({
        url: 'http://localhost:9999/metrics' // Non-existent port
      }),
      /Failed to fetch/i,
      'Should fail for invalid URL'
    );
  });
});

describe('dispatch', () => {
  it('should push OTLP data to collector', async () => {
    // Get some test data
    const prometheusWriteRequest = await gather({
      url: 'http://localhost:3000/metrics'
    });

    // Convert to OTLP
    const otlpData = convert(prometheusWriteRequest, {
      serviceName: 'http-client-test'
    });

    // Push to collector - should not throw
    await dispatch(otlpData, {
      url: 'http://localhost:4318/v1/metrics'
    });
  });

  it('should handle abort signal', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const otlpData = new Uint8Array([0x01, 0x02, 0x03]);

    await assert.rejects(
      async () => await dispatch(otlpData, {
        url: 'http://httpbin.org/delay/10', // External service with 10s delay
        signal: controller.signal
      }),
      /Request was aborted/i,
      'Should abort for slow endpoint when signal is aborted'
    );
  });

  it('should handle invalid OTLP endpoint', async () => {
    const otlpData = new Uint8Array([0x01, 0x02, 0x03]);

    await assert.rejects(
      async () => await dispatch(otlpData, {
        url: 'http://localhost:9999/v1/metrics' // Non-existent port
      }),
      /Failed to push/i,
      'Should fail for invalid endpoint'
    );
  });
});
