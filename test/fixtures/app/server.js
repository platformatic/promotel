const http = require('http');

const histogramBuckets = [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10];
const summaryQuantiles = [0.5, 0.9, 0.99];
const requestCounts = new Map();
const durations = [];

let activeConnections = 0;

function escapeLabelValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function formatLabels(labels) {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return '';
  }

  return `{${entries
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(',')}}`;
}

function incrementCounter(metricName, labels, value = 1) {
  const key = `${metricName}|${JSON.stringify(labels)}`;
  requestCounts.set(key, (requestCounts.get(key) || 0) + value);
}

function observeDuration(seconds) {
  durations.push(seconds);
}

function quantile(values, q) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function renderHistogram(metricName, help, values, buckets) {
  const lines = [
    `# HELP ${metricName} ${help}`,
    `# TYPE ${metricName} histogram`
  ];

  for (const bucket of buckets) {
    const count = values.filter((value) => value <= bucket).length;
    lines.push(`${metricName}_bucket{le="${bucket}"} ${count}`);
  }

  lines.push(`${metricName}_bucket{le="+Inf"} ${values.length}`);
  lines.push(`${metricName}_sum ${values.reduce((sum, value) => sum + value, 0)}`);
  lines.push(`${metricName}_count ${values.length}`);

  return lines;
}

function renderSummary(metricName, help, values, quantiles) {
  const lines = [
    `# HELP ${metricName} ${help}`,
    `# TYPE ${metricName} summary`
  ];

  for (const q of quantiles) {
    lines.push(`${metricName}{quantile="${q}"} ${quantile(values, q)}`);
  }

  lines.push(`${metricName}_sum ${values.reduce((sum, value) => sum + value, 0)}`);
  lines.push(`${metricName}_count ${values.length}`);

  return lines;
}

function renderMetrics() {
  const lines = [
    '# HELP http_requests_total Total number of HTTP requests',
    '# TYPE http_requests_total counter'
  ];

  for (const [key, value] of requestCounts.entries()) {
    const [, rawLabels] = key.split('|', 2);
    const labels = JSON.parse(rawLabels);
    lines.push(`http_requests_total${formatLabels(labels)} ${value}`);
  }

  lines.push('# HELP active_connections Number of active connections');
  lines.push('# TYPE active_connections gauge');
  lines.push(`active_connections ${activeConnections}`);

  lines.push(...renderHistogram(
    'http_request_duration_seconds',
    'Duration of HTTP requests in seconds',
    durations,
    histogramBuckets
  ));

  lines.push(...renderSummary(
    'response_time_seconds',
    'Response time in seconds',
    durations,
    summaryQuantiles
  ));

  return `${lines.join('\n')}\n`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = http.createServer(async (req, res) => {
  const start = process.hrtime.bigint();
  activeConnections++;

  try {
    if (req.url === '/metrics') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(renderMetrics());
      incrementCounter('http_requests_total', { method: req.method, route: '/metrics', status_code: '200' });
      return;
    }

    if (req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end('{"status":"ok"}');
      incrementCounter('http_requests_total', { method: req.method, route: '/health', status_code: '200' });
      return;
    }

    if (req.url === '/generate-load') {
      await sleep(Math.floor(Math.random() * 100) + 10);
      res.statusCode = 200;
      res.end('Load generated');
      incrementCounter('http_requests_total', { method: req.method, route: '/generate-load', status_code: '200' });
      return;
    }

    res.statusCode = 404;
    res.end('Not Found');
    incrementCounter('http_requests_total', { method: req.method, route: req.url || '/', status_code: '404' });
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    observeDuration(durationSeconds);
    activeConnections--;
  }
});

server.listen(3000, () => {
  console.log('Test app listening on port 3000');
});
