export const RUN_STATES = Object.freeze(['idle', 'running', 'stopping', 'stopped', 'completed', 'failed']);
export const MODES = Object.freeze(['light', 'standard', 'deep']);

export {
  PAGE_EVENT_KINDS
} from './shared.js';

import {
  validatePageEventEnvelope
} from './shared.js';

export function createRunId() {
  return `run_${Date.now().toString(36)}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10)}`;
}

export function validatePageEventPayload(payload) {
  return validatePageEventEnvelope(payload);
}
export function validateRuntimeMessage(message) {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return { ok: false, error: 'Invalid message.' };
  if (message.type.startsWith('BRT_') && message.type.length > 80) return { ok: false, error: 'Invalid message type.' };
  if (message.type === 'BRT_PAGE_EVENT') return validatePageEventPayload(message.payload);
  if (message.type === 'BRT_START' && !MODES.includes(message.mode || 'standard')) return { ok: false, error: 'Unsupported capture mode.' };
  if (message.type === 'BRT_WATCH_ADD' && (typeof message.path !== 'string' || !/^window(?:\.[A-Za-z_$][\w$]*)+$/.test(message.path))) return { ok: false, error: 'Invalid watch path.' };
  if (message.type === 'BRT_MARK' && String(message.text || '').length > 200) return { ok: false, error: 'Marker is too long.' };
  if (message.type === 'BRT_SET_SOURCE_HOST_PERMISSION') {
    if (typeof message.originPattern !== 'string' || message.originPattern.length > 2048) {
      return { ok: false, error: 'Invalid source host permission pattern.' };
    }
    if (typeof message.granted !== 'boolean') {
      return { ok: false, error: 'Invalid source host permission result.' };
    }
  }
  return { ok: true };
}

export function redactSecret(value) {
  return value ? '***' : '';
}
