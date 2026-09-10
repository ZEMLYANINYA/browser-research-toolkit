export const PAGE_EVENT_KINDS = Object.freeze([
  'agent-status',
  'antibot-dom-signal',
  'connection-lifecycle',
  'diagnostic',
  'dom-event',
  'form-submit',
  'html-snapshot',
  'mutation',
  'navigation',
  'network-body',
  'network-error',
  'network-request',
  'network-response',
  'performance',
  'performance-summary',
  'runtime-snapshot',
  'runtime-watch',
  'source-inline',
  'source-url',
  'storage-snapshot',
  'timer-fire',
  'timer-schedule',
  'worker-awareness'
] as const);

export type PageEventKind =
  (typeof PAGE_EVENT_KINDS)[number];

export interface PageEventEnvelope {
  kind: PageEventKind;
  sequence: number;
  generation: number;
  runId: string;
  wallTime: number;
  eventId?: string;
  documentId?: string;
  data?: Record<string, unknown>;
}

export type PageEventValidationResult =
  | { ok: true }
  | { ok: false; error: string };

const PAGE_EVENT_KIND_SET: ReadonlySet<string> =
  new Set(PAGE_EVENT_KINDS);

export function isPageEventKind(
  value: unknown
): value is PageEventKind {
  return (
    typeof value === 'string' &&
    PAGE_EVENT_KIND_SET.has(value)
  );
}

export function validatePageEventEnvelope(
  payload: unknown
): PageEventValidationResult {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return {
      ok: false,
      error: 'Invalid page event payload.'
    };
  }

  const event =
    payload as Record<string, unknown>;

  if (!isPageEventKind(event.kind)) {
    return {
      ok: false,
      error: 'Unsupported page event kind.'
    };
  }

  if (
    !Number.isInteger(event.sequence) ||
    Number(event.sequence) < 1
  ) {
    return {
      ok: false,
      error: 'Invalid page event sequence.'
    };
  }

  if (
    !Number.isInteger(event.generation) ||
    Number(event.generation) < 1
  ) {
    return {
      ok: false,
      error: 'Invalid page event generation.'
    };
  }

  if (
    typeof event.runId !== 'string' ||
    event.runId.length < 5 ||
    event.runId.length > 120
  ) {
    return {
      ok: false,
      error: 'Invalid page event run id.'
    };
  }

  if (
    typeof event.wallTime !== 'number' ||
    !Number.isFinite(event.wallTime) ||
    event.wallTime <= 0
  ) {
    return {
      ok: false,
      error: 'Invalid page event time.'
    };
  }

  if (
    event.eventId != null &&
    (
      typeof event.eventId !== 'string' ||
      event.eventId.length > 160
    )
  ) {
    return {
      ok: false,
      error: 'Invalid page event id.'
    };
  }

  if (
    event.documentId != null &&
    (
      typeof event.documentId !== 'string' ||
      event.documentId.length > 2048
    )
  ) {
    return {
      ok: false,
      error: 'Invalid page document id.'
    };
  }

  if (
    event.data != null &&
    (
      typeof event.data !== 'object' ||
      Array.isArray(event.data)
    )
  ) {
    return {
      ok: false,
      error: 'Invalid page event data.'
    };
  }

  return { ok: true };
}
