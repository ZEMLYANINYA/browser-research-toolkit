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
    const cleanupByXhr = new WeakMap<XMLHttpRequest, () => void>();
    const finalizeByXhr = new WeakMap<XMLHttpRequest, () => void>();

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
      const finalizePrevious = finalizeByXhr.get(this);

      if (finalizePrevious && this.readyState === OriginalXHR.DONE) {
        finalizePrevious();
      } else {
        cleanupByXhr.get(this)?.();
      }

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

      cleanupByXhr.get(this)?.();

      let settled = false;

      const cleanupListeners = () => {
        if (settled) return;
        settled = true;

        this.removeEventListener('load', handleLoad);
        this.removeEventListener('error', handleError);
        this.removeEventListener('abort', handleAbort);
        this.removeEventListener('timeout', handleTimeout);

        if (cleanupByXhr.get(this) === cleanupListeners) {
          cleanupByXhr.delete(this);
        }

        if (finalizeByXhr.get(this) === finalizeResponse) {
          finalizeByXhr.delete(this);
        }
      };

      const finalizeResponse = () => {
        if (settled) return;

        requestData.status = this.status;
        requestData.statusText = this.statusText;

        cleanupListeners();

        analyzer
          .analyzeXhrResponse(this, requestData)
          .catch((err) =>
            ctx.logger.logError(
              'XHR Response Error',
              err,
              { requestId: id },
            ),
          );
      };

      const handleLoad = () => {
        finalizeResponse();
      };

      const handleError = () => {
        cleanupListeners();

        ctx.logger.logError(
          'XHR Error',
          new Error('Network Error'),
          requestData,
        );
      };

      const handleAbort = () => {
        cleanupListeners();
      };

      const handleTimeout = () => {
        cleanupListeners();
      };

      this.addEventListener('load', handleLoad);
      this.addEventListener('error', handleError);
      this.addEventListener('abort', handleAbort);
      this.addEventListener('timeout', handleTimeout);

      cleanupByXhr.set(this, cleanupListeners);
      finalizeByXhr.set(this, finalizeResponse);

      try {
        return originalSend.call(this, body as never);
      } catch (err) {
        cleanupListeners();
        throw err;
      }
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
