import type { CollectorContext } from '../context.js';
import type { ResponseAnalyzer } from '../analysis/response-analyzer.js';
import type { Interceptor, RequestData } from '../types.js';

export class XhrInterceptor implements Interceptor {
  private original: typeof window.XMLHttpRequest | null = null;
  private installedConstructor: typeof window.XMLHttpRequest | null = null;

  private originalOpen: XMLHttpRequest['open'] | null = null;
  private originalSetRequestHeader: XMLHttpRequest['setRequestHeader'] | null = null;
  private originalSend: XMLHttpRequest['send'] | null = null;

  private installedOpen: XMLHttpRequest['open'] | null = null;
  private installedSetRequestHeader: XMLHttpRequest['setRequestHeader'] | null = null;
  private installedSend: XMLHttpRequest['send'] | null = null;

  private patchedPrototype: XMLHttpRequest | null = null;
  private restoreWrappedInstances: (() => void) | null = null;

  constructor(
    private readonly ctx: CollectorContext,
    private readonly analyzer: ResponseAnalyzer,
  ) {}

  install(): void {
    this.original = window.XMLHttpRequest;

    const OriginalXHR = this.original;
    const ctx = this.ctx;
    const analyzer = this.analyzer;

    /*
     * A page may already have installed a constructor wrapper. The object
     * returned by that constructor can have a prototype unrelated to
     * OriginalXHR.prototype, so discover the prototype that actually owns
     * the native-style XHR methods.
     */
    const probe = new OriginalXHR();

    let proto = Object.getPrototypeOf(probe) as XMLHttpRequest | null;

    while (
      proto &&
      (!Object.prototype.hasOwnProperty.call(proto, 'open') ||
        !Object.prototype.hasOwnProperty.call(
          proto,
          'setRequestHeader',
        ) ||
        !Object.prototype.hasOwnProperty.call(proto, 'send'))
    ) {
      proto = Object.getPrototypeOf(proto) as XMLHttpRequest | null;
    }

    if (!proto) {
      proto = OriginalXHR.prototype;
    }

    this.patchedPrototype = proto;

    const requestDataByXhr =
      new WeakMap<XMLHttpRequest, RequestData>();

    const cleanupByXhr =
      new WeakMap<XMLHttpRequest, () => void>();

    const finalizeByXhr =
      new WeakMap<XMLHttpRequest, () => void>();

    /*
     * These guards matter when an own method installed before BRT delegates
     * dynamically through the prototype. Without them the own wrapper would
     * enter the BRT prototype wrapper a second time.
     */
    const bypassOpen = new WeakSet<XMLHttpRequest>();
    const bypassSetRequestHeader =
      new WeakSet<XMLHttpRequest>();
    const bypassSend = new WeakSet<XMLHttpRequest>();

    const doneState =
      typeof OriginalXHR.DONE === 'number'
        ? OriginalXHR.DONE
        : 4;

    const originalOpen = proto.open;
    const originalSetRequestHeader =
      proto.setRequestHeader;
    const originalSend = proto.send;

    this.originalOpen = originalOpen;
    this.originalSetRequestHeader =
      originalSetRequestHeader;
    this.originalSend = originalSend;

    const openThrough = (
      xhr: XMLHttpRequest,
      method: string,
      url: string,
      _rest: unknown[],
      invoke: () => unknown,
    ) => {
      const previousRequestData =
        requestDataByXhr.get(xhr);

      const previousCleanup =
        cleanupByXhr.get(xhr);

      const previousFinalize =
        finalizeByXhr.get(xhr);

      /*
       * readystatechange(DONE) precedes load. Application code is allowed to
       * reopen the same XHR there, so preserve a completed HTTP response
       * before native open() resets its observable state.
       *
       * Error/timeout/abort paths normally expose status 0 and must not be
       * analyzed as successful responses.
       */
      if (
        previousFinalize &&
        xhr.readyState === doneState
      ) {
        let completedStatus = 0;

        try {
          completedStatus = xhr.status;
        } catch {
          completedStatus = 0;
        }

        if (completedStatus !== 0) {
          previousFinalize();
        }
      }

      const requestData: RequestData = {
        id: ctx.generateId(),
        type: 'xhr',
        url: ctx.sanitizer.sanitizeUrl(url),
        method,
        timestamp: Date.now(),
      };

      /*
       * Expose the provisional request before native open(). Native open()
       * may synchronously dispatch readystatechange and application code may
       * call send() from that callback.
       */
      requestDataByXhr.set(xhr, requestData);

      try {
        const result = invoke();

        /*
         * The replacement open succeeded. Only now may the previous request
         * lifecycle be retired. The captured cleanup function checks its own
         * identity before deleting map entries, so a newly installed
         * lifecycle is not accidentally removed.
         */
        previousCleanup?.();

        return result;
      } catch (err) {
        /*
         * Native validation rejected the replacement open. Restore the old
         * request state and keep its terminal listeners alive.
         */
        if (
          requestDataByXhr.get(xhr) === requestData
        ) {
          if (previousRequestData) {
            requestDataByXhr.set(
              xhr,
              previousRequestData,
            );
          } else {
            requestDataByXhr.delete(xhr);
          }
        }

        throw err;
      }
    };

    const setRequestHeaderThrough = (
      xhr: XMLHttpRequest,
      name: string,
      value: string,
      invoke: () => unknown,
    ) => {
      const requestData =
        requestDataByXhr.get(xhr);

      if (requestData) {
        requestData.headers ??= {};

        const sanitizedHeaders =
          ctx.sanitizer.sanitizeHeaders({
            [name]: value,
          });

        Object.assign(
          requestData.headers,
          sanitizedHeaders,
        );
      }

      return invoke();
    };

    const sendThrough = (
      xhr: XMLHttpRequest,
      body: Document | XMLHttpRequestBodyInit | null | undefined,
      invoke: () => unknown,
    ) => {
      const requestData =
        requestDataByXhr.get(xhr);

      if (!ctx.isActive || !requestData) {
        return invoke();
      }

      /*
       * A second send() while the first request is still active belongs to
       * the native XHR state machine. Do not duplicate the request record or
       * replace the first send's terminal listeners.
       */
      if (cleanupByXhr.has(xhr)) {
        return invoke();
      }

      requestData.body =
        ctx.sanitizer.sanitizeBody(
          body,
          requestData.url,
        );

      ctx.recordRequest(requestData);

      ctx.logger.logDiscovery(
        '🌐 XHR',
        `${requestData.method} ${ctx.sanitizer.truncate(
          requestData.url,
          80,
        )}`,
        requestData,
      );

      const id = requestData.id;

      let settled = false;

      const cleanupListeners = () => {
        if (settled) return;

        settled = true;

        xhr.removeEventListener(
          'load',
          handleLoad,
          true,
        );

        xhr.removeEventListener(
          'error',
          handleError,
          true,
        );

        xhr.removeEventListener(
          'abort',
          handleAbort,
          true,
        );

        xhr.removeEventListener(
          'timeout',
          handleTimeout,
          true,
        );

        if (
          cleanupByXhr.get(xhr) ===
          cleanupListeners
        ) {
          cleanupByXhr.delete(xhr);
        }

        if (
          finalizeByXhr.get(xhr) ===
          finalizeResponse
        ) {
          finalizeByXhr.delete(xhr);
        }
      };

      const finalizeResponse = () => {
        if (settled) return;

        requestData.status = xhr.status;
        requestData.statusText =
          xhr.statusText;

        cleanupListeners();

        analyzer
          .analyzeXhrResponse(
            xhr,
            requestData,
          )
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

      /*
       * Capture listeners observe terminal events before ordinary page
       * listeners can immediately reopen the same XHR.
       */
      xhr.addEventListener(
        'load',
        handleLoad,
        true,
      );

      xhr.addEventListener(
        'error',
        handleError,
        true,
      );

      xhr.addEventListener(
        'abort',
        handleAbort,
        true,
      );

      xhr.addEventListener(
        'timeout',
        handleTimeout,
        true,
      );

      cleanupByXhr.set(
        xhr,
        cleanupListeners,
      );

      finalizeByXhr.set(
        xhr,
        finalizeResponse,
      );

      try {
        return invoke();
      } catch (err) {
        cleanupListeners();
        throw err;
      }
    };

    /*
     * Prototype interception preserves Dynatrace/RUM-style calls such as
     * XMLHttpRequest.prototype.open.apply(xhr, args).
     */
    proto.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string,
      ...rest: unknown[]
    ) {
      if (bypassOpen.has(this)) {
        return Reflect.apply(
          originalOpen,
          this,
          [method, url, ...rest],
        );
      }

      return openThrough(
        this,
        method,
        url,
        rest,
        () =>
          Reflect.apply(
            originalOpen,
            this,
            [method, url, ...rest],
          ),
      );
    } as typeof proto.open;

    this.installedOpen = proto.open;

    proto.setRequestHeader = function (
      this: XMLHttpRequest,
      name: string,
      value: string,
    ) {
      if (
        bypassSetRequestHeader.has(this)
      ) {
        return originalSetRequestHeader.call(
          this,
          name,
          value,
        );
      }

      return setRequestHeaderThrough(
        this,
        name,
        value,
        () =>
          originalSetRequestHeader.call(
            this,
            name,
            value,
          ),
      );
    } as typeof proto.setRequestHeader;

    this.installedSetRequestHeader =
      proto.setRequestHeader;

    proto.send = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      if (bypassSend.has(this)) {
        return originalSend.call(
          this,
          body as never,
        );
      }

      return sendThrough(
        this,
        body,
        () =>
          originalSend.call(
            this,
            body as never,
          ),
      );
    } as typeof proto.send;

    this.installedSend = proto.send;

    /*
     * Some preinstalled monitoring constructors attach own XHR methods to
     * every returned instance and keep cached native delegates. Patching the
     * prototype cannot observe those calls, so instances created while BRT
     * is active receive reversible wrappers around such own methods.
     */
    type OwnMethodName =
      | 'open'
      | 'setRequestHeader'
      | 'send';

    type OwnMethod =
      (...args: unknown[]) => unknown;

    interface OwnRestore {
      xhr: XMLHttpRequest;
      key: OwnMethodName;
      descriptor: PropertyDescriptor;
      installed: OwnMethod;
    }

    const ownRestores: OwnRestore[] = [];

    const installOwnWrapper = (
      xhr: XMLHttpRequest,
      key: OwnMethodName,
      createWrapper: (
        original: OwnMethod,
      ) => OwnMethod,
    ) => {
      const descriptor =
        Object.getOwnPropertyDescriptor(
          xhr,
          key,
        );

      if (
        !descriptor ||
        typeof descriptor.value !==
          'function'
      ) {
        return;
      }

      /*
       * A non-configurable but writable data property may still have its
       * value replaced. A non-writable/non-configurable property cannot be
       * safely intercepted without violating page semantics.
       */
      if (
        descriptor.configurable ===
          false &&
        descriptor.writable !== true
      ) {
        return;
      }

      const original =
        descriptor.value as OwnMethod;

      const installed =
        createWrapper(original);

      try {
        Object.defineProperty(
          xhr,
          key,
          {
            ...descriptor,
            value: installed,
          },
        );

        ownRestores.push({
          xhr,
          key,
          descriptor,
          installed,
        });
      } catch {
        // Best-effort compatibility only.
      }
    };

    const wrapOwnMethods = (
      xhr: XMLHttpRequest,
    ) => {
      installOwnWrapper(
        xhr,
        'open',
        (original) => {
          const ownOpen =
            original as unknown as XMLHttpRequest['open'];

          return function (
            this: XMLHttpRequest,
            method: string,
            url: string,
            ...rest: unknown[]
          ) {
            return openThrough(
              this,
              method,
              url,
              rest,
              () => {
                bypassOpen.add(this);

                try {
                  return Reflect.apply(
                    ownOpen,
                    this,
                    [
                      method,
                      url,
                      ...rest,
                    ],
                  );
                } finally {
                  bypassOpen.delete(this);
                }
              },
            );
          } as unknown as OwnMethod;
        },
      );

      installOwnWrapper(
        xhr,
        'setRequestHeader',
        (original) => {
          const ownSetRequestHeader =
            original as unknown as XMLHttpRequest['setRequestHeader'];

          return function (
            this: XMLHttpRequest,
            name: string,
            value: string,
          ) {
            return setRequestHeaderThrough(
              this,
              name,
              value,
              () => {
                bypassSetRequestHeader.add(
                  this,
                );

                try {
                  return Reflect.apply(
                    ownSetRequestHeader,
                    this,
                    [name, value],
                  );
                } finally {
                  bypassSetRequestHeader.delete(
                    this,
                  );
                }
              },
            );
          } as unknown as OwnMethod;
        },
      );

      installOwnWrapper(
        xhr,
        'send',
        (original) => {
          const ownSend =
            original as unknown as XMLHttpRequest['send'];

          return function (
            this: XMLHttpRequest,
            body?: Document | XMLHttpRequestBodyInit | null,
          ) {
            return sendThrough(
              this,
              body,
              () => {
                bypassSend.add(this);

                try {
                  return Reflect.apply(
                    ownSend,
                    this,
                    [body],
                  );
                } finally {
                  bypassSend.delete(this);
                }
              },
            );
          } as unknown as OwnMethod;
        },
      );
    };

    this.restoreWrappedInstances =
      () => {
        for (
          const entry of ownRestores
        ) {
          const current =
            Object.getOwnPropertyDescriptor(
              entry.xhr,
              entry.key,
            );

          /*
           * Preserve instrumentation installed after BRT. Restore an own
           * method only while the property still points to BRT's wrapper.
           */
          if (
            current?.value !==
            entry.installed
          ) {
            continue;
          }

          try {
            Object.defineProperty(
              entry.xhr,
              entry.key,
              entry.descriptor,
            );
          } catch {
            // Best-effort cleanup.
          }
        }

        ownRestores.length = 0;
      };

    /*
     * The constructor wrapper exists only to observe objects returned by an
     * already-wrapped XMLHttpRequest constructor. It still returns the real
     * XHR object and exposes the original constructor prototype/statics.
     */
    const WrappedXHR =
      function XMLHttpRequest(
        this: unknown,
        ...args: unknown[]
      ): XMLHttpRequest {
        if (!new.target) {
          throw new TypeError(
            "Failed to construct 'XMLHttpRequest': Please use the 'new' operator.",
          );
        }

        const Constructor =
          OriginalXHR as unknown as new (
            ...constructorArgs: unknown[]
          ) => XMLHttpRequest;

        const xhr =
          new Constructor(...args);

        wrapOwnMethods(xhr);

        return xhr;
      } as unknown as typeof window.XMLHttpRequest;

    (
      WrappedXHR as unknown as {
        prototype: XMLHttpRequest;
      }
    ).prototype =
      OriginalXHR.prototype;

    Object.setPrototypeOf(
      WrappedXHR,
      OriginalXHR,
    );

    this.installedConstructor =
      WrappedXHR;

    window.XMLHttpRequest =
      WrappedXHR;
  }

  restore(): void {
    if (
      !this.original ||
      !this.patchedPrototype
    ) {
      return;
    }

    const proto =
      this.patchedPrototype;

    this.restoreWrappedInstances?.();

    if (
      this.installedConstructor &&
      window.XMLHttpRequest ===
        this.installedConstructor
    ) {
      window.XMLHttpRequest =
        this.original;
    }

    if (
      this.originalOpen &&
      this.installedOpen &&
      proto.open ===
        this.installedOpen
    ) {
      proto.open =
        this.originalOpen;
    }

    if (
      this.originalSetRequestHeader &&
      this.installedSetRequestHeader &&
      proto.setRequestHeader ===
        this.installedSetRequestHeader
    ) {
      proto.setRequestHeader =
        this.originalSetRequestHeader;
    }

    if (
      this.originalSend &&
      this.installedSend &&
      proto.send ===
        this.installedSend
    ) {
      proto.send =
        this.originalSend;
    }

    this.original = null;
    this.installedConstructor = null;

    this.originalOpen = null;
    this.originalSetRequestHeader =
      null;
    this.originalSend = null;

    this.installedOpen = null;
    this.installedSetRequestHeader =
      null;
    this.installedSend = null;

    this.patchedPrototype = null;
    this.restoreWrappedInstances =
      null;
  }
}