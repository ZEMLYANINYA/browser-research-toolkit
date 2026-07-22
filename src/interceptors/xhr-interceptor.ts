import type { CollectorContext } from '../context.js';
import type { ResponseAnalyzer } from '../analysis/response-analyzer.js';
import type { Interceptor, RequestData } from '../types.js';

export class XhrInterceptor implements Interceptor {
  private original: typeof window.XMLHttpRequest | null = null;

  constructor(
    private readonly ctx: CollectorContext,
    private readonly analyzer: ResponseAnalyzer,
  ) {}

  install(): void {
    this.original = window.XMLHttpRequest;
    const OriginalXHR = this.original;
    const ctx = this.ctx;
    const analyzer = this.analyzer;

    window.XMLHttpRequest = function (this: XMLHttpRequest) {
      const xhr = new OriginalXHR();
      const id = ctx.generateId();
      let requestData: RequestData = { id, type: 'xhr', url: '', timestamp: Date.now() };

      const originalOpen = xhr.open.bind(xhr);
      xhr.open = ((method: string, url: string, ...rest: unknown[]) => {
        requestData = {
          ...requestData,
          url: ctx.sanitizer.sanitizeUrl(url),
          method,
          timestamp: Date.now(),
        };
        return (originalOpen as (...a: unknown[]) => void)(method, url, ...rest);
      }) as typeof xhr.open;

      // Bug fix: fetch's headers came from `options.headers`, but XHR sets headers via
      // this call — which nothing here was intercepting, so `requestData.headers` was
      // always undefined for every XHR request regardless of what was actually sent.
      const originalSetRequestHeader = xhr.setRequestHeader.bind(xhr);
      xhr.setRequestHeader = ((name: string, value: string) => {
        requestData.headers ??= {};
        const sanitizedHeaders = ctx.sanitizer.sanitizeHeaders({ [name]: value });
        Object.assign(requestData.headers, sanitizedHeaders);
        return originalSetRequestHeader(name, value);
      }) as typeof xhr.setRequestHeader;

      const originalSend = xhr.send.bind(xhr);
      xhr.send = ((body?: Document | XMLHttpRequestBodyInit | null) => {
        if (!ctx.isActive) return originalSend(body as never);

        requestData.body = ctx.sanitizer.sanitizeBody(body, requestData.url);
        ctx.recordRequest(requestData);
        ctx.logger.logDiscovery('🌐 XHR', `${requestData.method} ${ctx.sanitizer.truncate(requestData.url, 80)}`, requestData);

        xhr.addEventListener('load', () => {
          requestData.status = xhr.status;
          requestData.statusText = xhr.statusText;
          analyzer.analyzeXhrResponse(xhr, requestData).catch((err) =>
            ctx.logger.logError('XHR Response Error', err, { requestId: id }),
          );
        });

        xhr.addEventListener('error', () => {
          ctx.logger.logError('XHR Error', new Error('Network Error'), requestData);
        });

        return originalSend(body as never);
      }) as typeof xhr.send;

      return xhr;
    } as unknown as typeof window.XMLHttpRequest;
  }

  restore(): void {
    if (this.original) window.XMLHttpRequest = this.original;
  }
}
