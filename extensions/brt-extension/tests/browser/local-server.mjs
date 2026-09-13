import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
});

export async function startFixtureServer({ root, host = '127.0.0.1', port = 0 }) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://' + host);
      const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
      const decoded = decodeURIComponent(requestPath);
      const safePath = normalize(decoded).replace(/^([/\\])+/, '');
      const filePath = join(root, safePath);
      const relativePath = relative(root, filePath);

      if (
        relativePath === '..' ||
        relativePath.startsWith('..\\') ||
        relativePath.startsWith('../') ||
        isAbsolute(relativePath)
      ) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const body = await readFile(filePath);
      response.writeHead(200, {
        'content-type': MIME[extname(filePath)] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;

  return {
    url: 'http://' + host + ':' + resolvedPort,
    async close() {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  };
}
