import type { CollectorContext } from '../context.js';
import type { Monitor } from '../types.js';

const BASE_EVENT_TYPES = [
  'click', 'dblclick', 'mousedown', 'mouseup',
  'keydown', 'keyup', 'keypress',
  'submit', 'change', 'input', 'focus', 'blur',
  'scroll', 'resize', 'load', 'error',
];

const LOGGED_EVENT_TYPES = new Set(['click', 'submit', 'error']);

const SENSITIVE_INPUT_TYPES = new Set(['password', 'email', 'tel']);
const SENSITIVE_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc']);

/**
 * A password/email/phone/OTP field is never safe to record — not the value, and
 * not individual keystrokes either (that's a keylogger, not a research tool).
 * This used to only check whether the *value string itself* matched a sensitive
 * pattern — meaning every keypress into a password field was still recorded
 * verbatim in `details.key`, regardless of what containsSensitiveData said about
 * the accumulated value.
 */
function isSensitiveInputField(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return false;
  }
  const type = 'type' in target ? String(target.type).toLowerCase() : '';
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;

  const autocomplete = (target.getAttribute('autocomplete') ?? '').toLowerCase();
  if (SENSITIVE_AUTOCOMPLETE.has(autocomplete)) return true;

  const name = (target.getAttribute('name') ?? '').toLowerCase();
  if (/token|secret|password|passwd|otp/.test(name)) return true;

  return false;
}

function getElementInfo(target: EventTarget | null): string {
  const el = target as Element | null;
  if (!el || !el.tagName) return 'Unknown';
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const classes = el.className
    ? `.${el.className.toString().split(' ').filter(Boolean).slice(0, 2).join('.')}`
    : '';
  return `${tag}${id}${classes}`;
}

function getEventDetails(event: Event, ctx: CollectorContext): Record<string, unknown> {
  const details: Record<string, unknown> = { type: event.type };
  const sensitiveField = isSensitiveInputField(event.target);

  if (event instanceof MouseEvent && (event.type === 'click' || event.type === 'mousedown')) {
    details.coordinates = { x: event.clientX, y: event.clientY };
    details.button = event.button;
  }

  if (event instanceof KeyboardEvent && event.type.startsWith('key')) {
    if (sensitiveField) {
      details.key = '[REDACTED - sensitive field]';
    } else {
      details.key = event.key;
      details.code = event.code;
      details.ctrlKey = event.ctrlKey;
      details.shiftKey = event.shiftKey;
    }
  }

  const target = event.target as (EventTarget & { value?: unknown }) | null;
  if (target && target.value !== undefined) {
    if (sensitiveField) {
      details.value = '[REDACTED - sensitive field]';
    } else {
      const value = String(target.value);
      details.value = ctx.sanitizer.containsSensitiveData(value) ? '[REDACTED]' : ctx.sanitizer.truncate(value, 100);
    }
  }

  return details;
}

export class EventMonitor implements Monitor {
  private readonly listeners: Array<{ type: string; handler: (e: Event) => void }> = [];

  constructor(private readonly ctx: CollectorContext) {}

  install(): void {
    const types = [...BASE_EVENT_TYPES];
    if (this.ctx.config.enableMouseTracking) types.push('mousemove');

    for (const type of types) {
      const handler = (event: Event) => {
        if (!this.ctx.isActive) return;

        try {
          const record = {
            type: event.type,
            timestamp: Date.now(),
            target: getElementInfo(event.target),
            details: getEventDetails(event, this.ctx),
          };
          this.ctx.recordEvent(type, record);

          if (LOGGED_EVENT_TYPES.has(type)) {
            this.ctx.logger.logDiscovery(`🎯 EVENT:${type.toUpperCase()}`, `Target: ${record.target}`, record);
          }
        } catch (error) {
          // An instrumentation hook must never take the event down with it — this
          // used to have no try/catch at all, so any unexpected failure here (a
          // hostile getter, a browser quirk) silently dropped the event with zero
          // trace anywhere, indistinguishable from "nothing happened."
          this.ctx.logger.logError('Event Capture Failed', error, { type });
        }
      };
      document.addEventListener(type, handler, true);
      this.listeners.push({ type, handler });
    }
  }

  teardown(): void {
    for (const { type, handler } of this.listeners) {
      document.removeEventListener(type, handler, true);
    }
    this.listeners.length = 0;
  }
}
