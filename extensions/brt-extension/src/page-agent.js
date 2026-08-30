(() => {
  const CHANNEL = '__BRT_LAB_V01__';
  const AGENT_KEY = '__BRT_LAB_AGENT_V01__';
  if (window[AGENT_KEY]) {
    return;
  }

  const LIMITS = {
    maxResponseChars: 80_000,
    maxHtmlChars: 1_500_000,
    maxInlineScriptChars: 300_000,
    maxRuntimeEntries: 4000,
    maxResponseBytes: 160_000,
    maxStructuredBodyChars: 120_000,
    antiBotDomFlushMs: 400,
    antiBotTimerSampleRate: 0.02
  };

  const ANTIBOT_KEYWORDS = [
    'captcha', 'recaptcha', 'hcaptcha', 'turnstile', 'challenge', 'cf-chl', 'cloudflare',
    'verify', 'verification', 'webdriver', 'headless', 'fingerprint', 'managed-challenge'
  ];

  const SENSITIVE_QUERY_KEYS = new Set([
    'key', 'token', 'apikey', 'api_key', 'secret', 'auth', 'password',
    'access_token', 'refresh_token', 'session', 'sessionid', 'session_id', 'csrf', 'xsrf', 'code', 'signature', 'sig', 'jwt',
    'cid', 'sid', 'visitorid', 'visitor_id', 'clientid', 'client_id', 'deviceid', 'device_id', 'trackingid', 'tracking_id',
    'auid', 'ecid', 'gclid', 'fbclid', 'msclkid', '_ga', '_gid'
  ]);
  const SENSITIVE_FIELD = /^(authorization|proxy-authorization|cookie|set-cookie|x-csrf.*|x-xsrf.*|.*(?:token|secret|password|passwd|apikey|api_key|access_token|refresh_token|session|signature|jwt|visitor[_-]?id|client[_-]?id|device[_-]?id|tracking[_-]?id).*)$/i;
  const SENSITIVE_BODY = /\b(csrf|xsrf|access[_-]?token|refresh[_-]?token|password|passwd|secret|api[_-]?key|session(?:id)?|signature|jwt|token|visitor[_-]?id|client[_-]?id|device[_-]?id|tracking[_-]?id)\b\s*["']?\s*[:=]\s*["']?([^\s,&"'}]+)/gi;
  const AUTH_HEADER_TEXT = /\b(authorization|proxy-authorization)\b\s*["']?\s*[:=]\s*["']?[^\r\n,;&}]+/gi;
  const COOKIE_HEADER_TEXT = /\b(cookie|set-cookie)\b\s*["']?\s*[:=]\s*["']?[^\r\n}]+/gi;

  const state = {
    active: false,
    seq: 0,
    startedAt: 0,
    observer: null,
    originals: {},
    wrappers: {},
    generation: 0,
    runId: null,
    captureMode: 'standard',
    captureSettings: { antibot: false, timers: false, websocket: true, sse: true },
    xhrMeta: new WeakMap(),
    listeners: [],
    watches: new Set()
  };

  const nowRecord = () => ({
    sequence: ++state.seq,
    eventId: `evt_${Date.now().toString(36)}_${state.seq}`,
    generation: state.generation,
    runId: state.runId,
    wallTime: Date.now(),
    monotonicTime: typeof performance?.now === 'function' ? performance.now() : null,
    performanceTimeOrigin: typeof performance?.timeOrigin === 'number' ? performance.timeOrigin : null,
    documentId: `${location.origin}${location.pathname}|${performance.timeOrigin || state.startedAt}`,
    frameId: 0
  });

  const emit = (kind, data = {}) => {
    if (!state.active && kind !== 'agent-status') return;
    window.postMessage({
      channel: CHANNEL,
      direction: 'PAGE_TO_EXTENSION',
      payload: { kind, ...nowRecord(), data }
    }, '*');
  };

  const trim = (value, max) => {
    const text = typeof value === 'string' ? value : String(value ?? '');
    return text.length > max ? text.slice(0, max) + '\n/* …truncated… */' : text;
  };

  const isSensitiveQueryKey = (key) => {
    const lower = String(key || '').toLowerCase();
    if (SENSITIVE_QUERY_KEYS.has(lower)) return true;
    const compact = lower.replace(/[^a-z0-9]/g, '');
    if (SENSITIVE_QUERY_KEYS.has(compact)) return true;
    return lower.split(/[.\[\]_-]+/).filter(Boolean).some(part => SENSITIVE_QUERY_KEYS.has(part) || /^(visitor|client|device|tracking)id$/.test(part));
  };

  const redactSensitiveText = (value, max = LIMITS.maxResponseChars) => trim(String(value ?? '')
    .replace(AUTH_HEADER_TEXT, '$1=[REDACTED]')
    .replace(COOKIE_HEADER_TEXT, '$1=[REDACTED]')
    .replace(SENSITIVE_BODY, '$1=[REDACTED]'), max);

  const sanitizeUrl = (raw) => {
    if (!raw || typeof raw !== 'string') return raw ?? '';
    try {
      const u = new URL(raw, location.href);
      for (const key of [...u.searchParams.keys()]) {
        const value = u.searchParams.get(key) || '';
        if (isSensitiveQueryKey(key)) u.searchParams.set(key, '[REDACTED]');
        else if (value.length > 256) u.searchParams.set(key, `[TRUNCATED:${value.length}]`);
      }
      if (u.hash) {
        const p = new URLSearchParams(u.hash.slice(1));
        let changed = false;
        for (const key of [...p.keys()]) {
          if (isSensitiveQueryKey(key)) {
            p.set(key, '[REDACTED]');
            changed = true;
          }
        }
        u.hash = changed ? p.toString() : '[REDACTED]';
      }
      return u.toString();
    } catch {
      return '[UNPARSEABLE_URL_REDACTED]';
    }
  };

  const sanitizeObject = (value, depth = 0, seen = new WeakSet()) => {
    if (depth > 7) return '[DepthLimit]';
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    try {
      const keys = Object.keys(value).slice(0, 200);
      const read = (key) => {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor) return '[MISSING]';
          return 'value' in descriptor ? descriptor.value : '[ACCESSOR_NOT_INVOKED]';
        } catch { return '[UNREADABLE]'; }
      };
      if (Array.isArray(value)) return keys.map(key => sanitizeObject(read(key), depth + 1, seen));
      const out = {};
      for (const key of keys) out[key] = SENSITIVE_FIELD.test(key) ? '[REDACTED]' : sanitizeObject(read(key), depth + 1, seen);
      return out;
    } finally {
      seen.delete(value);
    }
  };

  const sanitizeTextBody = (text) => {
    if (typeof text !== 'string') return '';
    const bounded = text.length > LIMITS.maxStructuredBodyChars
      ? text.slice(0, LIMITS.maxResponseChars)
      : text;
    if (text.length <= LIMITS.maxStructuredBodyChars) {
      try {
        const parsed = JSON.parse(text);
        return trim(JSON.stringify(sanitizeObject(parsed)), LIMITS.maxResponseChars);
      } catch {}
    }
    return redactSensitiveText(bounded, LIMITS.maxResponseChars);
  };

  async function readResponseTextBounded(response, maxBytes) {
    const reader = response?.body?.getReader?.();
    if (!reader) return { text: '', bytesRead: 0, truncated: false, unavailable: true };
    const decoder = new TextDecoder();
    let text = '';
    let bytesRead = 0;
    let truncated = false;
    try {
      while (bytesRead < maxBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        const remaining = maxBytes - bytesRead;
        if (value.byteLength > remaining) {
          text += decoder.decode(value.subarray(0, remaining), { stream: true });
          bytesRead += remaining;
          truncated = true;
          await reader.cancel('BRT body cap reached').catch(() => {});
          break;
        }
        text += decoder.decode(value, { stream: true });
        bytesRead += value.byteLength;
      }
      text += decoder.decode();
      if (bytesRead >= maxBytes && !truncated) {
        truncated = true;
        await reader.cancel('BRT body cap reached').catch(() => {});
      }
      return { text, bytesRead, truncated, unavailable: false };
    } finally {
      try { reader.releaseLock?.(); } catch {}
    }
  }

  const describeTarget = (node) => {
    if (!(node instanceof Element)) return { node: node?.nodeName || 'unknown' };
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${redactSensitiveText(node.id, 100)}` : '';
    const classes = [...node.classList].slice(0, 4).map(c => `.${redactSensitiveText(c, 100)}`).join('');
    const role = node.getAttribute('role');
    const type = node.getAttribute('type');
    const name = node.getAttribute('name');
    return {
      selectorHint: trim(`${tag}${id}${classes}`, 300),
      role: role ? redactSensitiveText(role, 100) : null,
      type: type ? redactSensitiveText(type, 100) : null,
      name: name && !SENSITIVE_FIELD.test(name) ? redactSensitiveText(name, 100) : null
    };
  };

  function patchFetch() {
    if (state.originals.fetch) return;
    const original = window.fetch;
    state.originals.fetch = original;
    window.fetch = async function(input, init) {
      if (!state.active) return Reflect.apply(original, this, arguments);
      const capturedGeneration = state.generation;
      const capturedDocumentId = `${location.origin}${location.pathname}|${performance.timeOrigin || state.startedAt}`;
      let url = '';
      let method = 'GET';
      let body = null;
      try {
        if (input instanceof Request) {
          url = input.url;
          method = init?.method || input.method || 'GET';
        } else {
          url = String(input);
          method = init?.method || 'GET';
        }
        body = init?.body ?? null;
      } catch {}

      const requestId = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const requestStarted = performance.now();
      emit('network-request', {
        requestId,
        transport: 'fetch',
        method,
        url: sanitizeUrl(url),
        body: typeof body === 'string' ? sanitizeTextBody(body) : body ? `[${Object.prototype.toString.call(body)}]` : null
      });

      try {
        const response = await Reflect.apply(original, this, arguments);
        if (!state.active || capturedGeneration !== state.generation) return response;
        emit('network-response', {
          requestId,
          transport: 'fetch',
          url: sanitizeUrl(response.url || url),
          status: response.status,
          ok: response.ok,
          contentType: response.headers?.get?.('content-type') || null,
          duration: performance.now() - requestStarted
        });

        try {
          const contentType = response.headers?.get?.('content-type') || '';
          if (state.captureMode !== 'light' && /json|text|javascript|xml|html|graphql/i.test(contentType)) {
            const clone = response.clone();
            readResponseTextBounded(clone, LIMITS.maxResponseBytes).then(result => {
              if (!state.active || capturedGeneration !== state.generation || result.unavailable) return;
              emit('network-body', {
                requestId,
                url: sanitizeUrl(response.url || url),
                contentType,
                text: sanitizeTextBody(result.text),
                truncated: result.truncated,
                bytesRead: result.bytesRead,
                documentId: capturedDocumentId
              });
            }).catch(() => {});
          }
        } catch {}
        return response;
      } catch (error) {
        if (state.active && capturedGeneration === state.generation) emit('network-error', { requestId, transport: 'fetch', url: sanitizeUrl(url), message: trim(error?.message || String(error), 1000) });
        throw error;
      }
    };
    state.wrappers.fetch = window.fetch;
  }

  function patchXhr() {
    if (state.originals.xhrOpen) return;
    const proto = XMLHttpRequest.prototype;
    state.originals.xhrOpen = proto.open;
    state.originals.xhrSend = proto.send;
    state.originals.xhrSetRequestHeader = proto.setRequestHeader;

    proto.open = function(method, url) {
      state.xhrMeta.set(this, { method: String(method || 'GET'), url: String(url || ''), headers: {}, started: performance.now() });
      return Reflect.apply(state.originals.xhrOpen, this, arguments);
    };

    proto.setRequestHeader = function(name, value) {
      const meta = state.xhrMeta.get(this);
      if (meta) meta.headers[String(name)] = SENSITIVE_FIELD.test(String(name)) ? '[REDACTED]' : trim(String(value), 500);
      return Reflect.apply(state.originals.xhrSetRequestHeader, this, arguments);
    };

    proto.send = function(body) {
      const meta = state.xhrMeta.get(this) || { method: 'GET', url: '', headers: {} };
      const requestId = `x_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const capturedGeneration = state.generation;
      meta.requestId = requestId;
      state.xhrMeta.set(this, meta);
      if (state.active) {
        emit('network-request', {
          requestId,
          transport: 'xhr',
          method: meta.method,
          url: sanitizeUrl(meta.url),
          headers: meta.headers,
          body: typeof body === 'string' ? sanitizeTextBody(body) : body ? `[${Object.prototype.toString.call(body)}]` : null
        });
      }

      this.addEventListener('loadend', () => {
        if (!state.active || capturedGeneration !== state.generation) return;
        const ct = this.getResponseHeader?.('content-type') || '';
        emit('network-response', {
          requestId,
          transport: 'xhr',
          url: sanitizeUrl(this.responseURL || meta.url),
          status: this.status,
          ok: this.status >= 200 && this.status < 400,
          contentType: ct,
          duration: performance.now() - (meta.started || performance.now())
        });
        try {
          if (state.captureMode !== 'light' && /json|text|javascript|xml|html|graphql/i.test(ct) && typeof this.responseText === 'string') {
            if (!state.active || capturedGeneration !== state.generation) return;
            const responseText = this.responseText;
            const truncated = responseText.length > LIMITS.maxResponseChars;
            const boundedBody = responseText.length <= LIMITS.maxStructuredBodyChars
              ? responseText
              : responseText.slice(0, LIMITS.maxResponseChars);
            emit('network-body', {
              requestId,
              url: sanitizeUrl(this.responseURL || meta.url),
              contentType: ct,
              text: sanitizeTextBody(boundedBody),
              truncated,
              originalChars: responseText.length
            });
          }
        } catch {}
      }, { once: true });

      return Reflect.apply(state.originals.xhrSend, this, arguments);
    };
    state.wrappers.xhrOpen = proto.open;
    state.wrappers.xhrSend = proto.send;
    state.wrappers.xhrSetRequestHeader = proto.setRequestHeader;
  }

  function patchHistory() {
    if (state.originals.pushState) return;
    state.originals.pushState = history.pushState;
    state.originals.replaceState = history.replaceState;

    history.pushState = function() {
      const from = location.href;
      const result = Reflect.apply(state.originals.pushState, this, arguments);
      emit('navigation', { type: 'pushState', from: sanitizeUrl(from), to: sanitizeUrl(location.href) });
      lastUrl = location.href;
      return result;
    };
    history.replaceState = function() {
      const from = location.href;
      const result = Reflect.apply(state.originals.replaceState, this, arguments);
      emit('navigation', { type: 'replaceState', from: sanitizeUrl(from), to: sanitizeUrl(location.href) });
      lastUrl = location.href;
      return result;
    };
    state.wrappers.pushState = history.pushState;
    state.wrappers.replaceState = history.replaceState;

    let lastUrl = location.href;
    const onPop = () => {
      const next = location.href;
      emit('navigation', { type: 'popstate', from: sanitizeUrl(lastUrl), to: sanitizeUrl(next) });
      lastUrl = next;
    };
    const onHash = (e) => {
      emit('navigation', { type: 'hashchange', from: sanitizeUrl(e.oldURL), to: sanitizeUrl(e.newURL) });
      lastUrl = e.newURL;
    };
    addEventListener('popstate', onPop, true);
    addEventListener('hashchange', onHash, true);
    state.listeners.push(['popstate', onPop, true], ['hashchange', onHash, true]);
  }

  function installDomEvents() {
    const types = ['click', 'submit', 'keydown', 'input', 'change'];
    for (const type of types) {
      const handler = (event) => {
        if (!state.active) return;
        const target = event.target;
        const data = {
          type,
          isTrusted: Boolean(event.isTrusted),
          target: describeTarget(target)
        };
        if (type === 'keydown') data.key = ['Enter', 'Escape', 'Tab', ' ', 'ArrowUp', 'ArrowDown'].includes(event.key) ? event.key : '[other]';
        emit('dom-event', data);
      };
      document.addEventListener(type, handler, true);
      state.listeners.push([type, handler, true, document]);
    }
  }

  function emitScriptNode(script, reason) {
    if (!(script instanceof HTMLScriptElement)) return;
    if (script.src) {
      emit('source-url', { url: sanitizeUrl(script.src), rawUrl: script.src, reason, sourceType: 'external-script' });
    } else if (script.textContent?.trim() && state.captureMode !== 'light') {
      emit('source-inline', {
        label: `inline-script@${location.pathname}`,
        reason,
        sourceType: 'inline-script',
        text: sanitizeTextBody(trim(script.textContent, LIMITS.maxInlineScriptChars))
      });
    }
  }

  function installSourceObserver() {
    document.querySelectorAll('script').forEach(s => emitScriptNode(s, 'initial'));
    const observer = new MutationObserver((mutations) => {
      if (!state.active) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLScriptElement) emitScriptNode(node, 'mutation');
          if (node instanceof Element) node.querySelectorAll?.('script').forEach(s => emitScriptNode(s, 'mutation-subtree'));
        }
      }
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
    state.observers = state.observers || [];
    state.observers.push(observer);
  }

  function captureHtml() {
    if (state.captureMode === 'light') return;
    try {
      emit('html-snapshot', {
        url: sanitizeUrl(location.href),
        text: sanitizeTextBody(trim(document.documentElement?.outerHTML || '', LIMITS.maxHtmlChars))
      });
    } catch {}
  }

  function captureRuntimeTopLevel() {
    const entries = [];
    const keys = Reflect.ownKeys(window).filter(key => typeof key === 'string').slice(0, LIMITS.maxRuntimeEntries);
    for (const key of keys) {
      if (SENSITIVE_FIELD.test(key)) continue;
      let value;
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(window, key); } catch { continue; }
      if (!descriptor || !('value' in descriptor)) continue;
      value = descriptor.value;
      const type = typeof value;
      if (!['string', 'number', 'boolean', 'bigint', 'undefined'].includes(type) && value !== null) continue;
      entries.push({ key, type, value: trim(String(value), 1000) });
    }
    emit('runtime-snapshot', { entries });
  }

  function snapshotWithoutGetters(value, depth = 0, seen = new WeakSet()) {
    if (depth > 5) return '[DepthLimit]';
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.slice(0, 50).map(item => snapshotWithoutGetters(item, depth + 1, seen));
      const out = {};
      for (const key of Reflect.ownKeys(value).filter(key => typeof key === 'string').slice(0, 100)) {
        if (SENSITIVE_FIELD.test(key)) { out[key] = '[REDACTED]'; continue; }
        let descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { continue; }
        if (!descriptor) continue;
        if (!('value' in descriptor)) { out[key] = '[Accessor: not invoked]'; continue; }
        out[key] = snapshotWithoutGetters(descriptor.value, depth + 1, seen);
      }
      return out;
    } finally {
      seen.delete(value);
    }
  }

  function captureWatch(path) {
    const parts = String(path || '').replace(/^window\.?/, '').split('.').filter(Boolean);
    let current = window;
    for (const part of parts) {
      const descriptor = current && (typeof current === 'object' || typeof current === 'function') ? Object.getOwnPropertyDescriptor(current, part) : null;
      if (!descriptor) return { path, unavailable: true, observedAt: Date.now() };
      if (!('value' in descriptor)) return { path, accessor: true, value: '[Accessor: not invoked]', observedAt: Date.now() };
      current = descriptor.value;
    }
    return { path: `window.${parts.join('.')}`, value: snapshotWithoutGetters(current), observedAt: Date.now() };
  }

  function updateWatch(path) { emit('runtime-watch', captureWatch(path)); }

  async function captureWorkerAwareness() {
    try {
      const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
      emit('worker-awareness', { contextType: 'page', serviceWorkers: registrations.slice(0, 20).map(registration => ({ scope: sanitizeUrl(registration.scope), active: registration.active?.scriptURL ? sanitizeUrl(registration.active.scriptURL) : null, waiting: registration.waiting?.scriptURL ? sanitizeUrl(registration.waiting.scriptURL) : null })) });
    } catch (error) { emit('diagnostic', { kind: 'worker-awareness-failed', message: trim(error?.message || String(error), 500) }); }
    document.querySelectorAll('iframe').forEach(frame => { let sameOrigin = false; try { sameOrigin = Boolean(frame.contentDocument); } catch {} emit('worker-awareness', { contextType: 'iframe', url: sanitizeUrl(frame.src || ''), availability: sameOrigin ? 'same-origin-accessible' : 'cross-origin-boundary' }); });
    document.querySelectorAll('*').forEach(element => { if (element.shadowRoot?.mode === 'open') emit('worker-awareness', { contextType: 'shadow-root', host: describeTarget(element) }); });
  }

  function antiBotKeywordsIn(value) {
    const lower = String(value || '').toLowerCase();
    return ANTIBOT_KEYWORDS.filter(keyword => lower.includes(keyword));
  }

  function installAntiBotDomObserver() {
    if (!state.captureSettings?.antibot || typeof MutationObserver !== 'function') return;
    const capturedGeneration = state.generation;
    const aggregate = { records: 0, added: 0, attributes: 0, signals: new Set(), timer: null };
    const nativeSetTimeout = state.originals.setTimeout || window.setTimeout;
    const inspectElement = (node) => {
      if (!(node instanceof Element)) return;
      const fields = [
        node.tagName,
        node.id,
        node.className,
        node.getAttribute?.('name'),
        node.getAttribute?.('role'),
        node.getAttribute?.('src'),
        node.getAttribute?.('href'),
        node.getAttribute?.('action'),
        node.getAttribute?.('aria-label'),
        typeof node.textContent === 'string' ? node.textContent.slice(0, 300) : ''
      ];
      for (const field of fields) for (const keyword of antiBotKeywordsIn(field)) aggregate.signals.add(keyword);
    };
    const flush = () => {
      aggregate.timer = null;
      if (!state.active || capturedGeneration !== state.generation) {
        aggregate.signals.clear(); aggregate.records = 0; aggregate.added = 0; aggregate.attributes = 0;
        return;
      }
      if (aggregate.signals.size) emit('antibot-dom-signal', {
        records: aggregate.records,
        added: aggregate.added,
        attributes: aggregate.attributes,
        signals: [...aggregate.signals].slice(0, 30)
      });
      aggregate.signals.clear(); aggregate.records = 0; aggregate.added = 0; aggregate.attributes = 0;
    };
    const observer = new MutationObserver(records => {
      if (!state.active || capturedGeneration !== state.generation) return;
      aggregate.records += records.length;
      for (const record of records.slice(0, 50)) {
        aggregate.added += record.addedNodes?.length || 0;
        if (record.attributeName) {
          aggregate.attributes += 1;
          const value = record.target instanceof Element ? record.target.getAttribute(record.attributeName) : '';
          for (const keyword of antiBotKeywordsIn(`${record.attributeName || ''} ${value || ''}`)) aggregate.signals.add(keyword);
        }
        for (const node of Array.from(record.addedNodes || []).slice(0, 10)) {
          inspectElement(node);
          if (node instanceof Element) {
            const descendants = node.querySelectorAll?.('[id],[class],[name],[role],[src],[href],[action],[aria-label]') || [];
            for (const child of Array.from(descendants).slice(0, 50)) inspectElement(child);
          }
        }
      }
      if (aggregate.signals.size && !aggregate.timer) aggregate.timer = Reflect.apply(nativeSetTimeout, window, [flush, LIMITS.antiBotDomFlushMs]);
    });
    observer.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'name', 'role', 'src', 'href', 'action', 'aria-label']
    });
    state.observers = state.observers || [];
    state.observers.push(observer);

    try {
      const selectors = [
        '[id*="captcha" i]', '[class*="captcha" i]', '[id*="challenge" i]', '[class*="challenge" i]',
        'iframe[src*="captcha" i]', 'iframe[src*="challenge" i]', 'script[src*="recaptcha" i]',
        'script[src*="turnstile" i]', '[data-sitekey]'
      ];
      for (const selector of selectors) document.querySelectorAll(selector).forEach(node => inspectElement(node));
      if (aggregate.signals.size) emit('antibot-dom-signal', { records: 0, added: 0, attributes: 0, initial: true, signals: [...aggregate.signals].slice(0, 30) });
      aggregate.signals.clear();
    } catch {}
  }

  function installExtendedSensors() {
    const observeTimers = state.captureMode === 'deep' || state.captureSettings?.antibot === true || state.captureSettings?.timers === true;
    const timerTypes = observeTimers ? ['setTimeout', 'setInterval'] : [];
    for (const type of timerTypes) {
      const original = window[type];
      if (typeof original !== 'function') continue;
      state.originals[type] = original;
      const wrapper = function(callback, delay, ...args) {
        if (!state.active) return Reflect.apply(original, this, arguments);
        let callbackText = '';
        try { callbackText = typeof callback === 'function' ? Function.prototype.toString.call(callback).slice(0, 1200) : String(callback || '').slice(0, 1200); } catch {}
        const callbackKeywords = antiBotKeywordsIn(callbackText);
        const general = state.captureMode === 'deep' || state.captureSettings?.timers === true;
        const antiBotSample = state.captureSettings?.antibot === true && (callbackKeywords.length > 0 || Math.random() < LIMITS.antiBotTimerSampleRate);
        const shouldRecord = general || antiBotSample;
        const timerId = `timer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const capturedGeneration = state.generation;
        if (shouldRecord) emit('timer-schedule', {
          timerId,
          timerType: type,
          delay: Number(delay) || 0,
          sampled: !general,
          callbackKeywords
        });
        if (typeof callback !== 'function' || !shouldRecord) {
          return Reflect.apply(original, this, arguments);
        }
        const wrappedCallback = function(...callbackArgs) {
          if (state.active && capturedGeneration === state.generation) emit('timer-fire', {
            timerId,
            timerType: type,
            delay: Number(delay) || 0,
            sampled: !general,
            callbackKeywords
          });
          return Reflect.apply(callback, this, callbackArgs);
        };
        return Reflect.apply(original, this, [wrappedCallback, delay, ...args]);
      };
      state.wrappers[type] = wrapper;
      window[type] = wrapper;
    }

    const originalBeacon = navigator.sendBeacon;
    if (typeof originalBeacon === 'function') {
      state.originals.sendBeacon = originalBeacon;
      navigator.sendBeacon = function(url, data) {
        if (state.active) emit('network-request', {
          requestId: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          transport: 'beacon', method: 'POST', url: sanitizeUrl(String(url)),
          body: data instanceof Blob ? `[Blob ${data.size}]` : typeof data === 'string' ? sanitizeTextBody(data) : '[binary]'
        });
        return Reflect.apply(originalBeacon, this, arguments);
      };
      state.wrappers.sendBeacon = navigator.sendBeacon;
    }

    for (const [name, kind, enabled] of [
      ['WebSocket', 'websocket', state.captureSettings?.websocket !== false],
      ['EventSource', 'eventsource', state.captureSettings?.sse !== false]
    ]) {
      if (!enabled) continue;
      const Original = window[name];
      if (typeof Original !== 'function') continue;
      state.originals[name] = Original;
      const Wrapped = function(url, ...args) {
        const connectionId = `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const capturedGeneration = state.generation;
        if (!new.target) return Reflect.apply(Original, this, [url, ...args]);
        const target = new.target === Wrapped ? Original : new.target;
        const connection = Reflect.construct(Original, [url, ...args], target);
        if (state.active) emit('network-request', { requestId: connectionId, transport: kind, method: 'CONNECT', url: sanitizeUrl(String(url)) });
        const lifecycle = (stateName, extra = {}) => {
          if (state.active && capturedGeneration === state.generation) emit('connection-lifecycle', {
            requestId: connectionId, transport: kind, state: stateName, url: sanitizeUrl(String(url)), ...extra
          });
        };
        const onOpen = () => lifecycle('open');
        const onError = () => lifecycle('error', { readyState: connection.readyState ?? null });
        const onMessage = event => {
          if (state.active && capturedGeneration === state.generation) emit('network-body', {
            requestId: connectionId, transport: kind, direction: 'received', url: sanitizeUrl(String(url)),
            text: typeof event.data === 'string' ? sanitizeTextBody(event.data) : '[binary]'
          });
        };
        connection.addEventListener?.('open', onOpen);
        connection.addEventListener?.('error', onError);
        connection.addEventListener?.('message', onMessage);
        state.listeners.push(['open', onOpen, false, connection], ['error', onError, false, connection], ['message', onMessage, false, connection]);
        if (kind === 'websocket') {
          const onClose = event => lifecycle('close', {
            code: Number(event?.code) || 0,
            reason: redactSensitiveText(event?.reason || '', 500),
            wasClean: Boolean(event?.wasClean)
          });
          connection.addEventListener?.('close', onClose);
          state.listeners.push(['close', onClose, false, connection]);
          if (typeof connection.send === 'function') {
            const originalSend = connection.send;
            connection.send = function(data) {
              if (state.active && capturedGeneration === state.generation) emit('network-body', {
                requestId: connectionId, transport: kind, direction: 'sent', url: sanitizeUrl(String(url)),
                text: typeof data === 'string' ? sanitizeTextBody(data) : '[binary]'
              });
              return Reflect.apply(originalSend, this, arguments);
            };
          }
        }
        if (typeof connection.close === 'function') {
          try {
            const originalClose = connection.close;
            connection.close = function() {
              lifecycle('close-called');
              return Reflect.apply(originalClose, this, arguments);
            };
          } catch {}
        }
        return connection;
      };
      Wrapped.prototype = Original.prototype;
      try { Object.setPrototypeOf(Wrapped, Original); } catch {}
      window[name] = Wrapped;
      state.wrappers[name] = Wrapped;
    }

    const storage = [localStorage, sessionStorage];
    storage.forEach((store, index) => {
      try { emit('storage-snapshot', { storage: index === 0 ? 'localStorage' : 'sessionStorage', keys: Object.keys(store).slice(0, 100).map(key => ({ key: redactSensitiveText(key, 200), length: String(store.getItem(key) || '').length })) }); } catch {}
    });

    installAntiBotDomObserver();

    if (state.captureMode !== 'light') try {
      const capturedGeneration = state.generation;
      let pending = []; let flushTimer = null;
      const nativeSetTimeout = state.originals.setTimeout || window.setTimeout;
      const mutationObserver = new MutationObserver(records => {
        if (!state.active || capturedGeneration !== state.generation) return;
        pending.push(...records.slice(0, 50));
        if (state.captureMode === 'deep') {
          emit('mutation', { records: pending.splice(0, pending.length).slice(0, 50).map(record => ({
            type: record.type, target: describeTarget(record.target), addedNodes: Math.min(record.addedNodes.length, 20),
            removedNodes: Math.min(record.removedNodes.length, 20), attribute: record.attributeName || null
          })) });
          return;
        }
        if (!flushTimer) flushTimer = Reflect.apply(nativeSetTimeout, window, [() => {
          flushTimer = null;
          const batch = pending.splice(0, pending.length);
          emit('mutation', {
            aggregated: true,
            addedNodesCount: batch.reduce((sum, record) => sum + record.addedNodes.length, 0),
            removedNodesCount: batch.reduce((sum, record) => sum + record.removedNodes.length, 0),
            attributeChanges: batch.filter(record => record.type === 'attributes').map(record => record.attributeName).filter(Boolean).slice(0, 30),
            records: batch.length
          });
        }, 500]);
      });
      mutationObserver.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true });
      state.observers = state.observers || []; state.observers.push(mutationObserver);
    } catch {}

    if (typeof PerformanceObserver === 'function' && state.captureMode !== 'light') {
      try {
        const capturedGeneration = state.generation;
        const buckets = new Map();
        let flushTimer = null;
        const nativeSetTimeout = state.originals.setTimeout || window.setTimeout;
        const flushPerformance = () => {
          flushTimer = null;
          if (!state.active || capturedGeneration !== state.generation) { buckets.clear(); return; }
          for (const bucket of buckets.values()) emit('performance-summary', bucket);
          buckets.clear();
        };
        const observer = new PerformanceObserver(list => {
          if (!state.active || capturedGeneration !== state.generation) return;
          const entries = list.getEntries().slice(0, 200);
          if (state.captureMode === 'deep') {
            entries.slice(0, 100).forEach(entry => emit('performance', {
              name: sanitizeUrl(entry.name), entryType: entry.entryType, duration: entry.duration,
              startTime: entry.startTime, initiatorType: entry.initiatorType || null, transferSize: entry.transferSize || 0
            }));
            return;
          }
          for (const entry of entries) {
            const key = `${entry.entryType}:${entry.initiatorType || ''}`;
            const bucket = buckets.get(key) || {
              entryType: entry.entryType, initiatorType: entry.initiatorType || null, count: 0,
              totalDuration: 0, maxDuration: 0, transferSize: 0, samples: []
            };
            bucket.count += 1;
            bucket.totalDuration += Number(entry.duration) || 0;
            bucket.maxDuration = Math.max(bucket.maxDuration, Number(entry.duration) || 0);
            bucket.transferSize += Number(entry.transferSize) || 0;
            if (bucket.samples.length < 3 && entry.name) bucket.samples.push(sanitizeUrl(entry.name));
            buckets.set(key, bucket);
          }
          if (!flushTimer) flushTimer = Reflect.apply(nativeSetTimeout, window, [flushPerformance, 1000]);
        });
        const supported = Array.isArray(PerformanceObserver.supportedEntryTypes) ? PerformanceObserver.supportedEntryTypes : [];
        const entryTypes = ['resource', 'navigation', 'paint', 'longtask', 'mark', 'measure'].filter(type => !supported.length || supported.includes(type));
        if (entryTypes.length) observer.observe({ entryTypes });
        state.observers = state.observers || [];
        state.observers.push(observer);
      } catch {}
    }
  }

  function restore() {
    try { if (state.originals.fetch && window.fetch === state.wrappers.fetch) window.fetch = state.originals.fetch; else if (state.originals.fetch) emit('diagnostic', { kind: 'restore-skipped-external-modification', target: 'fetch' }); } catch {}
    try {
      const proto = XMLHttpRequest.prototype;
      if (state.originals.xhrOpen && proto.open === state.wrappers.xhrOpen) proto.open = state.originals.xhrOpen; else if (state.originals.xhrOpen) emit('diagnostic', { kind: 'restore-skipped-external-modification', target: 'xhr.open' });
      if (state.originals.xhrSend && proto.send === state.wrappers.xhrSend) proto.send = state.originals.xhrSend; else if (state.originals.xhrSend) emit('diagnostic', { kind: 'restore-skipped-external-modification', target: 'xhr.send' });
      if (state.originals.xhrSetRequestHeader && proto.setRequestHeader === state.wrappers.xhrSetRequestHeader) proto.setRequestHeader = state.originals.xhrSetRequestHeader;
    } catch {}
    try { if (state.originals.pushState && history.pushState === state.wrappers.pushState) history.pushState = state.originals.pushState; else if (state.originals.pushState) emit('diagnostic', { kind: 'restore-skipped-external-modification', target: 'history.pushState' }); } catch {}
    try { if (state.originals.replaceState && history.replaceState === state.wrappers.replaceState) history.replaceState = state.originals.replaceState; } catch {}
    for (const name of ['setTimeout', 'setInterval', 'sendBeacon', 'WebSocket', 'EventSource']) {
      try { if (state.originals[name] && (name === 'sendBeacon' ? navigator : window)[name] === state.wrappers[name]) (name === 'sendBeacon' ? navigator : window)[name] = state.originals[name]; else if (state.originals[name]) emit('diagnostic', { kind: 'restore-skipped-external-modification', target: name }); } catch {}
    }
    for (const [type, handler, capture, target] of state.listeners.splice(0)) {
      try { (target || window).removeEventListener(type, handler, capture); } catch {}
    }
    for (const observer of state.observers || []) { try { observer.disconnect(); } catch {} }
    state.observers = [];
    state.originals = {};
    state.wrappers = {};
    state.generation += 1;
  }

  function start() {
    if (state.active) {
      state.mode = state.mode || 'standard';
      return;
    }
    state.active = true;
    state.startedAt = Date.now();
    state.seq = 0;
    patchFetch();
    patchXhr();
    patchHistory();
    installDomEvents();
    installSourceObserver();
    installExtendedSensors();
    captureHtml();
    captureRuntimeTopLevel();
    captureWorkerAwareness();
    emit('agent-status', { active: true, url: sanitizeUrl(location.href), antibot: Boolean(state.captureSettings?.antibot), mode: state.captureMode });
  }

  function stop() {
    if (!state.active) return;
    emit('agent-status', { active: false, url: sanitizeUrl(location.href) });
    restore();
    state.active = false;
  }

  function refreshSources() {
    if (!state.active) return;
    document.querySelectorAll('script').forEach(s => emitScriptNode(s, 'manual-refresh'));
    captureHtml();
    captureRuntimeTopLevel();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL || msg.direction !== 'EXTENSION_TO_PAGE') return;
    const cmd = msg.payload?.command;
    if (cmd === 'START') { if (Number.isInteger(msg.payload?.generation)) state.generation = msg.payload.generation; state.runId = typeof msg.payload?.runId === 'string' ? msg.payload.runId : null; state.captureMode = ['light', 'standard', 'deep'].includes(msg.payload?.mode) ? msg.payload.mode : 'standard'; state.captureSettings = { ...state.captureSettings, ...(msg.payload?.settings || {}) }; start(); }
    if (cmd === 'STOP' && (!msg.payload?.runId || msg.payload.runId === state.runId)) stop();
    if (cmd === 'REFRESH_SOURCES') refreshSources();
    if (cmd === 'WATCH_ADD' && msg.payload?.path) { state.watches.add(msg.payload.path); updateWatch(msg.payload.path); }
    if (cmd === 'WATCH_SNAPSHOT') state.watches.forEach(updateWatch);
  });

  window[AGENT_KEY] = { start, stop, refreshSources };
})();
