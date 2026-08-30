const encoder = new TextEncoder();

export function estimateBytes(value) {
  if (value == null) return 0;
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return encoder.encode(text ?? '').byteLength;
  } catch {
    return encoder.encode(String(value)).byteLength;
  }
}

function sumBytes(items) {
  return Array.isArray(items) ? items.reduce((sum, item) => sum + estimateBytes(item), 0) : 0;
}

export function rebuildStorageStats(session) {
  const stats = {
    timelineBytes: sumBytes(session.timeline),
    networkBytes: sumBytes(session.network),
    sourceBytes: sumBytes(session.sources),
    htmlBytes: estimateBytes(session.html || ''),
    runtimeBytes: estimateBytes(session.runtime || []),
    antiBotBytes: session.antiBot ? estimateBytes(session.antiBot) : 0,
    approxBytes: 0,
    recalculatedAt: Date.now()
  };
  stats.approxBytes = stats.timelineBytes + stats.networkBytes + stats.sourceBytes + stats.htmlBytes + stats.runtimeBytes + stats.antiBotBytes;
  session.storageStats = stats;
  return stats;
}

export function ensureStorageStats(session) {
  const stats = session.storageStats;
  if (!stats || !Number.isFinite(stats.approxBytes) || !Number.isFinite(stats.timelineBytes) || !Number.isFinite(stats.networkBytes) || !Number.isFinite(stats.sourceBytes)) {
    return rebuildStorageStats(session);
  }
  return stats;
}

function updateApprox(stats) {
  stats.approxBytes = Math.max(0,
    (stats.timelineBytes || 0) +
    (stats.networkBytes || 0) +
    (stats.sourceBytes || 0) +
    (stats.htmlBytes || 0) +
    (stats.runtimeBytes || 0) +
    (stats.antiBotBytes || 0)
  );
}

export function adjustTrackedBucketBytes(session, bucket, delta) {
  const stats = ensureStorageStats(session);
  const bucketKey = `${bucket}Bytes`;
  stats[bucketKey] = Math.max(0, (stats[bucketKey] || 0) + (Number(delta) || 0));
  updateApprox(stats);
  return stats[bucketKey];
}

export function trackedReplace(session, key, value, bucket) {
  const stats = ensureStorageStats(session);
  const bucketKey = `${bucket}Bytes`;
  stats[bucketKey] = estimateBytes(value);
  session[key] = value;
  updateApprox(stats);
}

export function trackedPush(session, key, item, max, bucket) {
  const stats = ensureStorageStats(session);
  const arr = Array.isArray(session[key]) ? session[key] : (session[key] = []);
  const bucketKey = `${bucket}Bytes`;
  const itemBytes = estimateBytes(item);
  arr.push(item);
  stats[bucketKey] = (stats[bucketKey] || 0) + itemBytes;
  const removed = [];
  if (arr.length > max) {
    const count = arr.length - max;
    removed.push(...arr.splice(0, count));
    for (const old of removed) stats[bucketKey] = Math.max(0, (stats[bucketKey] || 0) - estimateBytes(old));
  }
  updateApprox(stats);
  return removed;
}

export function removeTrackedAt(session, key, index, bucket) {
  const arr = Array.isArray(session[key]) ? session[key] : [];
  if (index < 0 || index >= arr.length) return null;
  const [removed] = arr.splice(index, 1);
  const stats = ensureStorageStats(session);
  const bucketKey = `${bucket}Bytes`;
  stats[bucketKey] = Math.max(0, (stats[bucketKey] || 0) - estimateBytes(removed));
  updateApprox(stats);
  return removed;
}

export function timelinePriority(kind) {
  if (/navigation|agent-status|marker|error|session-import/.test(kind || '')) return 4;
  if (/network-request|network-response|dom-event/.test(kind || '')) return 3;
  if (/performance|worker-awareness/.test(kind || '')) return 2;
  return 1;
}

export function pushTimelineTracked(session, item, max) {
  session.retention = session.retention || {};
  session.retention.timelineSeen = (session.retention.timelineSeen || 0) + 1;
  const arr = Array.isArray(session.timeline) ? session.timeline : (session.timeline = []);
  if (arr.length < max) {
    trackedPush(session, 'timeline', item, max, 'timeline');
    return { kept: true, evicted: null };
  }

  const incoming = timelinePriority(item.kind);
  let removeIndex = -1;
  let lowestPriority = Infinity;

  for (let i = 0; i < arr.length; i += 1) {
    const priority = timelinePriority(arr[i].kind);
    if (priority < incoming && priority < lowestPriority) {
      lowestPriority = priority;
      removeIndex = i;
    }
  }

  // If no lower-priority record exists, keep the rolling window fresh by
  // evicting the oldest record with the same priority.
  if (removeIndex < 0) {
    removeIndex = arr.findIndex(current => timelinePriority(current.kind) === incoming);
  }

  if (removeIndex < 0) {
    session.retention.timelineDropped = (session.retention.timelineDropped || 0) + 1;
    return { kept: false, evicted: null };
  }

  const evicted = removeTrackedAt(session, 'timeline', removeIndex, 'timeline');
  trackedPush(session, 'timeline', item, max, 'timeline');
  session.retention.timelineEvicted = (session.retention.timelineEvicted || 0) + 1;
  return { kept: true, evicted };
}

export function resolveCanonicalDocumentId(payload, senderDocumentId) {
  return senderDocumentId || payload?.chromeDocumentId || payload?.documentId || 'unknown';
}

export function ensureDocument(session, { documentId, url, firstSeen = Date.now(), transitionType = undefined, frameId = 0, performanceTimeOrigin = undefined } = {}) {
  if (!documentId || documentId === 'unknown') return null;
  session.documents = Array.isArray(session.documents) ? session.documents : [];
  let doc = session.documents.find(item => item.documentId === documentId);
  if (!doc) {
    doc = { documentId, url: url || '', firstSeen, frameId };
    if (transitionType) doc.transitionType = transitionType;
    if (Number.isFinite(performanceTimeOrigin)) doc.performanceTimeOrigin = performanceTimeOrigin;
    session.documents.push(doc);
    return doc;
  }
  if (url) doc.url = url;
  if (transitionType) doc.transitionType = transitionType;
  if (Number.isFinite(performanceTimeOrigin)) doc.performanceTimeOrigin = performanceTimeOrigin;
  return doc;
}

export function minimalEventEnvelope(item) {
  if (!item) return null;
  const data = item.data || {};
  return {
    eventId: item.eventId,
    sequence: item.sequence,
    kind: item.kind,
    sessionId: item.sessionId,
    documentId: item.documentId,
    wallTime: item.wallTime,
    label: item.label || null,
    provenance: item.provenance || null,
    summary: {
      url: data.url || null,
      method: data.method || null,
      transport: data.transport || null,
      status: data.status ?? null,
      selectorHint: data.target?.selectorHint || data.selectorHint || null,
      eventType: data.eventType || data.type || null
    }
  };
}

const VALID_REQUESTED_MODES = new Set(['light', 'standard', 'deep']);
const VALID_CDP_STATES = new Set(['disabled', 'attaching', 'attached', 'attach-failed', 'unavailable', 'detached']);

export function normalizeRequestedMode(value) {
  return VALID_REQUESTED_MODES.has(value) ? value : 'standard';
}

export function effectiveModeFor(requestedMode, cdpState) {
  const requested = normalizeRequestedMode(requestedMode);
  if (requested === 'deep') return cdpState === 'attached' ? 'deep' : 'standard';
  return requested;
}

export function setCdpState(session, state) {
  const requested = normalizeRequestedMode(session?.requestedMode || session?.mode);
  const normalizedState = VALID_CDP_STATES.has(state) ? state : 'disabled';
  session.requestedMode = requested;
  session.mode = requested;
  session.cdpState = requested === 'deep' ? normalizedState : 'disabled';
  session.effectiveMode = effectiveModeFor(requested, session.cdpState);
  return session.effectiveMode;
}

export function normalizeModeState(session) {
  const requested = normalizeRequestedMode(session?.requestedMode || session?.mode);
  const state = VALID_CDP_STATES.has(session?.cdpState) ? session.cdpState : 'disabled';
  session.requestedMode = requested;
  session.mode = requested;
  return setCdpState(session, state);
}

export function buildDomNetworkCorrelation(interaction, request, { maxSequenceGap = 8, maxWallTimeMs = 1500 } = {}) {
  if (!interaction || !request) return null;
  if (interaction.kind !== 'dom-event' || request.kind !== 'network-request') return null;
  if (interaction.sessionId && request.sessionId && interaction.sessionId !== request.sessionId) return null;
  if (interaction.documentId && request.documentId && interaction.documentId !== request.documentId) return null;
  if (interaction.data?.isTrusted !== true) return null;

  const sequenceGap = Number(request.sequence) - Number(interaction.sequence);
  const wallTimeDeltaMs = Number(request.wallTime) - Number(interaction.wallTime);
  if (!Number.isFinite(sequenceGap) || sequenceGap < 0 || sequenceGap > maxSequenceGap) return null;
  if (!Number.isFinite(wallTimeDeltaMs) || wallTimeDeltaMs < 0 || wallTimeDeltaMs > maxWallTimeMs) return null;

  // MAIN-world observations cross a page-visible channel. isTrusted remains useful
  // evidence, but it is not treated as cryptographic integrity evidence.
  const pageObservable = interaction.provenance?.integrity === 'page-observable';
  const confidence = pageObservable ? 0.30 : 0.40;
  const evidence = [
    'same session',
    'same document',
    `request followed interaction by ${wallTimeDeltaMs}ms`,
    'event reported isTrusted=true'
  ];
  if (pageObservable) evidence.push('interaction arrived through page-observable MAIN-world channel');

  return {
    relationshipId: `rel_${Date.now().toString(36)}_${request.sequence}`,
    fromEventId: interaction.eventId,
    toEventId: request.eventId,
    fromSequence: interaction.sequence,
    toSequence: request.sequence,
    fromEvent: minimalEventEnvelope(interaction),
    toEvent: minimalEventEnvelope(request),
    ruleId: 'dom-to-network-proximity-v2',
    ruleVersion: '2',
    manualStatus: 'unreviewed',
    status: 'candidate',
    confidence,
    evidence,
    metrics: { sequenceGap, wallTimeDeltaMs }
  };
}
