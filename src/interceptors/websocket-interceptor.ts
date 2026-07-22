import type { CollectorContext } from '../context.js';
import type { ResponseAnalyzer } from '../analysis/response-analyzer.js';
import type { Interceptor, WebSocketData } from '../types.js';

const MAX_MESSAGES_PER_SOCKET = 50;

export class WebSocketInterceptor implements Interceptor {
  private original: typeof window.WebSocket | null = null;

  constructor(
    private readonly ctx: CollectorContext,
    private readonly analyzer: ResponseAnalyzer,
  ) {}

  install(): void {
    this.original = window.WebSocket;
    const OriginalWebSocket = this.original;
    const ctx = this.ctx;
    const analyzer = this.analyzer;

    window.WebSocket = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
      if (!ctx.isActive) return new OriginalWebSocket(url, protocols);

      const ws = new OriginalWebSocket(url, protocols);
      const id = ctx.generateId();

      const wsData: WebSocketData = {
        id,
        type: 'websocket',
        url: ctx.sanitizer.sanitizeUrl(String(url)),
        protocols,
        timestamp: Date.now(),
        messages: [],
        state: 'connecting',
      };

      ctx.websockets.set(id, wsData);
      ctx.logger.logDiscovery('🔌 WEBSOCKET', `Connecting to ${ctx.sanitizer.truncate(String(url), 60)}`, wsData);

      ws.addEventListener('open', () => {
        wsData.state = 'open';
        ctx.logger.log('debug', `WebSocket opened: ${id}`);
      });

      ws.addEventListener('message', (event) => {
        if (wsData.messages.length > MAX_MESSAGES_PER_SOCKET) wsData.messages.shift();
        wsData.messages.push({
          type: 'received',
          data: ctx.sanitizer.sanitizeWebSocketData(event.data),
          timestamp: Date.now(),
        });
        analyzer.analyzeWebSocketMessage(event.data, id);
      });

      ws.addEventListener('close', () => {
        wsData.state = 'closed';
        wsData.closedAt = Date.now();
      });

      ws.addEventListener('error', (error) => {
        wsData.state = 'error';
        ctx.logger.logError('WebSocket Error', error, { wsId: id, url });
      });

      const originalSend = ws.send.bind(ws);
      ws.send = ((data: Parameters<typeof ws.send>[0]) => {
        if (wsData.messages.length > MAX_MESSAGES_PER_SOCKET) wsData.messages.shift();
        wsData.messages.push({
          type: 'sent',
          data: ctx.sanitizer.sanitizeWebSocketData(data),
          timestamp: Date.now(),
        });
        return originalSend(data);
      }) as typeof ws.send;

      return ws;
    } as unknown as typeof window.WebSocket;
  }

  restore(): void {
    if (this.original) window.WebSocket = this.original;
  }
}
