import type { CollectorContext } from '../context.js';
import type { RequestData } from '../types.js';
import { computeFingerprint } from './request-fingerprint.js';

export class ResponseAnalyzer {
  constructor(private readonly ctx: CollectorContext) {}

  async analyzeFetchResponse(response: Response, requestData: RequestData): Promise<void> {
    try {
      const contentType = response.headers.get('content-type') || '';
      requestData.contentType = contentType;
      requestData.status = response.status;

      if (contentType.includes('json')) {
        const text = await response.text();
        const truncatedBody = text.length > this.ctx.config.maxResponseSize;
        const body = truncatedBody ? text.slice(0, this.ctx.config.maxResponseSize) : text;
        this.tryStoreJson(body, requestData, truncatedBody);
      } else if (contentType.includes('text') || contentType.includes('javascript')) {
        const text = await response.text();
        const truncatedBody = text.length > this.ctx.config.maxResponseSize;
        const body = truncatedBody ? text.slice(0, this.ctx.config.maxResponseSize) : text;
        this.storeAsPlainText(body, requestData);
      }
    } catch (error) {
      this.ctx.logger.logError('Response Analysis Failed', error, { requestId: requestData.id });
    } finally {
      // Registering as an endpoint must not depend on whether the body happened to
      // parse, or contain something sensitive — it used to live inside the try block
      // after body analysis, which meant a redacted/errored body silently skipped
      // registration too.
      this.registerIfEndpoint(requestData);
    }
  }

  async analyzeXhrResponse(xhr: XMLHttpRequest, requestData: RequestData): Promise<void> {
    try {
      if (xhr.responseType === '' || xhr.responseType === 'text') {
        const text = xhr.responseText || '';
        // XHR doesn't give us a parsed content-type the way fetch's Headers does here,
        // so we let JSON.parse itself decide: if it parses, treat it as JSON; if not,
        // fall back to the plain-text path. tryStoreJson handles both.
        this.tryStoreJson(text, requestData, false);
      } else if (xhr.responseType === 'json') {
        requestData.responseType = 'json';
        requestData.jsonData = this.ctx.sanitizer.sanitizeObject(xhr.response);
        this.ctx.jsonData.set(requestData.id, {
          request: requestData,
          response: requestData.jsonData,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      this.ctx.logger.logError('XHR Response Analysis Failed', error, { requestId: requestData.id });
    } finally {
      // Bug fix: this used to live at the end of the try block, after an early `return`
      // in the sensitive-body branch — meaning a request whose response merely *looked*
      // sensitive never got registered as an endpoint at all, even though the URL itself
      // was totally fine to record. Registration is now unconditional.
      this.registerIfEndpoint(requestData);
    }
  }

  analyzeWebSocketMessage(data: unknown, wsId: string): void {
    try {
      if (typeof data !== 'string') return;
      const json = JSON.parse(data);
      this.ctx.logger.logDiscovery('📨 WS JSON', `WebSocket: ${wsId}`, {
        type: 'websocket_json',
        data: this.ctx.sanitizer.sanitizeObject(json),
      });
    } catch {
      // not JSON — ignore, this is a best-effort discovery aid, not a protocol parser
    }
  }

  analyzeEventSourceMessage(eventType: string, data: unknown, lastEventId: string, esId: string): void {
    this.ctx.logger.logDiscovery('📨 SSE MESSAGE', `${esId}: ${eventType}`, { eventType, lastEventId });
    try {
      if (typeof data !== 'string') return;
      JSON.parse(data); // just checking it parses; nothing more to do here yet
    } catch {
      // plain-text SSE payload — fine, message is already stored by the caller
    }
  }

  /**
   * Parse-then-redact, not redact-then-maybe-parse. The old order ran a whole-body
   * substring check (containsSensitiveData) *before* attempting JSON.parse — so any
   * response whose raw text happened to contain a word like "phone" or "email"
   * *anywhere* (a completely ordinary field in real API responses, e.g. business
   * contact info) got blacked out in full, losing every other field along with it.
   * Confirmed on a live capture: this is exactly what happened to a Maps place-details
   * response, the single most useful endpoint in that session.
   *
   * Now: try to parse first. On success, `sanitizeObject` already redacts by field
   * name (a key literally called "phone"/"token"/... still gets redacted — just that
   * one field, not the whole response). The coarse whole-text check only runs as a
   * fallback when there's no structure to redact by field at all (JSON.parse failed —
   * e.g. Google's `)]}'` XSSI-prefixed responses).
   */
  private tryStoreJson(body: string, requestData: RequestData, truncated: boolean): void {
    try {
      const json = JSON.parse(body);
      requestData.responseType = 'json';
      const sanitized = this.ctx.sanitizer.sanitizeObject(json) as Record<string, unknown>;
      if (truncated) sanitized.__response_truncated__ = true;
      requestData.jsonData = sanitized;
      this.ctx.syncRedactedCount();

      this.ctx.jsonData.set(requestData.id, {
        request: requestData,
        response: sanitized,
        timestamp: Date.now(),
      });

      this.ctx.logger.logDiscovery('📦 JSON RESPONSE', `From: ${this.ctx.sanitizer.truncate(requestData.url, 60)}`, {
        keys: Object.keys(json).length,
        truncated,
      });
    } catch {
      this.storeAsPlainText(body, requestData);
    }
  }

  /** No structure to redact by field, so the coarse whole-text check is the only tool available here. */
  private storeAsPlainText(body: string, requestData: RequestData): void {
    if (this.ctx.sanitizer.containsSensitiveData(body)) {
      requestData.responseType = 'text';
      requestData.responseText = '[REDACTED - Contains sensitive data]';
      this.ctx.syncRedactedCount();
      return;
    }
    requestData.responseType = 'text';
    requestData.responseText = this.ctx.sanitizer.truncate(body, 500);
  }

  private registerIfEndpoint(requestData: RequestData): void {
    if (!this.ctx.isApiEndpoint(requestData.url)) return;

    if (this.ctx.isExcluded(requestData.url)) {
      this.ctx.recordExcluded(requestData.url);
      return;
    }

    // Dedup: same method+path+param-names (fingerprint) collapses into the existing
    // endpoint entry instead of taking a fresh slot in the (capped) endpoints store —
    // on a real Maps session, 70% of the endpoint budget was one repeated telemetry
    // call; fingerprinting is what actually frees that budget for distinct calls.
    const fingerprint = computeFingerprint(requestData.method, requestData.url);
    const existingRef = this.ctx.endpointFingerprints.get(fingerprint);
    const existing = existingRef ? this.ctx.endpoints.get(existingRef.endpointId) : undefined;

    if (existing) {
      existing.duplicateCount = (existing.duplicateCount ?? 1) + 1;
      this.ctx.endpointFingerprints.set(fingerprint, { endpointId: existing.id, timestamp: Date.now() });
      return;
    }

    requestData.duplicateCount = 1;
    this.ctx.endpoints.set(requestData.id, requestData);
    this.ctx.endpointFingerprints.set(fingerprint, { endpointId: requestData.id, timestamp: Date.now() });
    this.ctx.logger.log('info', `🎯 API Endpoint discovered: ${this.ctx.sanitizer.truncate(requestData.url, 60)}`);
  }
}
