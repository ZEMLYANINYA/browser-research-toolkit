import type { CollectorContext } from '../context.js';
import type { ResponseAnalyzer } from '../analysis/response-analyzer.js';
import type { Interceptor, RequestData } from '../types.js';

export class XhrInterceptor implements Interceptor {
  private original: typeof window.XMLHttpRequest | null = null;
  private originalOpen: XMLHttpRequest['open'] | null = null;
  private originalSetRequestHeader: XMLHttpRequest['setRequestHeader'] | null = null;
  private originalSend: XMLHttpRequest['send'] | null = null;

  constructor(
    private readonly ctx: CollectorContext,
    private readonly analyzer: ResponseAnalyzer,
  ) {}

  install(): void {
    this.original = window.XMLHttpRequest;

    const OriginalXHR = this.original;
    const proto = OriginalXHR.prototype;
    const ctx = this.ctx;
    const analyzer = this.analyzer;

    const requestDataByXhr = new WeakMap<XMLHttpRequest, RequestData>();

    const originalOpen = proto.open;
    const originalSetRequestHeader = proto.setRequestHeader;
    const originalSend = proto.send;

    this.originalOpen = originalOpen;
    this.originalSetRequestHeader = originalSetRequestHeader;
    this.originalSend = originalSend;

    proto.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string,
      ...rest: unknown[]
    ) {
      const requestData: RequestData = {
        id: ctx.generateId(),
        type: 'xhr',
        url: ctx.sanitizer.sanitizeUrl(url),
        method,
        timestamp: Date.now(),
      };

      requestDataByXhr.set(this, requestData);

      return Reflect.apply(originalOpen, this, [
        method,
        url,
        ...rest,
      ]);
    } as typeof proto.open;

    proto.setRequestHeader = function (
      this: XMLHttpRequest,
      name: string,
      value: string,
    ) {
      const requestData = requestDataByXhr.get(this);

      if (requestData) {
        requestData.headers ??= {};

        const sanitizedHeaders =
          ctx.sanitizer.sanitizeHeaders({ [name]: value });

        Object.assign(requestData.headers, sanitizedHeaders);
      }

      return originalSetRequestHeader.call(this, name, value);
    } as typeof proto.setRequestHeader;

    proto.send = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const requestData = requestDataByXhr.get(this);

      if (!ctx.isActive || !requestData) {
        return originalSend.call(this, body as never);
      }

      requestData.body =
        ctx.sanitizer.sanitizeBody(body, requestData.url);

      ctx.recordRequest(requestData);

      ctx.logger.logDiscovery(
        '🌐 XHR',
        `${requestData.method} ${ctx.sanitizer.truncate(requestData.url, 80)}`,
        requestData,
      );

      const id = requestData.id;

      this.addEventListener('load', () => {
        requestData.status = this.status;
        requestData.statusText = this.statusText;

        analyzer
          .analyzeXhrResponse(this, requestData)
          .catch((err) =>
            ctx.logger.logError(
              'XHR Response Error',
              err,
              { requestId: id },
            ),
          );
      });

      this.addEventListener('error', () => {
        ctx.logger.logError(
          'XHR Error',
          new Error('Network Error'),
          requestData,
        );
      });

      return originalSend.call(this, body as never);
    } as typeof proto.send;
  }

  restore(): void {
    if (!this.original) return;

    const proto = this.original.prototype;

    if (this.originalOpen) {
      proto.open = this.originalOpen;
    }

    if (this.originalSetRequestHeader) {
      proto.setRequestHeader = this.originalSetRequestHeader;
    }

    if (this.originalSend) {
      proto.send = this.originalSend;
    }

    window.XMLHttpRequest = this.original;

    this.original = null;
    this.originalOpen = null;
    this.originalSetRequestHeader = null;
    this.originalSend = null;
  }
}
