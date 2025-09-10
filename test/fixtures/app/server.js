const http = require('http');
const promClient = require('prom-client');

// Create a Registry which registers the metrics
const register = promClient.register;

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'promotel-test-app'
});

// Enable the collection of default metrics
promClient.collectDefaultMetrics();

// Create custom metrics
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active connections'
});

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

const responseTime = new promClient.Summary({
  name: 'response_time_seconds',
  help: 'Response time in seconds',
  percentiles: [0.5, 0.9, 0.99]
});

let connectionCount = 0;

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  connectionCount++;
  activeConnections.set(connectionCount);
  
  if (req.url === '/metrics') {
    res.setHeader('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
    httpRequestsTotal.inc({ method: req.method, route: '/metrics', status_code: '200' });
  } else if (req.url === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end('{"status":"ok"}');
    httpRequestsTotal.inc({ method: req.method, route: '/health', status_code: '200' });
  } else if (req.url === '/generate-load') {
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    res.end('Load generated');
    httpRequestsTotal.inc({ method: req.method, route: '/generate-load', status_code: '200' });
  } else {
    res.statusCode = 404;
    res.end('Not Found');
    httpRequestsTotal.inc({ method: req.method, route: req.url, status_code: '404' });
  }
  
  const duration = (Date.now() - start) / 1000;
  httpRequestDuration.observe(duration);
  responseTime.observe(duration);
  
  connectionCount--;
  activeConnections.set(connectionCount);
});

server.listen(3000, () => {
  console.log('Test app listening on port 3000');
});