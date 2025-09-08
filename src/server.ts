#!/usr/bin/env node

/**
 * Standalone ProMOTel server
 *
 * Pulls metrics from a Prometheus endpoint, converts to OTLP,
 * and pushes to an OTLP endpoint at regular intervals.
 */

import { parseArgs } from 'node:util';
import type { prometheus } from '../proto/protobuf.js';
import { MetricsPipeline, type MetricsSource } from './pipeline.js';
import { gather, type PrometheusEndpointOptions } from './http-client.js';

/**
 * Metrics source that fetches from an HTTP endpoint
 */
class HttpSource implements MetricsSource {
  private options: PrometheusEndpointOptions;

  constructor(options: PrometheusEndpointOptions) {
    this.options = options;
  }

  async fetch(): Promise<prometheus.IWriteRequest> {
    return await gather(this.options);
  }
}

interface ServerConfig {
  prometheusUrl: string;
  otlpUrl: string;
  interval: number;
  prometheusTimeout?: number;
  otlpTimeout?: number;
  prometheusHeaders?: Record<string, string>;
  otlpHeaders?: Record<string, string>;
  serviceName?: string;
  serviceVersion?: string;
}

class PrometheusOTLPServer extends MetricsPipeline {
  private serverConfig: ServerConfig;

  constructor(config: ServerConfig) {
    // Create HTTP source with Prometheus endpoint options
    const prometheusOptions: PrometheusEndpointOptions = {
      url: config.prometheusUrl,
      ...(config.prometheusHeaders && { headers: config.prometheusHeaders }),
    };
    const source = new HttpSource(prometheusOptions);

    // Create OTLP endpoint options
    const otlpOptions = {
      url: config.otlpUrl,
      ...(config.otlpHeaders && { headers: config.otlpHeaders }),
    };

    // Create conversion options
    const conversionOptions = {
      ...(config.serviceName && { serviceName: config.serviceName }),
      ...(config.serviceVersion && { serviceVersion: config.serviceVersion }),
    };

    // Initialize pipeline with console logging for errors
    super({
      source,
      otlpEndpoint: otlpOptions,
      interval: config.interval,
      conversionOptions,
      onError: (error) => {
        console.error('Failed to collect and push metrics:', error instanceof Error ? error.message : error);
      },
    });

    this.serverConfig = config;
  }
}

function parseArgsConfig(): ServerConfig {

  const options = {
    'prometheus-url': { type: 'string', short: 'p' },
    'otlp-url': { type: 'string', short: 'o' },
    'interval': { type: 'string', short: 'i' },
    'prometheus-timeout': { type: 'string' },
    'otlp-timeout': { type: 'string' },
    'service-name': { type: 'string' },
    'service-version': { type: 'string' },
    'help': { type: 'boolean', short: 'h' },
  } as const;

  try {
    const { values } = parseArgs({ options, allowPositionals: false });

    if (values.help) {
      printHelp();
      process.exit(0);
    }

    // Validate required args
    if (!values['prometheus-url']) {
      console.error('Error: --prometheus-url is required');
      printHelp();
      process.exit(1);
    }

    if (!values['otlp-url']) {
      console.error('Error: --otlp-url is required');
      printHelp();
      process.exit(1);
    }

    const config: ServerConfig = {
      prometheusUrl: values['prometheus-url'],
      otlpUrl: values['otlp-url'],
      interval: values.interval ? parseInt(values.interval, 10) : 60000,
      ...(values['prometheus-timeout'] && { prometheusTimeout: parseInt(values['prometheus-timeout'], 10) }),
      ...(values['otlp-timeout'] && { otlpTimeout: parseInt(values['otlp-timeout'], 10) }),
      ...(values['service-name'] && { serviceName: values['service-name'] }),
      ...(values['service-version'] && { serviceVersion: values['service-version'] }),
    };

    return config;
  } catch (error) {
    console.error(`Error parsing arguments: ${error instanceof Error ? error.message : error}`);
    printHelp();
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
ProMOTel Server - Prometheus to OpenTelemetry Bridge

USAGE:
  promotel-server --prometheus-url <url> --otlp-url <url> [options]

REQUIRED:
  -p, --prometheus-url <url>     Prometheus metrics endpoint URL
  -o, --otlp-url <url>          OTLP metrics endpoint URL

OPTIONS:
  -i, --interval <ms>           Collection interval in milliseconds (default: 60000)
      --prometheus-timeout <ms> Timeout for Prometheus requests (default: 10000)
      --otlp-timeout <ms>       Timeout for OTLP requests (default: 10000)
      --service-name <name>     Service name for OTLP metadata
      --service-version <ver>   Service version for OTLP metadata
  -h, --help                    Show this help message

EXAMPLES:
  promotel-server -p http://localhost:9090/api/v1/metrics -o http://localhost:4318/v1/metrics
  promotel-server -p http://localhost:3000/metrics -o http://otel-collector:4318/v1/metrics -i 30000
`);
}

// Handle graceful shutdown
function setupGracefulShutdown(server: PrometheusOTLPServer): void {
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Main execution
async function main(): Promise<void> {
  try {
    const config = parseArgsConfig();
    const server = new PrometheusOTLPServer(config);

    setupGracefulShutdown(server);

    server.start();
  } catch (error) {
    console.error('Failed to start server:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run main if this file is executed directly
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('/server.js') ||
  process.argv[1].endsWith('/server.ts') ||
  process.argv[1].includes('promotel-server')
);

if (isMainModule) {
  main();
}
