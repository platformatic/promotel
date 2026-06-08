import { createServer } from 'node:http';
import { once } from 'node:events';

export async function createMockOTLPEndpoint() {
  const requests: Uint8Array[] = [];

  const server = createServer(async (req, res) => {
    const chunks: Uint8Array[] = [];

    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }

    requests.push(Buffer.concat(chunks));
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end('{}');
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind mock OTLP endpoint');
  }

  return {
    url: `http://127.0.0.1:${address.port}/v1/metrics`,
    requests,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}
