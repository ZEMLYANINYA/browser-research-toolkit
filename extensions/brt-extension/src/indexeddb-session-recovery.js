import { hydrateSession } from './session-persistence-model.js';
import { hydrateSessionEntities } from './session-entity-model.js';

export async function recoverSessionFromIndexedDb({ tabId, persistence } = {}) {
  if (!Number.isInteger(tabId)) {
    throw new TypeError('tabId must be an integer.');
  }

  if (!persistence || typeof persistence.getActiveSession !== 'function' || typeof persistence.getSession !== 'function' || typeof persistence.getRecordsBySession !== 'function' || typeof persistence.getEntitiesBySession !== 'function') {
    throw new TypeError('IndexedDB persistence reader is required.');
  }

  const pointer = await persistence.getActiveSession(tabId);

  if (!pointer) {
    return {
      status: 'missing',
      session: null,
      pointer: null,
      records: [],
      entities: [],
      issues: []
    };
  }

  if (pointer.tabId !== tabId || typeof pointer.sessionId !== 'string' || !pointer.sessionId) {
    return {
      status: 'invalid-pointer',
      session: null,
      pointer,
      records: [],
      entities: [],
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
      entities: [],
      issues: ['active-session-header-missing']
    };
  }

  if (header.sessionId !== pointer.sessionId || header.tabId !== tabId) {
    return {
      status: 'invalid-header',
      session: null,
      pointer,
      records: [],
      entities: [],
      issues: ['active-session-header-mismatch']
    };
  }

  const [records, entities] = await Promise.all([
    persistence.getRecordsBySession(pointer.sessionId),
    persistence.getEntitiesBySession(pointer.sessionId)
  ]);

  const recordSession = hydrateSession(header, records);
  const session = recordSession
    ? hydrateSessionEntities(recordSession, entities)
    : null;

  if (!session) {
    return {
      status: 'hydrate-failed',
      session: null,
      pointer,
      records,
      entities,
      issues: ['session-hydration-failed']
    };
  }

  return {
    status: 'recovered',
    session,
    pointer,
    records,
    entities,
    issues: []
  };
}
