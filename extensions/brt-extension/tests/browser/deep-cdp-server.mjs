import http from 'node:http';
import { WebSocketServer } from 'ws';

export async function startDeepCdpServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      });

      response.end([
        '<!doctype html>',
        '<meta charset="utf-8">',
        '<title>BRT deep CDP fixture</title>',
        '<h1>BRT deep CDP fixture</h1>',
        '<button id="run-deep">Run deep fixture</button>',
        '<div id="result"></div>'
      ].join('\n'));
      return;
    }

    if (url.pathname === '/deep.js') {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store'
      });

      response.end([
        'window.runDeepFixture = () => new Promise((resolve, reject) => {',
        '  const socket = new WebSocket(window.__BRT_WS_URL__);',
        '  socket.addEventListener("open", () => socket.send("hello-brt"));',
        '  socket.addEventListener("message", event => {',
        '    document.querySelector("#result").textContent = event.data;',
        '    socket.close();',
        '    resolve(event.data);',
        '  });',
        '  socket.addEventListener("error", () => reject(new Error("websocket-error")));',
        '});'
      ].join('\n'));
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');

    if (url.pathname !== '/socket') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', socket => {
    socket.on('message', data => {
      socket.send('echo:' + data.toString());
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = address.port;

  return {
    url: 'http://127.0.0.1:' + port,
    wsUrl: 'ws://127.0.0.1:' + port + '/socket',
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }
  };
}
