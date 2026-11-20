/**
 * Tests for the @platformatic/prom-client registry integration
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Counter, Gauge, Histogram, Registry, Summary, register } from '@platformatic/prom-client';
import { getFromRegistry } from '../src/prom-client.ts';
import { PrometheusParseError } from '../src/errors.ts';

function findSeries(writeRequest: Awaited<ReturnType<typeof getFromRegistry>>, name: string) {
  return (writeRequest.timeseries ?? []).filter((series) =>
    series.labels?.some((label) => label.name === '__metric_name' && label.value === name)
  );
}

describe('getFromRegistry', () => {
  it('should read metrics from a custom registry', async () => {
    const registry = new Registry();

    const counter = new Counter({
      name: 'promotel_requests_total',
      help: 'Total requests',
      labelNames: ['method'],
      registers: [registry],
    });
    counter.inc({ method: 'GET' }, 4);

    const gauge = new Gauge({
      name: 'promotel_in_flight',
      help: 'In-flight requests',
      registers: [registry],
    });
    gauge.set(2);

    const histogram = new Histogram({
      name: 'promotel_duration_seconds',
      help: 'Request duration',
      buckets: [0.1, 1],
      registers: [registry],
    });
    histogram.observe(0.5);

    const summary = new Summary({
      name: 'promotel_size_bytes',
      help: 'Response size',
      percentiles: [0.5],
      registers: [registry],
    });
    summary.observe(100);

    const writeRequest = await getFromRegistry({ registry });

    const families = new Map((writeRequest.metadata ?? []).map((m) => [m.metric_family_name, m.type]));
    assert.strictEqual(families.get('promotel_requests_total'), 1); // COUNTER
    assert.strictEqual(families.get('promotel_in_flight'), 2); // GAUGE
    assert.strictEqual(families.get('promotel_duration_seconds'), 3); // HISTOGRAM
    assert.strictEqual(families.get('promotel_size_bytes'), 5); // SUMMARY

    const [requests] = findSeries(writeRequest, 'promotel_requests_total');
    assert.ok(requests, 'Should include the counter series');
    assert.ok(requests.labels?.some((label) => label.name === 'method' && label.value === 'GET'));
    assert.strictEqual(requests.samples?.[0]?.value, 4);

    const [inFlight] = findSeries(writeRequest, 'promotel_in_flight');
    assert.strictEqual(inFlight?.samples?.[0]?.value, 2);
  });

  it('should default to the global registry', async () => {
    register.clear();
    const counter = new Counter({
      name: 'promotel_default_registry_total',
      help: 'Counter on the default registry',
    });
    counter.inc(7);

    try {
      const writeRequest = await getFromRegistry();
      const [series] = findSeries(writeRequest, 'promotel_default_registry_total');
      assert.strictEqual(series?.samples?.[0]?.value, 7);
    } finally {
      register.clear();
    }
  });

  it('should wrap registry failures in PrometheusParseError', async () => {
    const registry = new Registry();
    new Gauge({
      name: 'promotel_broken',
      help: 'Gauge whose collect function throws',
      registers: [registry],
      collect() {
        throw new Error('boom');
      },
    });

    await assert.rejects(getFromRegistry({ registry }), (error: unknown) => {
      assert.ok(error instanceof PrometheusParseError);
      assert.match(error.message, /Failed to get metrics from prom-client registry: boom/);
      return true;
    });
  });
});
