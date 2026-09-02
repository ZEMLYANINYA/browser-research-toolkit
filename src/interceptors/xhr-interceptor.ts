import type { CollectorContext } from '../context.js';
import type { ResponseAnalyzer } from '../analysis/response-analyzer.js';
import type { Interceptor, RequestData } from '../types.js';

export class XhrInterceptor implements Interceptor {
  private original: typeof window.XMLHttpRequest | null = null;
  private originalOpen: XMLHttpRequest['open'] | null = null;
  private originalSetRequestHeader: XMLHttpRequest['setRequestHeader'] | null = null;
  private originalSend: XMLHttpRequest['send'] | null = null;

  private installedOpen: XMLHttpRequest['open'] | null = null;
  private installedSetRequestHeader: XMLHttpRequest['setRequestHeader'] | null = null;
  private installedSend: XMLHttpRequest['send'] | null = null;
  private patchedPrototype: XMLHttpRequest | null = null;

  constructor(
    private readonly ctx: CollectorContext,
    private readonly analyzer: ResponseAnalyzer,
  ) {}

  install(): void {
    this.original = window.XMLHttpRequest;

    const OriginalXHR = this.original;

    // A page may already have replaced window.XMLHttpRequest with a wrapper
    // constructor whose .prototype is unrelated to the native XHR instances
    // it returns. Discover the prototype that actually owns the XHR methods.
    const probe = new OriginalXHR();

    let proto = Object.getPrototypeOf(probe) as XMLHttpRequest | null;

    while (
      proto &&
      (!Object.prototype.hasOwnProperty.call(proto, 'open') ||
        !Object.prototype.hasOwnProperty.call(proto, 'setRequestHeader') ||
        !Object.prototype.hasOwnProperty.call(proto, 'send'))
    ) {
      proto = Object.getPrototypeOf(proto) as XMLHttpRequest | null;
    }

    if (!proto) {
      proto = OriginalXHR.prototype;
    }

    this.patchedPrototype = proto;

    const ctx = this.ctx;
    const analyzer = this.analyzer;

    const requestDataByXhr = new WeakMap<XMLHttpRequest, RequestData>();
    const cleanupByXhr = new WeakMap<XMLHttpRequest, () => void>();

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
      cleanupByXhr.get(this)?.();

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

    this.installedOpen = proto.open;

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

    this.installedSetRequestHeader = proto.setRequestHeader;

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

        this.removeEventListener('load', handleLoad, true);
        this.removeEventListener('error', handleError, true);
        this.removeEventListener('abort', handleAbort, true);
        this.removeEventListener('timeout', handleTimeout, true);

        if (cleanupByXhr.get(this) === cleanupListeners) {
          cleanupByXhr.delete(this);
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

      // Terminal handlers use capture so BRT observes completion before
      // ordinary application listeners can immediately reopen the same XHR.
      this.addEventListener('load', handleLoad, true);
      this.addEventListener('error', handleError, true);
      this.addEventListener('abort', handleAbort, true);
      this.addEventListener('timeout', handleTimeout, true);

      cleanupByXhr.set(this, cleanupListeners);

      try {
        return originalSend.call(this, body as never);
      } catch (err) {
        cleanupListeners();
        throw err;
      }
    } as typeof proto.send;

    this.installedSend = proto.send;
  }

  restore(): void {
    if (!this.original || !this.patchedPrototype) return;

    const proto = this.patchedPrototype;

    if (
      this.originalOpen &&
      this.installedOpen &&
      proto.open === this.installedOpen
    ) {
      proto.open = this.originalOpen;
    }

    if (
      this.originalSetRequestHeader &&
      this.installedSetRequestHeader &&
      proto.setRequestHeader === this.installedSetRequestHeader
    ) {
      proto.setRequestHeader = this.originalSetRequestHeader;
    }

    if (
      this.originalSend &&
      this.installedSend &&
      proto.send === this.installedSend
    ) {
      proto.send = this.originalSend;
    }

    this.original = null;
    this.originalOpen = null;
    this.originalSetRequestHeader = null;
    this.originalSend = null;

    this.installedOpen = null;
    this.installedSetRequestHeader = null;
    this.installedSend = null;
    this.patchedPrototype = null;
  }
}
