import type { CollectorContext } from '../context.js';
import type { ResponseAnalyzer } from '../analysis/response-analyzer.js';
import type { Interceptor, RequestData } from '../types.js';

export class FetchInterceptor implements Interceptor {
  private original: typeof window.fetch | null = null;

  constructor(
    private readonly ctx: CollectorContext,
    private readonly analyzer: ResponseAnalyzer,
  ) {}

  install(): void {
    this.original = window.fetch.bind(window);
    const original = this.original;
    const ctx = this.ctx;
    const analyzer = this.analyzer;

    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      if (!ctx.isActive) return original(...args);

      const input = args[0];
      const options = (args[1] ?? {}) as RequestInit;
      // Bug fix: fetch(new Request(url, opts)) — a single-argument call where
      // method/headers live on the Request object itself — used to lose all of that,
      // because this only ever read args[1]. Explicit `init` fields (when a second
      // argument is *also* passed) still take precedence, matching how the Fetch spec
      // layers Request + init; this is an approximation of that, good enough for
      // observability purposes.
      const isRequestObject = typeof Request !== 'undefined' && input instanceof Request;
      const requestObj = isRequestObject ? (input as Request) : null;

      const url = typeof input === 'string' ? input : requestObj ? requestObj.url : String(input);
      const method = options.method || requestObj?.method || 'GET';
      const headersInit = options.headers ?? requestObj?.headers;
      const id = ctx.generateId();

      const requestData: RequestData = {
        id,
        type: 'fetch',
        url: ctx.sanitizer.sanitizeUrl(url),
        method,
        timestamp: Date.now(),
        headers: ctx.sanitizer.sanitizeHeaders(headersInit),
        body: ctx.sanitizer.sanitizeBody(options.body, url),
      };

      ctx.recordRequest(requestData);
      ctx.logger.logDiscovery('🌐 FETCH', `${method} ${ctx.sanitizer.truncate(url, 80)}`, requestData);

      try {
        const response = await original(...args);
        const cloned = response.clone();
        analyzer.analyzeFetchResponse(cloned, requestData).catch((err) =>
          ctx.logger.logError('Response Analysis Error', err, { requestId: id }),
        );
        return response;
      } catch (error) {
        ctx.logger.logError('Fetch Error', error, { url, method });
        throw error;
      }
    };
  }

  restore(): void {
    if (this.original) window.fetch = this.original;
  }
}
