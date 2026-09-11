import { LIMITS } from './shared.js';

export function searchSession(session, query, scopes) {
  const isRegex = Boolean(scopes.regex);
  let matcher;

  try {
    matcher = isRegex
      ? new RegExp(query, scopes.caseSensitive ? '' : 'i')
      : null;
  } catch {
    matcher = null;
  }

  const results = [];

  const add = (scope, label, text, meta = {}) => {
    if (results.length >= LIMITS.maxSearchResults) return;

    const hay = String(text || '');
    const match = matcher
      ? matcher.exec(hay)
      : hay.toLowerCase().indexOf(query.toLowerCase());
    const idx = matcher ? (match ? match.index : -1) : match;

    if (idx < 0) return;

    const start = Math.max(0, idx - 220);
    const end = Math.min(hay.length, idx + query.length + 420);

    results.push({
      scope,
      label,
      snippet: hay.slice(start, end),
      ...meta
    });
  };

  if (scopes.html) {
    add('HTML', session.pageUrl || 'document', session.html);
  }

  if (scopes.javascript) {
    for (const src of session.sources) {
      add(
        'JAVASCRIPT',
        src.label || src.url || src.id,
        src.text,
        { url: src.url, sourceType: src.type }
      );
    }
  }

  if (scopes.network) {
    for (const item of session.network) {
      const d = item.data || {};
      add(
        'NETWORK',
        d.url || item.kind,
        JSON.stringify(d),
        { kind: item.kind, requestId: d.requestId }
      );
    }
  }

  if (scopes.runtime) {
    for (const entry of session.runtime) {
      add(
        'RUNTIME',
        entry.key,
        `${entry.key} = ${entry.value}`,
        { valueType: entry.type }
      );
    }
  }

  if (scopes.timeline !== false) {
    for (const item of session.timeline) {
      add(
        'TIMELINE',
        item.label,
        JSON.stringify(item.data),
        { kind: item.kind, sequence: item.sequence }
      );
    }
  }

  if (scopes.diagnostics) {
    for (const item of session.diagnostics) {
      add('DIAGNOSTICS', item.kind, JSON.stringify(item));
    }

    for (const item of session.correlations) {
      add('CORRELATION', item.ruleId, JSON.stringify(item));
    }

    for (const item of session.antiBot?.signals || []) {
      add(
        'ANTI-BOT',
        (item.categories || []).join(', ') || item.kind,
        JSON.stringify(item)
      );
    }
  }

  return results;
}
