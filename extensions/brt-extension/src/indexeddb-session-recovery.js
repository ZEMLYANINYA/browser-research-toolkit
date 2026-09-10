import { hydrateSession } from './session-persistence-model.js';

export async function recoverSessionFromIndexedDb({ tabId, persistence } = {}) {
  if (!Number.isInteger(tabId)) {
    throw new TypeError('tabId must be an integer.');
  }

  if (!persistence || typeof persistence.getActiveSession !== 'function' || typeof persistence.getSession !== 'function' || typeof persistence.getRecordsBySession !== 'function') {
    throw new TypeError('IndexedDB persistence reader is required.');
  }

  const pointer = await persistence.getActiveSession(tabId);

  if (!pointer) {
    return {
      status: 'missing',
      session: null,
      pointer: null,
      records: [],
      issues: []
    };
  }

  if (pointer.tabId !== tabId || typeof pointer.sessionId !== 'string' || !pointer.sessionId) {
    return {
      status: 'invalid-pointer',
      session: null,
      pointer,
      records: [],
      issues: ['invalid-active-session-pointer']
    };
  }

  const header = await persistence.getSession(pointer.sessionId);

  if (!header) {
    return {
      status: 'missing-header',
      session: null,
      pointer,
      records: [],
      issues: ['active-session-header-missing']
    };
  }

  if (header.sessionId !== pointer.sessionId || header.tabId !== tabId) {
    return {
      status: 'invalid-header',
      session: null,
      pointer,
      records: [],
      issues: ['active-session-header-mismatch']
    };
  }

  const records = await persistence.getRecordsBySession(pointer.sessionId);
  const session = hydrateSession(header, records);

  if (!session) {
    return {
      status: 'hydrate-failed',
      session: null,
      pointer,
      records,
      issues: ['session-hydration-failed']
    };
  }

  return {
    status: 'recovered',
    session,
    pointer,
    records,
    issues: []
  };
}
