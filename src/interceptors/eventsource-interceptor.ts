import type { CollectorContext } from '../context.js';
import type { ResponseAnalyzer } from '../analysis/response-analyzer.js';
import type { EventSourceRecord, Interceptor } from '../types.js';

const MAX_MESSAGES_PER_STREAM = 50;

export class EventSourceInterceptor implements Interceptor {
  private original: typeof window.EventSource | null = null;

  constructor(
    private readonly ctx: CollectorContext,
    private readonly analyzer: ResponseAnalyzer,
  ) {}

  install(): void {
    if (!window.EventSource) return;
    this.original = window.EventSource;
    const OriginalEventSource = this.original;
    const ctx = this.ctx;
    const analyzer = this.analyzer;

    window.EventSource = function (url: string | URL, eventSourceInitDict?: EventSourceInit) {
      const es = new OriginalEventSource(url, eventSourceInitDict);
      const id = ctx.generateId();

      const record: EventSourceRecord = {
        id,
        url: ctx.sanitizer.sanitizeUrl(String(url)),
        withCredentials: eventSourceInitDict?.withCredentials ?? false,
        state: 'connecting',
        timestamp: Date.now(),
        messages: [],
      };
      // Bug fix: this used to only log the connection being created — incoming
      // messages were never listened for at all, so an EventSource stream contributed
      // nothing to the collected data beyond "a connection happened."
      ctx.eventSources.set(id, record);
      ctx.logger.logDiscovery('🔌 EVENTSOURCE', `Connecting to ${ctx.sanitizer.truncate(String(url), 80)}`, record);

      es.addEventListener('open', () => {
        record.state = 'open';
      });

      es.addEventListener('error', () => {
        record.state = 'error';
      });

      es.addEventListener('message', (event: MessageEvent) => {
        if (record.messages.length > MAX_MESSAGES_PER_STREAM) record.messages.shift();
        const sanitizedData = ctx.sanitizer.sanitizeWebSocketData(event.data);
        record.messages.push({
          eventType: 'message',
          data: sanitizedData,
          lastEventId: event.lastEventId ?? '',
          timestamp: Date.now(),
        });
        analyzer.analyzeEventSourceMessage('message', event.data, event.lastEventId ?? '', id);
      });

      return es;
    } as unknown as typeof window.EventSource;
  }

  restore(): void {
    if (this.original) window.EventSource = this.original;
  }
}
