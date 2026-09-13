export const ENTITY_BUCKETS = Object.freeze(['source', 'html', 'runtime']);

function requireSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new TypeError('sessionId is required.');
  }
}

export function sourceEntityKey(sessionId, sourceId) {
  requireSessionId(sessionId);

  if (typeof sourceId !== 'string' || !sourceId) {
    throw new TypeError('sourceId is required.');
  }

  return `${sessionId}:source:${sourceId}`;
}

export function singletonEntityKey(sessionId, bucket) {
  requireSessionId(sessionId);

  if (!['html', 'runtime'].includes(bucket)) {
    throw new TypeError(`Unsupported singleton entity bucket: ${bucket}`);
  }

  return `${sessionId}:${bucket}:current`;
}

export function createPersistedEntity(sessionId, bucket, value) {
  requireSessionId(sessionId);

  if (!ENTITY_BUCKETS.includes(bucket)) {
    throw new TypeError(`Unsupported entity bucket: ${bucket}`);
  }

  if (bucket === 'source') {
    const sourceId = value?.id;

    return {
      entityKey: sourceEntityKey(sessionId, sourceId),
      sessionId,
      bucket,
      value
    };
  }

  return {
    entityKey: singletonEntityKey(sessionId, bucket),
    sessionId,
    bucket,
    value
  };
}

export function decomposeSessionEntities(session) {
  if (!session || typeof session !== 'object') {
    throw new TypeError('session is required.');
  }

  requireSessionId(session.sessionId);

  const header = { ...session };
  const entities = [];

  const sources = Array.isArray(session.sources) ? session.sources : [];
  delete header.sources;

  for (const source of sources) {
    entities.push(createPersistedEntity(session.sessionId, 'source', source));
  }

  if (typeof session.html === 'string') {
    entities.push(createPersistedEntity(session.sessionId, 'html', session.html));
  }
  delete header.html;

  if (Array.isArray(session.runtime)) {
    entities.push(createPersistedEntity(session.sessionId, 'runtime', session.runtime));
  }
  delete header.runtime;

  return { header, entities };
}

export function hydrateSessionEntities(session, entities = []) {
  if (!session || typeof session !== 'object') return null;

  const hydrated = {
    ...session,
    sources: [],
    html: '',
    runtime: []
  };

  const sources = [];

  for (const entity of entities) {
    if (!entity || entity.sessionId !== session.sessionId) continue;

    if (entity.bucket === 'source') {
      sources.push(entity.value);
      continue;
    }

    if (entity.bucket === 'html') {
      hydrated.html = typeof entity.value === 'string' ? entity.value : '';
      continue;
    }

    if (entity.bucket === 'runtime') {
      hydrated.runtime = Array.isArray(entity.value) ? entity.value : [];
    }
  }

  hydrated.sources = sources;
  return hydrated;
}
