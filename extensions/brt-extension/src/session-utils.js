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

export function ensureDocument(session, {
  documentId,
  url,
  firstSeen = Date.now(),
  transitionType = undefined,
  frameId = undefined,
  parentFrameId = undefined,
  parentDocumentId = undefined,
  frameType = undefined,
  documentLifecycle = undefined,
  performanceTimeOrigin = undefined
} = {}) {
  if (!documentId || documentId === 'unknown') return null;
  session.documents = Array.isArray(session.documents) ? session.documents : [];
  let doc = session.documents.find(item => item.documentId === documentId);
  if (!doc) {
    const canonicalFrameId =
      Number.isInteger(frameId) && frameId >= 0
        ? frameId
        : 0;

    doc = {
      documentId,
      url: url || '',
      firstSeen,
      frameId: canonicalFrameId
    };
    if (transitionType) doc.transitionType = transitionType;

    if (Number.isInteger(parentFrameId)) {
      doc.parentFrameId = parentFrameId;
    }

    if (
      typeof parentDocumentId === 'string' &&
      parentDocumentId
    ) {
      doc.parentDocumentId = parentDocumentId;
    }

    if (typeof frameType === 'string' && frameType) {
      doc.frameType = frameType;
    }

    if (
      typeof documentLifecycle === 'string' &&
      documentLifecycle
    ) {
      doc.documentLifecycle = documentLifecycle;
    }

    if (Number.isFinite(performanceTimeOrigin)) {
      doc.performanceTimeOrigin = performanceTimeOrigin;
    }

    session.documents.push(doc);
    return doc;
  }
  if (url) doc.url = url;
  if (transitionType) doc.transitionType = transitionType;

  if (Number.isInteger(frameId) && frameId >= 0) {
    doc.frameId = frameId;
  }

  if (Number.isInteger(parentFrameId)) {
    doc.parentFrameId = parentFrameId;
  }

  if (
    typeof parentDocumentId === 'string' &&
    parentDocumentId
  ) {
    doc.parentDocumentId = parentDocumentId;
  }

  if (typeof frameType === 'string' && frameType) {
    doc.frameType = frameType;
  }

  if (
    typeof documentLifecycle === 'string' &&
    documentLifecycle
  ) {
    doc.documentLifecycle = documentLifecycle;
  }

  if (Number.isFinite(performanceTimeOrigin)) {
    doc.performanceTimeOrigin = performanceTimeOrigin;
  }

  return doc;
}

export function applyCommittedNavigation(session, details = {}) {
  const firstSeen =
    Number.isFinite(details.firstSeen)
      ? details.firstSeen
      : Date.now();

  const frameId =
    Number.isInteger(details.frameId) &&
    details.frameId >= 0
      ? details.frameId
      : 0;

  const isTopFrame = frameId === 0;

  const documentId =
    typeof details.documentId === 'string' &&
    details.documentId
      ? details.documentId
      : `document_${firstSeen}_${frameId}`;

  const url =
    typeof details.url === 'string'
      ? details.url
      : '';

  const document = ensureDocument(session, {
    documentId,
    url,
    firstSeen,
    transitionType: details.transitionType,
    frameId,
    parentFrameId: details.parentFrameId,
    parentDocumentId: details.parentDocumentId,
    frameType: details.frameType,
    documentLifecycle: details.documentLifecycle
  });

  /*
   * Only the outermost frame owns canonical session navigation state.
   * Child frames have their own document/frame identity but cannot
   * redefine the session's first-party page boundary.
   */
  if (isTopFrame) {
    if (url) {
      session.pageUrl = url;
    }

    session.activeDocumentId = documentId;
  }

  return {
    isTopFrame,
    frameId,
    documentId,
    url,
    document
  };
}

export function recordDocumentSnapshotObservation(
  session,
  event = {},
  observedAt = Date.now()
) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const documents =
    Array.isArray(session.documents)
      ? session.documents
      : [];

  const documentId =
    typeof event.documentId === 'string' &&
    event.documentId &&
    event.documentId !== 'unknown'
      ? event.documentId
      : null;

  const frameId =
    Number.isInteger(event.frameId) &&
    event.frameId >= 0
      ? event.frameId
      : null;

  let document = null;

  if (documentId) {
    document =
      documents.find(
        item => item.documentId === documentId
      ) || null;
  }

  if (!document && frameId !== null) {
    document =
      [...documents]
        .reverse()
        .find(item => item.frameId === frameId) ||
      null;
  }

  if (!document) {
    return null;
  }

  const at =
    Number.isFinite(observedAt)
      ? observedAt
      : Date.now();

  if (event.kind === 'html-snapshot') {
    const html =
      typeof event.data?.text === 'string'
        ? event.data.text
        : '';

    document.htmlSnapshotCount =
      Math.max(
        0,
        Number(document.htmlSnapshotCount) || 0
      ) + 1;

    document.htmlSnapshotObservedAt = at;
    document.htmlChars = html.length;
  }

  if (event.kind === 'runtime-snapshot') {
    const entries =
      Array.isArray(event.data?.entries)
        ? event.data.entries
        : [];

    document.runtimeSnapshotCount =
      Math.max(
        0,
        Number(document.runtimeSnapshotCount) || 0
      ) + 1;

    document.runtimeSnapshotObservedAt = at;
    document.runtimeEntries = entries.length;
  }

  document.lastObservedAt =
    Number.isFinite(document.lastObservedAt)
      ? Math.max(document.lastObservedAt, at)
      : at;

  return document;
}

export function commandTargetOptions(command) {
  if (
    command === 'WATCH_ADD' ||
    command === 'WATCH_SNAPSHOT'
  ) {
    return { frameId: 0 };
  }

  /*
   * No frameId means tab-wide delivery through tabs.sendMessage().
   * Capture lifecycle commands must reach every injected frame.
   */
  return undefined;
}

export function recordSourceObservation(
  source,
  context = {},
  observedAt = Date.now()
) {
  if (!source || typeof source !== 'object') {
    return source;
  }

  source.observations =
    Array.isArray(source.observations)
      ? source.observations
      : [];

  const documentId =
    typeof context.documentId === 'string' &&
    context.documentId
      ? context.documentId
      : 'unknown';

  const frameId =
    Number.isInteger(context.frameId) &&
    context.frameId >= 0
      ? context.frameId
      : 0;

  const documentUrl =
    typeof context.documentUrl === 'string'
      ? context.documentUrl
      : '';

  const at =
    Number.isFinite(observedAt)
      ? observedAt
      : Date.now();

  /*
   * Chrome documentId is the strongest identity when available.
   * For legacy/unknown documents, frame + document URL prevents
   * unrelated frame observations from collapsing together.
   */
  const existing = source.observations.find(item => {
    if (
      documentId !== 'unknown' &&
      item.documentId !== 'unknown'
    ) {
      return (
        item.documentId === documentId &&
        item.frameId === frameId
      );
    }

    return (
      item.frameId === frameId &&
      item.documentUrl === documentUrl
    );
  });

  if (existing) {
    existing.firstObservedAt = Math.min(
      Number(existing.firstObservedAt) || at,
      at
    );

    existing.lastObservedAt = Math.max(
      Number(existing.lastObservedAt) || at,
      at
    );

    existing.count =
      Math.max(0, Number(existing.count) || 0) + 1;
  } else {
    source.observations.push({
      documentId,
      frameId,
      documentUrl,
      firstObservedAt: at,
      lastObservedAt: at,
      count: 1
    });
  }

  source.firstObservedAt =
    Number.isFinite(source.firstObservedAt)
      ? Math.min(source.firstObservedAt, at)
      : at;

  source.lastObservedAt =
    Number.isFinite(source.lastObservedAt)
      ? Math.max(source.lastObservedAt, at)
      : at;

  return source;
}

export function resolveSourceFrameContext(session, context = {}) {
  const documents =
    Array.isArray(session?.documents)
      ? session.documents
      : [];

  const requestedDocumentId =
    typeof context.documentId === 'string' &&
    context.documentId &&
    context.documentId !== 'unknown'
      ? context.documentId
      : null;

  const requestedFrameId =
    Number.isInteger(context.frameId) &&
    context.frameId >= 0
      ? context.frameId
      : null;

  let document = null;

  if (requestedDocumentId) {
    document = documents.find(
      item => item.documentId === requestedDocumentId
    ) || null;
  }

  /*
   * A frame can navigate through multiple documents, so when only
   * frameId is available prefer the most recently recorded document
   * for that frame.
   */
  if (!document && requestedFrameId !== null) {
    document = [...documents]
      .reverse()
      .find(item => item.frameId === requestedFrameId) || null;
  }

  const frameId =
    requestedFrameId ??
    (
      Number.isInteger(document?.frameId)
        ? document.frameId
        : 0
    );

  const documentId =
    requestedDocumentId ||
    document?.documentId ||
    (
      frameId === 0
        ? session?.activeDocumentId || 'unknown'
        : 'unknown'
    );

  const documentUrl =
    typeof document?.url === 'string' && document.url
      ? document.url
      : frameId === 0
        ? session?.pageUrl || ''
        : '';

  return {
    documentId,
    frameId,
    documentUrl,
    isTopFrame: frameId === 0
  };
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
    frameId: Number.isInteger(item.frameId) ? item.frameId : null,
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

export function findLatestCompatibleDomEvent(
  timeline,
  request
) {
  if (!Array.isArray(timeline) || !request) {
    return null;
  }

  const requestDocumentId =
    typeof request.documentId === 'string' &&
    request.documentId &&
    request.documentId !== 'unknown'
      ? request.documentId
      : null;

  const requestFrameId =
    Number.isInteger(request.frameId) &&
    request.frameId >= 0
      ? request.frameId
      : null;

  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];

    if (
      item?.kind !== 'dom-event' ||
      item.data?.isTrusted !== true
    ) {
      continue;
    }

    if (
      request.sessionId &&
      item.sessionId &&
      item.sessionId !== request.sessionId
    ) {
      continue;
    }

    const itemDocumentId =
      typeof item.documentId === 'string' &&
      item.documentId &&
      item.documentId !== 'unknown'
        ? item.documentId
        : null;

    const itemFrameId =
      Number.isInteger(item.frameId) &&
      item.frameId >= 0
        ? item.frameId
        : null;

    if (
      requestDocumentId !== null &&
      itemDocumentId !== null &&
      itemDocumentId !== requestDocumentId
    ) {
      continue;
    }

    if (
      requestFrameId !== null &&
      itemFrameId !== null &&
      itemFrameId !== requestFrameId
    ) {
      continue;
    }

    return item;
  }

  return null;
}

export function buildDomNetworkCorrelation(interaction, request, { maxSequenceGap = 8, maxWallTimeMs = 1500 } = {}) {
  if (!interaction || !request) return null;
  if (interaction.kind !== 'dom-event' || request.kind !== 'network-request') return null;
  if (interaction.sessionId && request.sessionId && interaction.sessionId !== request.sessionId) return null;
  if (interaction.documentId && request.documentId && interaction.documentId !== request.documentId) return null;

  const interactionFrameId =
    Number.isInteger(interaction.frameId)
      ? interaction.frameId
      : null;

  const requestFrameId =
    Number.isInteger(request.frameId)
      ? request.frameId
      : null;

  if (
    interactionFrameId !== null &&
    requestFrameId !== null &&
    interactionFrameId !== requestFrameId
  ) {
    return null;
  }

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
    'same document'
  ];

  if (
    interactionFrameId !== null &&
    requestFrameId !== null
  ) {
    evidence.push('same frame');
  }

  evidence.push(
    `request followed interaction by ${wallTimeDeltaMs}ms`,
    'event reported isTrusted=true'
  );
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
