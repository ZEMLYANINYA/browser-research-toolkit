export const RUN_STATES = Object.freeze(['idle', 'running', 'stopping', 'stopped', 'completed', 'failed']);
export const MODES = Object.freeze(['light', 'standard', 'deep']);

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
]);

const PAGE_EVENT_KIND_SET = new Set(PAGE_EVENT_KINDS);

export function createRunId() {
  return `run_${Date.now().toString(36)}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10)}`;
}

export function validatePageEventPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'Invalid page event payload.' };
  if (!PAGE_EVENT_KIND_SET.has(payload.kind)) return { ok: false, error: 'Unsupported page event kind.' };
  if (!Number.isInteger(payload.sequence) || payload.sequence < 1) return { ok: false, error: 'Invalid page event sequence.' };
  if (!Number.isInteger(payload.generation) || payload.generation < 1) return { ok: false, error: 'Invalid page event generation.' };
  if (typeof payload.runId !== 'string' || payload.runId.length < 5 || payload.runId.length > 120) return { ok: false, error: 'Invalid page event run id.' };
  if (!Number.isFinite(payload.wallTime) || payload.wallTime <= 0) return { ok: false, error: 'Invalid page event time.' };
  if (payload.eventId != null && (typeof payload.eventId !== 'string' || payload.eventId.length > 160)) return { ok: false, error: 'Invalid page event id.' };
  if (payload.documentId != null && (typeof payload.documentId !== 'string' || payload.documentId.length > 2048)) return { ok: false, error: 'Invalid page document id.' };
  if (payload.data != null && (typeof payload.data !== 'object' || Array.isArray(payload.data))) return { ok: false, error: 'Invalid page event data.' };
  return { ok: true };
}

export function validateRuntimeMessage(message) {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return { ok: false, error: 'Invalid message.' };
  if (message.type.startsWith('BRT_') && message.type.length > 80) return { ok: false, error: 'Invalid message type.' };
  if (message.type === 'BRT_PAGE_EVENT') return validatePageEventPayload(message.payload);
  if (message.type === 'BRT_START' && !MODES.includes(message.mode || 'standard')) return { ok: false, error: 'Unsupported capture mode.' };
  if (message.type === 'BRT_WATCH_ADD' && (typeof message.path !== 'string' || !/^window(?:\.[A-Za-z_$][\w$]*)+$/.test(message.path))) return { ok: false, error: 'Invalid watch path.' };
  if (message.type === 'BRT_MARK' && String(message.text || '').length > 200) return { ok: false, error: 'Marker is too long.' };
  return { ok: true };
}

export function redactSecret(value) {
  return value ? '***' : '';
}
