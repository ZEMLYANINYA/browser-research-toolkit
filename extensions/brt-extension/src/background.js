import { LIMITS, trimText, sanitizeUrl, readResponseTextBounded } from './shared.js';
import { redactExtensionSourceText } from './shared.js';
import {
  ensureStorageStats, rebuildStorageStats, trackedPush, trackedReplace, removeTrackedAt, adjustTrackedBucketBytes,
  pushTimelineTracked, ensureDocument, resolveCanonicalDocumentId, minimalEventEnvelope,
  normalizeModeState, setCdpState, buildDomNetworkCorrelation, findLatestCompatibleDomEvent, applyCommittedNavigation,
  resolveSourceFrameContext, recordSourceObservation, commandTargetOptions,
  recordDocumentSnapshotObservation
} from './session-utils.js';
import {
  classifyAntiBotRecord, createAntiBotState, ensureAntiBotState, recordAntiBotAgentStatus,
  recordAntiBotNavigation, recordAntiBotSignal, navigationDeltaMsFor
} from './antibot.js';
import { analyzeAntiBot } from './antibot-analyzer.js';
import { createRunId, validateRuntimeMessage } from './protocol.js';
import { classifySourceFetchPolicy } from './source-policy.js';
import { TaskRunner, TaskError } from './task-runner.js';
import { generateParserBlueprint } from './parser-blueprint.js';
import { renderParserBlueprintMarkdown } from './parser-blueprint-markdown.js';
import { createSessionPersistence } from './session-persistence.js';
import { createIndexedDbPersistence } from './indexeddb-persistence.js';
import { flushSessionToIndexedDb } from './indexeddb-session-flush.js';
import { recoverSessionFromIndexedDb } from './indexeddb-session-recovery.js';
import { createRecordDeltaQueue } from './record-delta-queue.js';
import { createEntityDeltaQueue } from './entity-delta-queue.js';
import { createPersistedRecord } from './session-persistence-model.js';
import { createPersistedEntity, sourceEntityKey } from './session-entity-model.js';
import { observePageProducerSequence } from './capture-continuity.js';
import { createCaptureRouting } from './capture-routing.js';

const sessions = new Map();
const cdpTabs = new Set();
const cdpAttachInFlight = new Map();
const generationCounters = new Map();
const sessionLoads = new Map();
const flushStates = new Map();
const recordDeltas = new Map();
const entityDeltas = new Map();
const indexedDbBootstraps = new Map();
const pendingSourceTasks = new Map();
const pendingSourceObservations = new Map();
const taskAccounting = new Map();
const antiBotAnalysisCache = new Map();
const sessionPersistence = createSessionPersistence(chrome.storage.local);
const indexedDbPersistence = createIndexedDbPersistence(globalThis.indexedDB);
const { injectBridge, injectAgent } = createCaptureRouting(chrome);

const DEFAULT_COUNTERS = Object.freeze({
  requests: 0, responses: 0, bodies: 0, domEvents: 0, navigations: 0, sources: 0,
  tasksCreated: 0, tasksCompleted: 0, tasksRateLimited: 0, tasksQueueFull: 0
});

function ensureSessionCounters(session) {
  session.counters = { ...DEFAULT_COUNTERS, ...(session.counters || {}) };
  for (const key of Object.keys(DEFAULT_COUNTERS)) {
    const value = Number(session.counters[key]);
    session.counters[key] = Number.isFinite(value) && value >= 0 ? value : 0;
  }
  return session.counters;
}

function getAntiBotAnalysis(tabId, session) {
  const sequence = Number(session?.sequence) || 0;
  const cached = antiBotAnalysisCache.get(tabId);
  if (cached && cached.sequence === sequence) return cached.analysis;
  const analysis = analyzeAntiBot(session, { maxSignals: 500 });
  antiBotAnalysisCache.set(tabId, { sequence, analysis });
  return analysis;
}

function accountTaskMetrics(tabId, session, task) {
  const counters = ensureSessionCounters(session);
  let state = taskAccounting.get(tabId);
  if (!state) { state = new Map(); taskAccounting.set(tabId, state); }
  const previous = state.get(task.taskId) || { created: false, completed: false, rateLimited: false, queueFullCount: 0 };
  if (!previous.created) { counters.tasksCreated += 1; previous.created = true; }
  if (!previous.completed && task.status === 'completed') { counters.tasksCompleted += 1; previous.completed = true; }
  if (!previous.rateLimited && task.rateLimited) { counters.tasksRateLimited += 1; previous.rateLimited = true; }
  const queueFullCount = Math.max(0, Number(task.queueFullCount) || 0);
  if (queueFullCount > previous.queueFullCount) counters.tasksQueueFull += queueFullCount - previous.queueFullCount;
  previous.queueFullCount = Math.max(previous.queueFullCount, queueFullCount);
  state.set(task.taskId, previous);
  if (state.size > 1000) state.delete(state.keys().next().value);
}

const taskRunner = new TaskRunner({
  onUpdate: task => {
    const session = task.tabId == null ? null : sessions.get(task.tabId);
    if (!session || (task.runId && session.runId !== task.runId)) return;
    accountTaskMetrics(task.tabId, session, task);
    session.tasks = Array.isArray(session.tasks) ? session.tasks : [];
    const safe = {
      taskId: task.taskId, name: task.name, runId: task.runId, status: task.status,
      attempt: task.attempt, maxAttempts: task.maxAttempts, timeoutMs: task.timeoutMs,
      createdAt: task.createdAt, queuedAt: task.queuedAt || task.createdAt,
      startedAt: task.startedAt || null, waitMs: Number(task.waitMs) || 0,
      rateKey: task.rateKey || null, queueDepth: Number(task.queueDepth) || 0,
      rateLimited: Boolean(task.rateLimited), queueFullCount: Number(task.queueFullCount) || 0,
      updatedAt: task.updatedAt, finishedAt: task.finishedAt || null,
      error: task.error || null,
      result: task.result && typeof task.result === 'object'
        ? { ok: task.result.ok, status: task.result.status, statusText: task.result.statusText }
        : null
    };
    const index = session.tasks.findIndex(item => item.taskId === safe.taskId);
    if (index >= 0) session.tasks[index] = safe; else session.tasks.push(safe);
    if (session.tasks.length > 100) session.tasks.splice(0, session.tasks.length - 100);
    session.updatedAt = Date.now();
    scheduleFlush(task.tabId, 100);
    chrome.runtime.sendMessage({ type: 'BRT_TASK_UPDATED', task: safe, tabId: task.tabId }).catch(() => {});
  }
});

function freshSession(tabId) {
  const session = {
    schemaVersion: 4,
    sessionId: `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    runId: null,
    runState: 'idle',
    stopRequested: false,
    generation: 0,
    sequence: 0,
    continuity: { pageStreams: [] },
    tabId,
    preserveSession: true,
    requestedMode: 'standard',
    effectiveMode: 'standard',
    cdpState: 'disabled',
    mode: 'standard',
    captureSettings: { network: true, dom: true, navigation: true, bodies: true, sources: true, thirdPartySources: false, thirdPartySourceHosts: [], analytics: false, timers: false, mutations: true, performance: true, websocket: true, sse: true, cdp: false, antibot: false },
    analyticsPolicy: 'metadata-only',
    documents: [],
    diagnostics: [],
    correlations: [],
    inferences: [],
    profiles: ['generic', 'graphql', 'spa', 'anti-bot-observability'],
    running: false,
    agentActive: false,
    agentStatusAt: null,
    startedAt: null,
    updatedAt: Date.now(),
    pageUrl: '',
    counters: { ...DEFAULT_COUNTERS },
    timeline: [],
    network: [],
    sources: [],
    html: '',
    runtime: [],
    watches: {},
    markers: [],
    retention: { timelineSeen: 0, timelineEvicted: 0, timelineDropped: 0, networkSeen: 0, networkEvicted: 0, analyticsBodiesSuppressed: 0 },
    storageStats: { timelineBytes: 0, networkBytes: 0, sourceBytes: 0, htmlBytes: 0, runtimeBytes: 0, antiBotBytes: 0, approxBytes: 0, recalculatedAt: Date.now() },
    suppressed: { analyticsBodies: 0 },
    antiBot: createAntiBotState(false),
    errors: [],
    tasks: []
  };
  rebuildStorageStats(session);
  return session;
}

async function loadSession(tabId) {
  if (sessions.has(tabId)) return sessions.get(tabId);
  if (sessionLoads.has(tabId)) return sessionLoads.get(tabId);

  const pending = (async () => {
    let recovery = null;
    let recoveryError = null;

    try {
      recovery = await recoverSessionFromIndexedDb({
        tabId,
        persistence: indexedDbPersistence
      });
    } catch (error) {
      recoveryError = error;
    }

    const indexedDbSession = recovery?.status === 'recovered'
      ? recovery.session
      : null;

    const legacySession = indexedDbSession
      ? null
      : await sessionPersistence.load(tabId);

    const session = indexedDbSession || legacySession || freshSession(tabId);
    session.schemaVersion = Math.max(Number(session.schemaVersion) || 2, 4);
    session.sessionId = session.sessionId || `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    session.preserveSession = session.preserveSession !== false;
    session.mode = session.mode || 'standard';
    session.requestedMode = session.requestedMode || session.mode;
    session.cdpState = session.cdpState || 'disabled';
    normalizeModeState(session);
    // A persisted 'attached' flag cannot prove a live debugger connection after
    // service-worker restart. Re-enter DEEP through the attach path on bridge ready.
    if (session.requestedMode === 'deep' && session.cdpState === 'attached') setCdpState(session, 'detached');
    session.captureSettings = { ...freshSession(tabId).captureSettings, ...(session.captureSettings || {}) };
    // MAIN-world agent state is observational, not authoritative, and persisted
    // values become stale across service-worker restarts. Wait for a fresh status.
    session.agentActive = false;
    session.agentStatusAt = null;
    ensureSessionCounters(session);
    session.antiBot = ensureAntiBotState(session.antiBot, Boolean(session.captureSettings.antibot));
    session.documents = Array.isArray(session.documents) ? session.documents : [];
    session.diagnostics = Array.isArray(session.diagnostics) ? session.diagnostics : [];
    session.correlations = Array.isArray(session.correlations) ? session.correlations : [];
    session.inferences = Array.isArray(session.inferences) ? session.inferences : [];
    session.timeline = Array.isArray(session.timeline) ? session.timeline : [];
    session.network = Array.isArray(session.network) ? session.network : [];
    session.sources = Array.isArray(session.sources) ? session.sources : [];
    session.retention = session.retention || { timelineSeen: 0, timelineEvicted: 0, timelineDropped: 0, networkSeen: 0, networkEvicted: 0, analyticsBodiesSuppressed: 0 };
    session.suppressed = session.suppressed || { analyticsBodies: 0 };
    session.tasks = Array.isArray(session.tasks) ? session.tasks.slice(-100) : [];

    if (indexedDbSession) {
      markIndexedDbBootstrapped(session);
      diagnostic(session, 'indexeddb-session-recovered', {
        sessionId: session.sessionId,
        recordCount: Array.isArray(recovery?.records) ? recovery.records.length : 0,
        entityCount: Array.isArray(recovery?.entities) ? recovery.entities.length : 0
      });
    } else if (recoveryError || (recovery && recovery.status !== 'missing')) {
      const detail = {
        status: recovery?.status || 'read-error',
        issues: Array.isArray(recovery?.issues) ? recovery.issues : []
      };

      if (recoveryError) {
        detail.message = String(recoveryError?.message || recoveryError);
      }

      diagnostic(session, 'indexeddb-recovery-fallback', detail);
    }

    // Never trust persisted incremental counters blindly. Rebuild once from the
    // actual retained collections so stale accounting cannot trigger trim loops.
    rebuildStorageStats(session);
    sessions.set(tabId, session);
    return session;
  })().finally(() => sessionLoads.delete(tabId));

  sessionLoads.set(tabId, pending);
  return pending;
}

function getSessionRecordDelta(session) {
  const tabId = Number(session?.tabId);

  if (!Number.isInteger(tabId)) {
    throw new TypeError('session.tabId is required for record persistence.');
  }

  if (!session?.sessionId) {
    throw new TypeError('session.sessionId is required for record persistence.');
  }

  let state = recordDeltas.get(tabId);

  if (!state || state.sessionId !== session.sessionId) {
    state = {
      sessionId: session.sessionId,
      delta: createRecordDeltaQueue()
    };
    recordDeltas.set(tabId, state);
  }

  return state.delta;
}

function queueRecordPut(session, bucket, value) {
  const record = createPersistedRecord(session.sessionId, bucket, value);
  getSessionRecordDelta(session).put(record);
  return record;
}

function queueRecordDelete(session, bucket, value) {
  if (!value) return;
  const record = createPersistedRecord(session.sessionId, bucket, value);
  getSessionRecordDelta(session).remove(record.recordKey);
}

function resetRecordDelta(tabId) {
  recordDeltas.delete(tabId);
}

function getSessionEntityDelta(session) {
  const tabId = Number(session?.tabId);

  if (!Number.isInteger(tabId)) {
    throw new TypeError('session.tabId is required for entity persistence.');
  }

  if (!session?.sessionId) {
    throw new TypeError('session.sessionId is required for entity persistence.');
  }

  let state = entityDeltas.get(tabId);

  if (!state || state.sessionId !== session.sessionId) {
    state = {
      sessionId: session.sessionId,
      delta: createEntityDeltaQueue()
    };
    entityDeltas.set(tabId, state);
  }

  return state.delta;
}

function queueEntityPut(session, bucket, value) {
  const entity = createPersistedEntity(session.sessionId, bucket, value);
  getSessionEntityDelta(session).put(entity);
  return entity;
}

function queueSourceEntityPut(session, source) {
  if (!source?.id) return null;
  return queueEntityPut(session, 'source', source);
}

function queueSourceEntityDelete(session, source) {
  if (!source?.id) return;
  getSessionEntityDelta(session).remove(sourceEntityKey(session.sessionId, source.id));
}

function pushSourceTracked(session, source) {
  const removed = trackedPush(session, 'sources', source, LIMITS.maxSources, 'source');
  queueSourceEntityPut(session, source);
  for (const evicted of removed) queueSourceEntityDelete(session, evicted);
  return removed;
}

function removeSourceTrackedAt(session, index) {
  const removed = removeTrackedAt(session, 'sources', index, 'source');
  queueSourceEntityDelete(session, removed);
  return removed;
}

function resetEntityDelta(tabId) {
  entityDeltas.delete(tabId);
}

function isIndexedDbBootstrapped(session) {
  return indexedDbBootstraps.get(session.tabId) === session.sessionId;
}

function markIndexedDbBootstrapped(session) {
  indexedDbBootstraps.set(session.tabId, session.sessionId);
}

function resetIndexedDbBootstrap(tabId) {
  indexedDbBootstraps.delete(tabId);
}
function getFlushState(tabId) {
  let state = flushStates.get(tabId);
  if (!state) {
    state = {
      timer: null,
      retryTimer: null,
      retryAttempts: 0,
      retrySessionId: null,
      retryExhaustedNotified: false,
      inFlight: false,
      dirty: false,
      promise: null,
      suspended: false
    };
    flushStates.set(tabId, state);
  }
  return state;
}

const INDEXEDDB_RETRY_DELAYS_MS = Object.freeze([250, 1000, 4000]);

function cancelIndexedDbRetry(state) {
  if (state?.retryTimer == null) return;
  clearTimeout(state.retryTimer);
  state.retryTimer = null;
}

function resetIndexedDbRetry(state) {
  cancelIndexedDbRetry(state);
  state.retryAttempts = 0;
  state.retryExhaustedNotified = false;
}

function bindIndexedDbRetrySession(state, sessionId) {
  if (state.retrySessionId === sessionId) return;

  resetIndexedDbRetry(state);
  state.retrySessionId = sessionId;
}

function scheduleIndexedDbRetry(tabId, session) {
  const state = getFlushState(tabId);

  bindIndexedDbRetrySession(state, session.sessionId);

  if (state.suspended || state.retryTimer != null || state.dirty) return;

  const attempt = state.retryAttempts;
  const delay = INDEXEDDB_RETRY_DELAYS_MS[attempt];

  if (!Number.isFinite(delay)) {
    if (!state.retryExhaustedNotified) {
      state.retryExhaustedNotified = true;
      diagnostic(session, 'indexeddb-retry-exhausted', {
        sessionId: session.sessionId,
        attempts: state.retryAttempts
      });
    }
    return;
  }

  state.retryAttempts += 1;
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;

    if (state.suspended || !sessions.has(tabId)) return;

    void flushSession(tabId);
  }, delay);
}
function applyBackpressure(session) {
  const stats = ensureStorageStats(session);
  if (stats.approxBytes <= LIMITS.maxPersistedBytes) return;

  const before = stats.approxBytes;
  const target = Math.floor(LIMITS.maxPersistedBytes * 0.85);
  let removedTimeline = 0;
  let removedNetwork = 0;
  let removedSources = 0;

  // Prefer dropping low-value timeline telemetry first.
  while (stats.approxBytes > target && session.timeline.length) {
    const index = session.timeline.findIndex(item => /performance|mutation|worker-awareness|storage-snapshot|timer-/.test(item.kind || ''));
    if (index < 0) break;
    const evicted = removeTrackedAt(session, 'timeline', index, 'timeline');
    queueRecordDelete(session, 'timeline', evicted);
    removedTimeline += 1;
  }

  while (stats.approxBytes > target && session.network.length > 100) {
    const evicted = removeTrackedAt(session, 'network', 0, 'network');
    queueRecordDelete(session, 'network', evicted);
    removedNetwork += 1;
    session.retention.networkEvicted = (session.retention.networkEvicted || 0) + 1;
  }

  while (stats.approxBytes > target && session.sources.length > 20) {
    removeSourceTrackedAt(session, 0);
    removedSources += 1;
  }

  if (stats.approxBytes > target && session.html) {
    trackedReplace(session, 'html', trimText(session.html, Math.max(50_000, Math.floor(LIMITS.maxHtmlChars * 0.25))), 'html');
    queueEntityPut(session, 'html', session.html);
  }

  diagnostic(session, 'backpressure-trim', {
    estimatedBytesBefore: before,
    estimatedBytesAfter: ensureStorageStats(session).approxBytes,
    cap: LIMITS.maxPersistedBytes,
    removedTimeline,
    removedNetwork,
    removedSources
  });
}

async function flushSession(tabId) {
  const state = getFlushState(tabId);

  if (state.suspended) return;

  if (state.inFlight) {
    state.dirty = true;
    return state.promise;
  }

  const session = sessions.get(tabId);
  if (!session) return;

  bindIndexedDbRetrySession(state, session.sessionId);

  state.inFlight = true;
  state.dirty = false;

  const pending = (async () => {
    let indexedDbOk = true;

    try {
      applyBackpressure(session);

      const deltaQueue = getSessionRecordDelta(session);
      const entityDeltaQueue = getSessionEntityDelta(session);
      const bootstrap = !isIndexedDbBootstrapped(session);

      if (sessions.get(tabId)?.sessionId !== session.sessionId) {
        return {
          sessionId: session.sessionId,
          indexedDbOk: false,
          stale: true
        };
      }

      try {
        await flushSessionToIndexedDb({
          session,
          deltaQueue,
          entityDeltaQueue,
          persistence: indexedDbPersistence,
          bootstrap
        });

        resetIndexedDbRetry(state);

        if (bootstrap && sessions.get(tabId)?.sessionId === session.sessionId) markIndexedDbBootstrapped(session);
      } catch (error) {
        indexedDbOk = false;

        const message = String(error?.message || error);

        diagnostic(session, 'indexeddb-write-failed', { message });

        /*
         * Incremental continuity is no longer trustworthy after a failed
         * durable write. Discard accumulated mutation deltas and force
         * the next write to bootstrap from the current bounded RAM truth.
         */
        resetRecordDelta(tabId);
        resetEntityDelta(tabId);
        resetIndexedDbBootstrap(tabId);

        diagnostic(session, 'indexeddb-rebase-required', {
          message,
          sessionId: session.sessionId
        });

        scheduleIndexedDbRetry(tabId, session);
      }

      return {
        sessionId: session.sessionId,
        indexedDbOk,
        stale: false
      };
    } finally {
      state.inFlight = false;
      if (state.dirty && sessions.has(tabId)) scheduleFlush(tabId, 50);
    }
  })();

  state.promise = pending;

  try {
    return await pending;
  } finally {
    if (state.promise === pending) {
      state.promise = null;
    }
  }
}

async function settleFlushBeforeLifecycle(tabId, { flushDirty = false } = {}) {
  const state = getFlushState(tabId);

  const cancelTimer = () => {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  };

  cancelTimer();
  cancelIndexedDbRetry(state);

  const pending = state.promise;
  if (pending) {
    await pending;
  }

  // The completed flush may have scheduled a dirty tail or retry.
  cancelTimer();
  cancelIndexedDbRetry(state);

  while (flushDirty && state.dirty && sessions.has(tabId)) {
    state.dirty = false;
    await flushSession(tabId);
    cancelTimer();
    cancelIndexedDbRetry(state);
  }

  state.dirty = false;
}

async function flushSessionNow(tabId) {
  const state = getFlushState(tabId);

  if (state.suspended) return;

  cancelIndexedDbRetry(state);

  let result = null;

  while (true) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (state.inFlight) {
      state.dirty = true;
      result = await state.promise;
    } else {
      result = await flushSession(tabId);
    }

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (!state.dirty) {
      return result;
    }
  }
}

function suspendSessionFlush(tabId) {
  const state = getFlushState(tabId);

  if (state.inFlight) {
    throw new Error('Cannot suspend session flush while persistence is in flight.');
  }

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  cancelIndexedDbRetry(state);
  state.dirty = false;
  state.suspended = true;
}

function resumeSessionFlush(tabId) {
  const state = getFlushState(tabId);
  state.suspended = false;
}

async function settleAndSuspendSessionFlush(tabId) {
  await settleFlushBeforeLifecycle(tabId, { flushDirty: false });
  suspendSessionFlush(tabId);
}

function scheduleFlush(tabId, delay = 350) {
  const state = getFlushState(tabId);
  if (state.suspended) return;
  cancelIndexedDbRetry(state);
  state.dirty = true;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushSession(tabId);
  }, delay);
}

function diagnostic(session, kind, detail = {}) {
  const now = Date.now();
  if (kind === 'backpressure-trim') {
    const previous = [...session.diagnostics].reverse().find(item => item.kind === kind);
    if (previous && now - (previous.lastAt || previous.at || 0) < 10_000) {
      previous.count = (previous.count || 1) + 1;
      previous.lastAt = now;
      previous.estimatedBytesAfter = detail.estimatedBytesAfter;
      previous.maxEstimatedBytes = Math.max(previous.maxEstimatedBytes || 0, detail.estimatedBytesBefore || 0);
      previous.removedTimeline = (previous.removedTimeline || 0) + (detail.removedTimeline || 0);
      previous.removedNetwork = (previous.removedNetwork || 0) + (detail.removedNetwork || 0);
      previous.removedSources = (previous.removedSources || 0) + (detail.removedSources || 0);
      return;
    }
  }
  if (kind === 'source-retention-evicted') {
    const previous = [...session.diagnostics].reverse().find(item => item.kind === kind);
    if (previous && now - (previous.lastAt || previous.at || 0) < 15_000) {
      previous.count = (previous.count || 1) + (detail.count || 1);
      previous.lastAt = now;
      return;
    }
  }
  if (kind === 'source-fetch-success') {
    let host = 'unknown';
    try { host = new URL(detail.url).hostname; } catch {}
    const previous = [...session.diagnostics].reverse().find(item => item.kind === 'source-fetch-summary' && item.host === host && item.status === detail.status);
    if (previous && now - (previous.lastAt || previous.at || 0) < 10_000) {
      previous.count = (previous.count || 1) + 1;
      previous.lastAt = now;
      previous.totalBytes = (previous.totalBytes || 0) + (detail.bytesRead || 0);
      previous.lastUrl = detail.url;
      return;
    }
    pushCapped(session.diagnostics, {
      at: now,
      lastAt: now,
      kind: 'source-fetch-summary',
      host,
      status: detail.status,
      count: 1,
      totalBytes: detail.bytesRead || 0,
      lastUrl: detail.url
    }, LIMITS.maxDiagnostics);
    return;
  }
  pushCapped(session.diagnostics, { at: now, kind, ...detail }, LIMITS.maxDiagnostics);
}

function classifyNetwork(data, pageUrl = '') {
  const url = String(data?.url || '');
  const lower = url.toLowerCase();
  const antiBot = classifyAntiBotRecord({ kind: 'network-request', data }).isAntiBotSignal;
  const analytics = /analytics|telemetry|collect|pixel|beacon|gtag|webvisor|pagead|doubleclick|rmkt|ccm|\/wa\/|\/tracking\//.test(lower);
  const bodyText = typeof data?.body === 'string' ? data.body : '';
  const graphql = /graphql/i.test(url) || /operationName|query\s*[:=]/i.test(bodyText);
  return {
    classification: antiBot ? 'anti-bot-signal' : analytics ? 'analytics' : graphql ? 'graphql' : /\.((js|css|png|jpg|svg|woff2?)(\?|$))/i.test(url) ? 'static-asset' : 'unknown',
    firstParty: (() => { try { return new URL(url).hostname === new URL(pageUrl || url).hostname; } catch { return null; } })()
  };
}

function graphqlFinding(data) {
  const body = data?.body;
  if (!body || typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    const query = parsed.query || '';
    const operation = parsed.operationName || (query.match(/(?:query|mutation|subscription)\s+([A-Za-z0-9_]+)/)?.[1] || null);
    if (!operation && !parsed.extensions?.persistedQuery) return null;
    return { operationName: operation, operationType: query.match(/^(?:\s*)(query|mutation|subscription)/)?.[1] || 'unknown', variableNames: Object.keys(parsed.variables || {}), persistedQueryHash: parsed.extensions?.persistedQuery?.sha256Hash || null };
  } catch { return null; }
}

function endpointFamily(url) {
  try { const parsed = new URL(url); return `${parsed.pathname.replace(/\/(?:\d+|[a-f0-9]{8,})\b/gi, '/{id}')}`; } catch { return url; }
}

function updateInferences(session) {
  const requests = session.network.filter(item => item.kind === 'network-request' && item.data?.classification !== 'analytics' && item.data?.firstParty !== false);
  const families = new Map();
  requests.forEach(item => { const family = item.data?.endpointFamily; if (family) families.set(family, (families.get(family) || 0) + 1); });
  for (const [family, count] of families) if (count >= 3) {
    const existing = session.inferences.find(item => item.hypothesis === 'repeated endpoint family' && item.family === family);
    if (existing) { existing.observations = count; existing.updatedAt = Date.now(); continue; }
    pushCapped(session.inferences, { hypothesis: 'repeated endpoint family', family, observations: count, evidence: ['same normalized path observed at least three times'], counterEvidence: ['request repetition alone does not establish polling or application semantics'], confidence: 0.42, ruleVersion: 'endpoint-repeat-v1', status: 'candidate', createdAt: Date.now() }, 300);
  }
}

function buildApiAnalysis(session) {
  const families = new Map();
  for (const item of session.network.filter(record => record.kind === 'network-request')) {
    const data = item.data || {}; const key = `${data.method || 'GET'} ${data.endpointFamily || data.url || 'unknown'}`;
    const family = families.get(key) || { key, method: data.method || 'GET', family: data.endpointFamily || data.url, count: 0, statuses: [], contentTypes: [], queryKeys: [], graphqlOperations: new Set(), firstParty: data.firstParty, firstSeen: item.wallTime, lastSeen: item.wallTime };
    family.count++; family.lastSeen = item.wallTime; if (data.graphql?.operationName) family.graphqlOperations.add(data.graphql.operationName); families.set(key, family);
  }
  return [...families.values()].map(family => ({ ...family, graphqlOperations: [...family.graphqlOperations] }));
}

function staticFindings(text, source) {
  const findings = [];
  const patterns = [
    ['url-literal', /https?:\/\/[^'"\s]+|\/api\/[A-Za-z0-9_./-]+/g],
    ['graphql-operation', /\b(?:query|mutation|subscription)\s+([A-Za-z0-9_]+)/g],
    ['dynamic-import', /import\(\s*['"]([^'"]+)/g],
    ['pagination-key', /\b(page|offset|limit|cursor|after|before|start|count)\b/gi],
    ['storage-key', /localStorage\.(?:getItem|setItem)\(\s*['"]([^'"]+)/g]
  ];
  for (const [ruleId, pattern] of patterns) for (const match of text.matchAll(pattern)) pushCapped(findings, { ruleId, value: match[1] || match[0], source, confidence: 0.55 }, 100);
  return findings;
}

function pushCapped(arr, item, max) {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function pushTimeline(session, item) {
  const result = pushTimelineTracked(session, item, LIMITS.maxTimelineEvents);

  if (result.kept) {
    queueRecordPut(session, 'timeline', item);
  }

  if (result.evicted) {
    queueRecordDelete(session, 'timeline', result.evicted);
  }

  return result;
}

function sanitizeCdpEvent(method, params = {}) {
  const safe = { method };
  if (method === 'Network.requestWillBeSent') {
    safe.request = {
      requestId: params.requestId,
      loaderId: params.loaderId,
      documentURL: sanitizeNavigationUrl(params.documentURL),
      url: sanitizeNavigationUrl(params.request?.url),
      method: params.request?.method,
      resourceType: params.type,
      timestamp: params.timestamp,
      initiator: {
        type: params.initiator?.type,
        url: sanitizeNavigationUrl(params.initiator?.url),
        lineNumber: params.initiator?.lineNumber
      }
    };
  } else if (method === 'Network.responseReceived') {
    safe.response = {
      requestId: params.requestId,
      url: sanitizeNavigationUrl(params.response?.url),
      status: params.response?.status,
      mimeType: params.response?.mimeType,
      encodedDataLength: params.response?.encodedDataLength,
      resourceType: params.type
    };
  } else if (method === 'Network.loadingFailed') {
    safe.failure = {
      requestId: params.requestId,
      errorText: trimText(params.errorText || '', 500),
      canceled: Boolean(params.canceled),
      blockedReason: params.blockedReason || null,
      resourceType: params.type || null
    };
  } else if (method === 'Debugger.scriptParsed') {
    safe.script = {
      scriptId: params.scriptId,
      url: sanitizeNavigationUrl(params.url),
      sourceMapURL: sanitizeNavigationUrl(params.sourceMapURL),
      startLine: params.startLine,
      startColumn: params.startColumn,
      endLine: params.endLine,
      endColumn: params.endColumn,
      length: params.length,
      hash: trimText(params.hash || '', 160),
      isModule: Boolean(params.isModule)
    };
  } else if (method === 'Runtime.exceptionThrown') {
    const detail = params.exceptionDetails || {};
    safe.exception = {
      exceptionId: detail.exceptionId,
      text: trimText(detail.text || '', 1000),
      url: sanitizeNavigationUrl(detail.url),
      lineNumber: detail.lineNumber,
      columnNumber: detail.columnNumber,
      timestamp: params.timestamp
    };
  } else if (method === 'Page.frameNavigated') {
    safe.frame = {
      id: params.frame?.id,
      parentId: params.frame?.parentId || null,
      loaderId: params.frame?.loaderId,
      url: sanitizeNavigationUrl(params.frame?.url),
      securityOrigin: sanitizeNavigationUrl(params.frame?.securityOrigin)
    };
  } else if (/WebSocket/.test(method)) {
    safe.websocket = {
      requestId: params.requestId,
      url: sanitizeNavigationUrl(params.url),
      opcode: params.opcode,
      timestamp: params.timestamp,
      payloadLength: params.payloadData?.length || 0
    };
  } else {
    safe.metadata = { requestId: params.requestId, targetId: params.targetId, frameId: params.frameId, type: params.type };
  }
  return safe;
}

function timelineLabel(payload) {
  const d = payload.data || {};
  switch (payload.kind) {
    case 'network-request': return `${d.transport || 'net'} ${d.method || ''} ${d.url || ''}`;
    case 'network-response': return `${d.transport || 'net'} response ${d.status ?? ''} ${d.url || ''}`;
    case 'network-body': return `body ${d.url || ''}`;
    case 'dom-event': return `${d.type || 'event'} ${d.target?.selectorHint || ''}`;
    case 'form-submit': return `${d.method || 'GET'} form ${d.action || ''} · ${d.trigger || 'native'}`;
    case 'navigation': return `${d.type || 'navigation'} ${d.to || ''}`;
    case 'source-url': return `script ${d.url || ''}`;
    case 'source-inline': return d.label || 'inline script';
    case 'antibot-dom-signal': return `anti-bot DOM ${Array.isArray(d.signals) ? d.signals.join(', ') : ''}`;
    case 'connection-lifecycle': return `${d.transport || 'connection'} ${d.state || 'state'} ${d.url || ''}`;
    case 'timer-schedule': return `${d.timerType || 'timer'} ${d.delay ?? ''}ms${d.callbackKeywords?.length ? ` · ${d.callbackKeywords.join(',')}` : ''}`;
    case 'timer-fire': return `${d.timerType || 'timer'} fired${d.callbackKeywords?.length ? ` · ${d.callbackKeywords.join(',')}` : ''}`;
    case 'cdp-event': return `CDP ${d.method || 'event'}${d.request?.url ? ` · ${d.request.url}` : d.response?.url ? ` · ${d.response.url}` : d.script?.url ? ` · ${d.script.url}` : d.frame?.url ? ` · ${d.frame.url}` : ''}`;
    default: return payload.kind;
  }
}


async function sha256Text(text) {
  try {
    const bytes = new TextEncoder().encode(text || '');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function rateKeyForUrl(value, prefix = 'request') {
  try {
    const hostname = new URL(String(value || '')).hostname.toLowerCase();
    return `${prefix}:${hostname || 'unknown'}`.slice(0, 200);
  } catch {
    return `${prefix}:unknown`;
  }
}

function indexExternalSource(tabId, payload) {
  const session = sessions.get(tabId);
  const sourceUrl = payload.data?.rawUrl || payload.data?.url || '';
  const shownUrl = sanitizeUrl(sourceUrl);

  if (!session || !sourceUrl || !shownUrl) return null;

  const sourceFrame =
    resolveSourceFrameContext(session, payload);

  const observedAt = Date.now();

  /*
   * The source body is URL-deduplicated, but observing the same
   * source from another frame is still evidence worth retaining.
   */
  const existingSource =
    session.sources.find(source => source.url === shownUrl);

  if (existingSource) {
    recordSourceObservation(
      existingSource,
      sourceFrame,
      observedAt
    );
    queueSourceEntityPut(session, existingSource);

    /*
     * recordSourceObservation mutates a retained source in place,
     * so refresh byte accounting before persistence.
     */
    rebuildStorageStats(session);
    session.updatedAt = observedAt;
    scheduleFlush(tabId);

    return null;
  }

  const dedupeKey =
    `${tabId}:${session.sessionId}:${shownUrl}`;

  let observations =
    pendingSourceObservations.get(dedupeKey);

  if (!observations) {
    observations = [];
    pendingSourceObservations.set(
      dedupeKey,
      observations
    );
  }

  observations.push({
    ...sourceFrame,
    observedAt
  });

  /*
   * Bound temporary provenance even if a page emits the same
   * source-url event unusually often while the fetch is pending.
   */
  if (observations.length > 500) {
    observations.splice(
      0,
      observations.length - 500
    );
  }

  const pending =
    pendingSourceTasks.get(dedupeKey);

  if (pending) return pending;

  const operation = taskRunner.run({
    name: 'source-index',
    tabId,
    runId: session.runId || null,
    timeoutMs: 12_000,
    rateKey: rateKeyForUrl(sourceUrl, 'source'),
    rateLimit: {
      minIntervalMs: 200,
      maxConcurrent: 2,
      maxQueue: 40
    },
    maxAttempts: 1,
    metadata: { url: shownUrl },
    execute: ({ signal }) =>
      collectExternalSource(tabId, payload, signal)
  });

  pendingSourceTasks.set(
    dedupeKey,
    operation
  );

  operation.finally(() => {
    if (
      pendingSourceTasks.get(dedupeKey) === operation
    ) {
      pendingSourceTasks.delete(dedupeKey);
      pendingSourceObservations.delete(dedupeKey);
    }
  }).catch(() => {});

  operation.catch(() => {});

  return operation;
}

async function collectExternalSource(tabId, payload, taskSignal = null) {
  const session = await loadSession(tabId);
  const sourceFrame =
    resolveSourceFrameContext(session, payload);

  const capturedSessionId = session.sessionId;
  const capturedGeneration = session.generation;
  const rawUrl = payload.data?.rawUrl;
  const shownUrl = sanitizeUrl(payload.data?.url || rawUrl);
  if (!rawUrl) return;

  const dedupeKey =
    `${tabId}:${session.sessionId}:${shownUrl}`;

  const attachPendingSourceObservations = source => {
    const pending =
      pendingSourceObservations.get(dedupeKey);

    const observations =
      Array.isArray(pending) && pending.length
        ? pending
        : [{
            ...sourceFrame,
            observedAt: Date.now()
          }];

    for (const observation of observations) {
      recordSourceObservation(
        source,
        observation,
        observation.observedAt
      );
    }

    return source;
  };

  const existingSource =
    session.sources.find(source => source.url === shownUrl);

  if (existingSource) {
    attachPendingSourceObservations(existingSource);
    queueSourceEntityPut(session, existingSource);
    rebuildStorageStats(session);
    session.updatedAt = Date.now();
    scheduleFlush(tabId);
    return;
  }

  let timeout = null;
  let abortTask = null;
  try {
    if (taskSignal?.aborted) throw new TaskError('TASK_CANCELLED', 'Source indexing cancelled.');
    const controller = new AbortController();
    abortTask = () => controller.abort();
    taskSignal?.addEventListener('abort', abortTask, { once: true });
    timeout = setTimeout(() => controller.abort(), 5000);
    const sourceUrl = new URL(rawUrl);
    if (!['http:', 'https:'].includes(sourceUrl.protocol)) throw new Error('source-fetch-rejected: unsupported scheme');

    const thirdPartyHostAllowed =
      sessionAllowsThirdPartySourceHost(
        session,
        sourceUrl.href
      );

    const sourcePolicy = classifySourceFetchPolicy({
      pageUrl: session.pageUrl,
      sourceUrl: sourceUrl.href,
      allowThirdParty: thirdPartyHostAllowed
    });
    if (!sourcePolicy.allowed) {
      const classification = /analytics|telemetry|pixel|collect|gtag|pagead|doubleclick/i.test(shownUrl)
        ? 'analytics'
        : sourcePolicy.classification;
      const sourceRecord = attachPendingSourceObservations({
        id: `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        type: 'external-script',
        url: shownUrl,
        documentId: sourceFrame.documentId,
        frameId: sourceFrame.frameId,
        documentUrl: sourceFrame.documentUrl,
        label: shownUrl,
        status: null,
        text: '',
        indexed: false,
        firstParty: sourcePolicy.firstParty,
        classification,
        contentHash: null,
        truncated: false,
        bytesRead: 0,
        staticFindings: [],
        fetchPolicy: { decision: 'blocked', reason: sourcePolicy.reason }
      });
      const removed = pushSourceTracked(session, sourceRecord);
      session.counters.sources = session.sources.length;
      if (removed.length) diagnostic(session, 'source-retention-evicted', { count: removed.length });
      diagnostic(session, 'source-fetch-policy-blocked', { url: shownUrl, reason: sourcePolicy.reason, classification });
      session.updatedAt = Date.now();
      scheduleFlush(tabId);
      return;
    }

    if (!sourcePolicy.firstParty) {
      const originPattern =
        sourceOriginPattern(sourceUrl.href);

      const hasHostPermission =
        originPattern
          ? await chrome.permissions.contains({
              origins: [originPattern]
            })
          : false;

      if (!hasHostPermission) {
        const classification =
          /analytics|telemetry|pixel|collect|gtag|pagead|doubleclick/i.test(
            shownUrl
          )
            ? 'analytics'
            : sourcePolicy.classification;

        const sourceRecord =
          attachPendingSourceObservations({
            id: `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            type: 'external-script',
            url: shownUrl,
            documentId: sourceFrame.documentId,
            frameId: sourceFrame.frameId,
            documentUrl: sourceFrame.documentUrl,
            label: shownUrl,
            status: null,
            text: '',
            indexed: false,
            firstParty: false,
            classification,
            contentHash: null,
            truncated: false,
            bytesRead: 0,
            staticFindings: [],
            fetchPolicy: {
              decision: 'blocked',
              reason: 'host-permission-required',
              originPattern
            }
          });

        const removed = pushSourceTracked(session, sourceRecord);

        session.counters.sources =
          session.sources.length;

        if (removed.length) {
          diagnostic(
            session,
            'source-retention-evicted',
            { count: removed.length }
          );
        }

        diagnostic(
          session,
          'source-host-permission-required',
          {
            url: shownUrl,
            originPattern,
            classification
          }
        );

        session.updatedAt = Date.now();
        scheduleFlush(tabId);
        return;
      }
    }

    const res = await fetch(sourceUrl.href, { credentials: 'omit', cache: 'force-cache', signal: controller.signal });
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > LIMITS.maxSourceDownloadBytes) {
      diagnostic(session, 'source-fetch-too-large', { url: shownUrl, contentLength, cap: LIMITS.maxSourceDownloadBytes });
      session.updatedAt = Date.now();
      scheduleFlush(tabId);
      return;
    }

    const bounded = await readResponseTextBounded(res, LIMITS.maxSourceDownloadBytes, 'BRT source size cap reached');
    const current = sessions.get(tabId);
    if (taskSignal?.aborted) throw new TaskError('TASK_CANCELLED', 'Source indexing cancelled.');
    if (!current || current.sessionId !== capturedSessionId || current.generation !== capturedGeneration || !current.running) return;

    if (bounded.unavailable) {
      diagnostic(session, 'source-fetch-unavailable-body', { url: shownUrl, status: res.status });
      session.updatedAt = Date.now();
      scheduleFlush(tabId);
      return;
    }

    const rawText = trimText(bounded.text, LIMITS.maxSourceChars);
    const firstParty = sourcePolicy.firstParty;
    const includeBody = true;
    const contentHash = await sha256Text(rawText);
    const sourceId = `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const sanitizedText = includeBody
      ? redactExtensionSourceText(rawText)
      : '';

    const sourceRecord = attachPendingSourceObservations({
      id: sourceId,
      type: 'external-script',
      url: shownUrl,
      documentId: sourceFrame.documentId,
      frameId: sourceFrame.frameId,
      documentUrl: sourceFrame.documentUrl,
      label: shownUrl,
      status: res.status,
      text: sanitizedText,
      indexed: includeBody,
      firstParty,
      classification: /analytics|telemetry|pixel|collect|gtag|pagead|doubleclick/i.test(shownUrl) ? 'analytics' : firstParty ? 'first-party' : 'third-party',
      contentHash,
      truncated: bounded.truncated || bounded.text.length > LIMITS.maxSourceChars,
      bytesRead: bounded.bytesRead,
      staticFindings: includeBody ? staticFindings(rawText, shownUrl) : []
    });
    const removed = pushSourceTracked(session, sourceRecord);
    session.counters.sources = session.sources.length;
    if (removed.length) diagnostic(session, 'source-retention-evicted', { count: removed.length });
    diagnostic(session, bounded.truncated ? 'source-fetch-truncated' : 'source-fetch-success', { url: shownUrl, status: res.status, bytesRead: bounded.bytesRead });
  } catch (error) {
    const current = sessions.get(tabId);
    if (!current || current.sessionId !== capturedSessionId || current.generation !== capturedGeneration || !current.running) return;
    const message = String(error?.message || error);
    const timeoutKind = error?.name === 'AbortError' ? 'source-fetch-timeout' : 'source-fetch-failed';
    pushCapped(session.errors, { at: Date.now(), kind: timeoutKind, url: shownUrl, message }, 100);
    diagnostic(session, timeoutKind, { url: shownUrl, timeoutMs: error?.name === 'AbortError' ? 5000 : undefined, message });
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (taskSignal && abortTask) taskSignal.removeEventListener('abort', abortTask);
  }
  antiBotAnalysisCache.delete(tabId);
  session.updatedAt = Date.now();
  scheduleFlush(tabId);
}

async function handlePageEvent(tabId, payload, senderContext = {}) {
  const session = await loadSession(tabId);
  const pageObservable = senderContext.provenance?.integrity === 'page-observable';
  if (!session.running) return;
  if (pageObservable) {
    if (payload.generation !== session.generation) return;
    if (payload.runId !== session.runId) return;
  } else if (payload.generation != null && payload.generation !== session.generation) {
    return;
  }

  session.updatedAt = Date.now();
  const canonicalSequence = ++session.sequence;
  antiBotAnalysisCache.delete(tabId);

  const canonicalDocumentId = resolveCanonicalDocumentId(payload, senderContext.documentId);
  const canonicalFrameId = senderContext.frameId ?? payload.frameId ?? 0;
  const producerSequence = pageObservable
    && Number.isInteger(payload.sequence)
    && payload.sequence > 0
    ? payload.sequence
    : null;

  if (producerSequence != null) {
    const continuity = observePageProducerSequence({
      continuity: session.continuity,
      generation: payload.generation,
      runId: payload.runId,
      documentId: canonicalDocumentId,
      frameId: canonicalFrameId,
      producerSequence,
      observedAt: session.updatedAt
    });

    session.continuity = continuity.state;

    if (continuity.gap) {
      diagnostic(session, 'page-producer-sequence-gap', continuity.gap);
    }

    if (continuity.evicted?.length) {
      diagnostic(session, 'page-continuity-cursor-evicted', {
        count: continuity.evicted.length
      });
    }
  }

  const canonical = {
    ...payload,
    eventId: payload.eventId || `evt_${Date.now().toString(36)}_${canonicalSequence}`,
    producerSequence,
    sequence: canonicalSequence,
    sessionId: session.sessionId,
    source: payload.source || 'page-agent',
    provenance: senderContext.provenance || payload.provenance || {
      collector: payload.source || 'page-agent',
      transport: 'unknown',
      integrity: 'unknown'
    },
    documentId: canonicalDocumentId,
    frameId: canonicalFrameId
  };

  const senderObservedUrl = sanitizeUrl(senderContext.url || '');
  const reportedPageUrl = canonical.kind === 'agent-status'
    ? canonical.data?.url
    : canonical.kind === 'navigation'
      ? canonical.data?.to
      : '';
  // Page-originated URL fields are evidence, not authority. For page-observable
  // events, use Chrome's sender URL as the canonical page URL so a forged
  // MAIN-world message cannot redefine first-party source-fetch policy.
  const observedUrl = pageObservable
    ? sanitizeUrl(senderObservedUrl || session.pageUrl || '')
    : sanitizeUrl(senderObservedUrl || reportedPageUrl || session.pageUrl || '');
  if (pageObservable && canonical.frameId === 0 && senderObservedUrl) session.pageUrl = senderObservedUrl;
  if (canonical.kind === 'agent-status' && canonical.frameId === 0) {
    session.agentActive = Boolean(canonical.data?.active);
    session.agentStatusAt = Date.now();
    if (!session.stopRequested && session.agentActive !== session.running) {
      diagnostic(session, 'agent-state-mismatch', { agentActive: session.agentActive, runState: session.runState });
    }
  }
  if (canonical.frameId === 0 && canonicalDocumentId !== 'unknown') session.activeDocumentId = canonicalDocumentId;
  ensureDocument(session, {
    documentId: canonicalDocumentId,
    url: observedUrl || session.pageUrl,
    firstSeen: Date.now(),
    frameId: canonical.frameId,
    performanceTimeOrigin: payload.performanceTimeOrigin
  });

  if (canonical.kind === 'network-request') {
    session.counters.requests += 1;
    const classified = classifyNetwork(canonical.data, session.pageUrl);
    canonical.data = {
      ...canonical.data,
      ...classified,
      endpointFamily: endpointFamily(canonical.data?.url || ''),
      graphql: graphqlFinding(canonical.data)
    };
    if (canonical.data.classification === 'analytics' && session.captureSettings?.analytics === false) {
      canonical.data.body = canonical.data.body ? '[SUPPRESSED: analytics metadata-only]' : null;
      canonical.data.capturePolicy = 'metadata-only';
    }
  }
  if (canonical.kind === 'network-response') {
    session.counters.responses += 1;
    canonical.data = { ...canonical.data, ...classifyNetwork(canonical.data, session.pageUrl) };
  }
  if (canonical.kind === 'network-body') session.counters.bodies += 1;
  if (canonical.kind === 'dom-event') session.counters.domEvents += 1;
  if (canonical.kind === 'navigation') session.counters.navigations += 1;

  if (session.captureSettings?.antibot === true) {
    session.antiBot = ensureAntiBotState(session.antiBot, true);
    if (canonical.kind === 'agent-status' && canonical.frameId === 0) recordAntiBotAgentStatus(session.antiBot, canonical);
    if (
      canonical.kind === 'navigation' &&
      canonical.frameId === 0
    ) {
      recordAntiBotNavigation(
        session.antiBot,
        canonical
      );
    }
    const antiBotClassification = classifyAntiBotRecord(canonical);
    if (antiBotClassification.isAntiBotSignal) {
      canonical.data = {
        ...canonical.data,
        antiBot: {
          categories: antiBotClassification.categories.filter(category => category !== 'analytics'),
          confidence: antiBotClassification.confidence,
          evidence: antiBotClassification.evidence
        }
      };
      const navigationDeltaMs = navigationDeltaMsFor(session.timeline, canonical.wallTime);
      recordAntiBotSignal(session.antiBot, canonical, antiBotClassification, {
        maxSignals: LIMITS.maxAntiBotSignals,
        navigationDeltaMs
      });
    }
  }

  if (
    canonical.kind === 'html-snapshot' ||
    canonical.kind === 'runtime-snapshot'
  ) {
    recordDocumentSnapshotObservation(
      session,
      canonical,
      Number.isFinite(canonical.wallTime)
        ? canonical.wallTime
        : Date.now()
    );
  }

  if (canonical.kind === 'html-snapshot' && canonical.frameId === 0) {
    trackedReplace(session, 'html', trimText(canonical.data?.text || '', LIMITS.maxHtmlChars), 'html');
    queueEntityPut(session, 'html', session.html);
  } else if (canonical.kind === 'runtime-snapshot' && canonical.frameId === 0) {
    trackedReplace(session, 'runtime', (canonical.data?.entries || []).slice(0, LIMITS.maxRuntimeEntries), 'runtime');
    queueEntityPut(session, 'runtime', session.runtime);
  } else if (canonical.kind === 'runtime-watch' && canonical.frameId === 0) {
    const path = canonical.data?.path;
    if (path) {
      const previous = session.watches[path];
      session.watches[path] = {
        previous: previous?.current || null,
        current: canonical.data?.value,
        observedAt: canonical.data?.observedAt || Date.now(),
        changed: JSON.stringify(previous?.current) !== JSON.stringify(canonical.data?.value)
      };
    }
  } else if (canonical.kind === 'source-inline') {
    const sourceFrame =
      resolveSourceFrameContext(session, canonical);

    const text = trimText(
      canonical.data?.text || '',
      LIMITS.maxSourceChars
    );
    const contentHash = await sha256Text(text);
    const sourceRecord = {
      id: `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'inline-script',
      url: sourceFrame.documentUrl || session.pageUrl,
      documentId: sourceFrame.documentId,
      frameId: sourceFrame.frameId,
      documentUrl: sourceFrame.documentUrl,
      label: canonical.data?.label || 'inline script',
      text: redactExtensionSourceText(text),
      contentHash,
      staticFindings: staticFindings(
        text,
        sourceFrame.documentUrl || session.pageUrl
      )
    };

    pushSourceTracked(session, sourceRecord);
    session.counters.sources = session.sources.length;
  } else if (canonical.kind === 'source-url') {
    void indexExternalSource(tabId, canonical);
  } else if (canonical.kind.startsWith('network-')) {
    let suppressBody = false;
    if (canonical.kind === 'network-body' && session.captureSettings?.analytics === false) {
      const request = [...session.network].reverse().find(item => item.kind === 'network-request' && item.data?.requestId === canonical.data?.requestId);
      const bodyClass = canonical.data?.url ? classifyNetwork(canonical.data, session.pageUrl).classification : request?.data?.classification;
      if (bodyClass === 'analytics') {
        suppressBody = true;
        session.suppressed.analyticsBodies = (session.suppressed.analyticsBodies || 0) + 1;
        session.retention.analyticsBodiesSuppressed = (session.retention.analyticsBodiesSuppressed || 0) + 1;
      }
    }
    if (!suppressBody) {
      session.retention.networkSeen = (session.retention.networkSeen || 0) + 1;
      const removed = trackedPush(session, 'network', canonical, LIMITS.maxNetworkRecords, 'network');
      queueRecordPut(session, 'network', canonical);
      for (const evicted of removed) queueRecordDelete(session, 'network', evicted);
      if (removed.length) session.retention.networkEvicted = (session.retention.networkEvicted || 0) + removed.length;
    }
  }

  if (canonical.kind === 'network-request' && canonical.data?.classification !== 'analytics' && (canonical.data?.firstParty !== false || canonical.data?.classification === 'anti-bot-signal')) {
    const interaction =
      findLatestCompatibleDomEvent(
        session.timeline,
        canonical
      );
    const relationship = buildDomNetworkCorrelation(interaction, { ...canonical, label: timelineLabel(canonical) });
    if (relationship && !session.correlations.some(item => item.fromEventId === relationship.fromEventId && item.toEventId === relationship.toEventId)) {
      pushCapped(session.correlations, relationship, 500);
    }
  }

  updateInferences(session);
  let analyticsBodySuppressed = false;
  if (canonical.kind === 'network-body' && session.captureSettings?.analytics === false) {
    const request = [...session.network].reverse().find(item => item.kind === 'network-request' && item.data?.requestId === canonical.data?.requestId);
    analyticsBodySuppressed = request?.data?.classification === 'analytics' || classifyNetwork(canonical.data, session.pageUrl).classification === 'analytics';
  }
  if (!analyticsBodySuppressed && !['html-snapshot', 'runtime-snapshot', 'source-inline', 'source-url'].includes(canonical.kind)) {
    pushTimeline(session, { ...canonical, label: timelineLabel(canonical), data: canonical.data });
  }
  scheduleFlush(tabId);
  chrome.runtime.sendMessage({ type: 'BRT_SESSION_UPDATED', tabId }).catch(() => {});
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function sendCommand(
  tabId,
  command,
  generation = undefined,
  data = undefined,
  frameId = null,
  documentId = null
) {
  const targetOptions =
    typeof documentId === 'string' && documentId
      ? { documentId }
      : Number.isInteger(frameId)
        ? { frameId }
        : commandTargetOptions(command);

  try {
    await chrome.tabs.sendMessage(
      tabId,
      {
        type: 'BRT_EXTENSION_COMMAND',
        payload: {
          command,
          generation,
          runId: sessions.get(tabId)?.runId || null,
          ...data
        }
      },
      targetOptions
    );
  } catch {}
}

function sessionGeneration(tabId) {
  return sessions.get(tabId)?.generation;
}

function sourceOriginPattern(value) {
  try {
    const url = new URL(String(value || ''));

    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

function sessionAllowsThirdPartySourceHost(session, sourceUrl) {
  const pattern = sourceOriginPattern(sourceUrl);

  if (!pattern) return false;

  return Array.isArray(
    session?.captureSettings?.thirdPartySourceHosts
  ) &&
    session.captureSettings.thirdPartySourceHosts.includes(
      pattern
    );
}

function isCurrentLiveCaptureSession(tabId, session) {
  return (
    sessions.get(tabId) === session &&
    session?.running === true &&
    session?.stopRequested !== true &&
    session?.importedReadOnly !== true
  );
}

async function attachDeepMode(tabId, session) {
  if (cdpTabs.has(tabId)) return true;

  const existing = cdpAttachInFlight.get(tabId);

  if (existing) {
    return existing;
  }

  const pending = (async () => {
    setCdpState(session, 'attaching');

    try {
      if (!chrome.debugger?.attach) {
        setCdpState(session, 'unavailable');
        diagnostic(session, 'cdp-unavailable', {
          requestedMode: 'deep'
        });
        return false;
      }

      await chrome.debugger.attach(
        { tabId },
        '1.3'
      );

      for (const method of [
        'Network.enable',
        'Debugger.enable',
        'Runtime.enable',
        'Page.enable'
      ]) {
        await chrome.debugger.sendCommand(
          { tabId },
          method
        );
      }

      cdpTabs.add(tabId);
      setCdpState(session, 'attached');

      diagnostic(session, 'cdp-attached', {
        domains: [
          'Network',
          'Debugger',
          'Runtime',
          'Page'
        ]
      });

      return true;
    } catch (error) {
      setCdpState(session, 'attach-failed');

      diagnostic(session, 'cdp-attach-failed', {
        message: String(error?.message || error)
      });

      return false;
    } finally {
      cdpAttachInFlight.delete(tabId);
    }
  })();

  cdpAttachInFlight.set(
    tabId,
    pending
  );

  return pending;
}
async function detachDeepMode(tabId, session) {
  if (!cdpTabs.has(tabId)) {
    setCdpState(session, session.requestedMode === 'deep' ? 'detached' : 'disabled');
    return;
  }
  try { await chrome.debugger.detach({ tabId }); } catch (error) { diagnostic(session, 'cdp-detach-failed', { message: String(error?.message || error) }); }
  cdpTabs.delete(tabId);
  setCdpState(session, 'detached');
}

chrome.debugger?.onEvent?.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId == null || !cdpTabs.has(tabId)) return;
  void (async () => {
    const session = await loadSession(tabId);
    if (!session.running) return;
    await handlePageEvent(tabId, {
      kind: 'cdp-event',
      source: 'cdp',
      provenance: { collector: 'chrome-debugger-protocol', transport: 'chrome.debugger', integrity: 'extension-controlled' },
      generation: session.generation,
      wallTime: Date.now(),
      monotonicTime: null,
      performanceTimeOrigin: null,
      documentId: session.activeDocumentId || session.documents.at(-1)?.documentId || 'unknown',
      frameId: 0,
      data: sanitizeCdpEvent(method, params)
    });
  })();
});

chrome.debugger?.onDetach?.addListener((source, reason) => {
  const tabId = source.tabId;
  if (tabId == null) return;
  cdpTabs.delete(tabId);
  const session = sessions.get(tabId);
  if (!session) return;
  setCdpState(session, 'detached');
  diagnostic(session, 'cdp-detached', { reason: String(reason || 'unknown') });
  scheduleFlush(tabId);
});

function searchSession(session, query, scopes) {
  const isRegex = Boolean(scopes.regex);
  let matcher;
  try { matcher = isRegex ? new RegExp(query, scopes.caseSensitive ? '' : 'i') : null; } catch { matcher = null; }
  const results = [];
  const add = (scope, label, text, meta = {}) => {
    if (results.length >= LIMITS.maxSearchResults) return;
    const hay = String(text || '');
    const match = matcher ? matcher.exec(hay) : hay.toLowerCase().indexOf(query.toLowerCase());
    const idx = matcher ? (match ? match.index : -1) : match;
    if (idx < 0) return;
    const start = Math.max(0, idx - 220);
    const end = Math.min(hay.length, idx + query.length + 420);
    results.push({ scope, label, snippet: hay.slice(start, end), ...meta });
  };

  if (scopes.html) add('HTML', session.pageUrl || 'document', session.html);
  if (scopes.javascript) {
    for (const src of session.sources) add('JAVASCRIPT', src.label || src.url || src.id, src.text, { url: src.url, sourceType: src.type });
  }
  if (scopes.network) {
    for (const item of session.network) {
      const d = item.data || {};
      add('NETWORK', d.url || item.kind, JSON.stringify(d), { kind: item.kind, requestId: d.requestId });
    }
  }
  if (scopes.runtime) {
    for (const entry of session.runtime) add('RUNTIME', entry.key, `${entry.key} = ${entry.value}`, { valueType: entry.type });
  }
  if (scopes.timeline !== false) {
    for (const item of session.timeline) add('TIMELINE', item.label, JSON.stringify(item.data), { kind: item.kind, sequence: item.sequence });
  }
  if (scopes.diagnostics) {
    for (const item of session.diagnostics) add('DIAGNOSTICS', item.kind, JSON.stringify(item));
    for (const item of session.correlations) add('CORRELATION', item.ruleId, JSON.stringify(item));
    for (const item of session.antiBot?.signals || []) add('ANTI-BOT', (item.categories || []).join(', ') || item.kind, JSON.stringify(item));
  }
  return results;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const validation = validateRuntimeMessage(message);
    if (!validation.ok) { sendResponse({ ok: false, error: validation.error }); return; }
    if (message?.type === 'BRT_PAGE_EVENT') {
      const tabId = sender.tab?.id;
      if (tabId != null) await handlePageEvent(tabId, message.payload, { documentId: sender.documentId, frameId: sender.frameId, url: sender.url, provenance: { collector: 'main-world-page-agent', transport: 'window.postMessage→isolated-content-script', integrity: 'page-observable' } });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'BRT_BRIDGE_READY') {
      const tabId = sender.tab?.id;
      if (tabId != null) {
        const session = await loadSession(tabId);
        const frameId =
          Number.isInteger(sender.frameId)
            ? sender.frameId
            : 0;

        const documentId =
          typeof sender.documentId === 'string'
            ? sender.documentId
            : null;

        if (!isCurrentLiveCaptureSession(tabId, session)) {
          if (sessions.get(tabId) === session) {
            await sendCommand(
              tabId,
              'STOP',
              session.generation,
              undefined,
              frameId,
              documentId
            );
          }

          sendResponse({ ok: true, ignored: true });
          return;
        }

        await injectAgent(
          tabId,
          frameId,
          documentId
        );

        /*
         * STOP or session replacement may happen while executeScript()
         * is in flight. Never START an agent for a session that ceased
         * to be authoritative during that await.
         */
        if (!isCurrentLiveCaptureSession(tabId, session)) {
          if (sessions.get(tabId) === session) {
            await sendCommand(
              tabId,
              'STOP',
              session.generation,
              undefined,
              frameId,
              documentId
            );
          }

          sendResponse({ ok: true, ignored: true });
          return;
        }

        if (
          session.requestedMode === 'deep' &&
          !cdpTabs.has(tabId)
        ) {
          await attachDeepMode(tabId, session);
        }

        if (!isCurrentLiveCaptureSession(tabId, session)) {
          if (sessions.get(tabId) === session) {
            await sendCommand(
              tabId,
              'STOP',
              session.generation,
              undefined,
              frameId,
              documentId
            );
          }

          sendResponse({ ok: true, ignored: true });
          return;
        }

        await sendCommand(
          tabId,
          'START',
          session.generation,
          {
            mode: session.effectiveMode,
            settings: session.captureSettings
          },
          frameId,
          documentId
        );

        if (frameId === 0) {
          for (const path of Object.keys(session.watches || {})) {
            if (!isCurrentLiveCaptureSession(tabId, session)) break;

            await sendCommand(
              tabId,
              'WATCH_ADD',
              session.generation,
              { path },
              frameId
            );
          }
        }
      }

      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'BRT_GET_ACTIVE_TAB') {
      const tab = await activeTab();
      sendResponse({ tab: tab ? { id: tab.id, title: tab.title, url: tab.url } : null });
      return;
    }

    if (message?.type === 'BRT_START') {
      const tab = await activeTab();
      if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('Open a normal http/https page first.');
      const existing = await loadSession(tab.id);
      if (existing.running && !existing.importedReadOnly) {
        diagnostic(existing, 'duplicate-start-ignored', { sessionId: existing.sessionId, generation: existing.generation });
        scheduleFlush(tab.id);
        sendResponse({ ok: true, tabId: tab.id, sessionId: existing.sessionId, duplicate: true });
        return;
      }

      await settleFlushBeforeLifecycle(tab.id, { flushDirty: true });

      const session = freshSession(tab.id);
      resetRecordDelta(tab.id);
      resetEntityDelta(tab.id);
      resetIndexedDbBootstrap(tab.id);
      taskAccounting.delete(tab.id);
      antiBotAnalysisCache.delete(tab.id);
      session.running = true;
      session.runId = createRunId();
      session.runState = 'running';
      session.stopRequested = false;
      session.generation = (generationCounters.get(tab.id) || 0) + 1;
      generationCounters.set(tab.id, session.generation);
      session.startedAt = Date.now();
      session.pageUrl = tab.url || '';
      session.mode = message.mode || 'standard';
      session.requestedMode = session.mode;
      setCdpState(session, 'disabled');
      const antiBotEnabled = message.antibot === true;
      session.captureSettings = session.mode === 'light'
        ? { network: true, dom: true, navigation: true, bodies: false, sources: false, thirdPartySources: false, thirdPartySourceHosts: [], analytics: false, timers: false, mutations: false, performance: false, websocket: true, sse: true, cdp: false, antibot: antiBotEnabled }
        : { network: true, dom: true, navigation: true, bodies: true, sources: true, thirdPartySources: false, thirdPartySourceHosts: [], analytics: false, timers: session.mode === 'deep', mutations: true, performance: true, websocket: true, sse: true, cdp: session.mode === 'deep', antibot: antiBotEnabled };
      session.antiBot = createAntiBotState(antiBotEnabled);
      session.preserveSession = message.preserveSession !== false;
      sessions.set(tab.id, session);

      // Flush the new lifecycle identity before page capture can begin.
      await flushSessionNow(tab.id);

      await injectBridge(tab.id);
      if (session.requestedMode === 'deep') await attachDeepMode(tab.id, session);
      await sendCommand(tab.id, 'START', session.generation, { mode: session.effectiveMode, settings: session.captureSettings });

      // Flush state/events produced while activating the new run.
      await flushSessionNow(tab.id);
      sendResponse({ ok: true, tabId: tab.id });
      return;
    }

    if (message?.type === 'BRT_STOP') {
      const tab = await activeTab();
      if (tab?.id) {
        const session = await loadSession(tab.id);
        const wasRunning = session.running === true;

        /*
         * Make STOP authoritative before sending anything to frames.
         * Async bridge-ready/navigation work must see a stopped session
         * while the STOP message itself is still in flight.
         */
        session.stopRequested = true;
        session.running = false;
        session.runState = wasRunning ? 'stopping' : 'stopped';

        if (session.runId) {
          taskRunner.cancelRun(
            session.runId,
            'Capture run stopped.'
          );
        }

        const generation = sessionGeneration(tab.id);
        await sendCommand(tab.id, 'STOP', generation);

        session.agentActive = false;
        session.agentStatusAt = Date.now();
        session.runState = 'stopped';
        await detachDeepMode(tab.id, session);

        const flushResult = await flushSessionNow(tab.id);

        if (!flushResult?.indexedDbOk || flushResult.stale) {
          throw new Error('STOP state was not durably persisted to IndexedDB.');
        }
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'BRT_CLEAR') {
      const tab = await activeTab();
      if (tab?.id) {
        const session = await loadSession(tab.id);
        const sessionId = session.sessionId;

        await settleAndSuspendSessionFlush(tab.id);

        for (const task of taskRunner.list({ tabId: tab.id })) taskRunner.cancel(task.taskId, 'Session cleared.');
        taskAccounting.delete(tab.id);
        antiBotAnalysisCache.delete(tab.id);
        for (const key of pendingSourceTasks.keys()) if (key.startsWith(`${tab.id}:`)) pendingSourceTasks.delete(key);

        await indexedDbPersistence.deleteSessionData({
          tabId: tab.id,
          sessionId
        });

        await sessionPersistence.remove(tab.id);

        resetRecordDelta(tab.id);
        resetEntityDelta(tab.id);
        resetIndexedDbBootstrap(tab.id);
        sessions.set(tab.id, freshSession(tab.id));
        resumeSessionFlush(tab.id);
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'BRT_SET_SOURCE_HOST_PERMISSION') {
      const tab = await activeTab();

      if (!tab?.id) {
        throw new Error(
          'No active tab for source permission.'
        );
      }

      const session = await loadSession(tab.id);

      if (
        !session.running ||
        session.importedReadOnly
      ) {
        throw new Error(
          'Source permissions require an active live session.'
        );
      }

      const originPattern =
        sourceOriginPattern(message.originPattern);

      /*
       * sourceOriginPattern() accepts a URL. The UI sends a Chrome
       * match pattern ending in /*, so normalize it through a URL
       * representation first.
       */
      let normalizedPattern = null;

      try {
        const candidate =
          String(message.originPattern || '');

        const parsed = new URL(
          candidate.replace(/\/\*$/, '/')
        );

        if (
          ['http:', 'https:'].includes(
            parsed.protocol
          )
        ) {
          normalizedPattern =
            `${parsed.protocol}//${parsed.host}/*`;
        }
      } catch {}

      if (!normalizedPattern) {
        throw new Error(
          'Invalid optional source host pattern.'
        );
      }

      if (message.granted !== true) {
        diagnostic(
          session,
          'optional-host-permission-denied',
          { originPattern: normalizedPattern }
        );

        scheduleFlush(tab.id);

        sendResponse({
          ok: true,
          granted: false
        });
        return;
      }

      const actuallyGranted =
        await chrome.permissions.contains({
          origins: [normalizedPattern]
        });

      if (!actuallyGranted) {
        diagnostic(
          session,
          'optional-host-permission-mismatch',
          { originPattern: normalizedPattern }
        );

        scheduleFlush(tab.id);

        sendResponse({
          ok: false,
          error:
            'Chrome host permission was not granted.'
        });
        return;
      }

      const hosts =
        Array.isArray(
          session.captureSettings
            ?.thirdPartySourceHosts
        )
          ? [
              ...session.captureSettings
                .thirdPartySourceHosts
            ]
          : [];

      if (!hosts.includes(normalizedPattern)) {
        hosts.push(normalizedPattern);
      }

      session.captureSettings.thirdPartySourceHosts =
        hosts;

      session.captureSettings.thirdPartySources =
        hosts.length > 0;

      /*
       * Remove old metadata-only blocked records for this origin.
       * REFRESH_SOURCES will re-observe them and allow normal indexing.
       */
      for (
        let i = session.sources.length - 1;
        i >= 0;
        i -= 1
      ) {
        const source = session.sources[i];

        if (
          source?.fetchPolicy?.decision !==
            'blocked'
        ) continue;

        if (
          sourceOriginPattern(source.url) !==
            normalizedPattern
        ) continue;

        removeSourceTrackedAt(session, i);
      }

      session.counters.sources =
        session.sources.length;

      diagnostic(
        session,
        'optional-host-permission-granted',
        { originPattern: normalizedPattern }
      );

      scheduleFlush(tab.id);

      await sendCommand(
        tab.id,
        'REFRESH_SOURCES',
        sessionGeneration(tab.id)
      );

      sendResponse({
        ok: true,
        granted: true,
        originPattern: normalizedPattern
      });

      return;
    }

    if (message?.type === 'BRT_REFRESH_SOURCES') {
      const tab = await activeTab();
      if (tab?.id) await sendCommand(tab.id, 'REFRESH_SOURCES', sessionGeneration(tab.id));
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'BRT_WATCH_ADD') {
      const tab = await activeTab();
      if (tab?.id && /^window(?:\.[A-Za-z_$][\w$]*)+$/.test(message.path || '')) await sendCommand(tab.id, 'WATCH_ADD', sessionGeneration(tab.id), { path: message.path });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'BRT_MARK') {
      const tab = await activeTab();
      const session = tab?.id ? await loadSession(tab.id) : null;
      if (!session?.running || session.importedReadOnly) throw new Error('Markers require an active live session.');
      const marker = { markerId: `mark_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, text: String(message.text || 'marker').slice(0, 200), category: String(message.category || 'experiment').slice(0, 50), eventId: `evt_${Date.now().toString(36)}_${++session.sequence}`, sequence: session.sequence, sessionId: session.sessionId, documentId: session.documents.at(-1)?.documentId || 'unknown', wallTime: Date.now(), provenance: { collector: 'side-panel', transport: 'chrome.runtime', integrity: 'extension-controlled' } };
      session.markers = Array.isArray(session.markers) ? session.markers : [];
      pushCapped(session.markers, marker, 300);
      pushTimeline(session, { ...marker, kind: 'marker', label: `MARK: ${marker.text}`, data: marker });
      scheduleFlush(tab.id);
      sendResponse({ ok: true, marker });
      return;
    }

    if (message?.type === 'BRT_GET_SESSION') {
      const tab = await activeTab();
      if (!tab?.id) return sendResponse({ session: null });
      sendResponse({ session: await loadSession(tab.id) });
      return;
    }

    if (message?.type === 'BRT_EXPORT_SESSION') {
      const tab = await activeTab();

      if (!tab?.id) {
        sendResponse({ ok: true, session: null });
        return;
      }

      const session = await loadSession(tab.id);
      const expectedSessionId = session.sessionId;
      const flushResult = await flushSessionNow(tab.id);

      if (!flushResult?.indexedDbOk || flushResult.stale || flushResult.sessionId !== expectedSessionId) {
        throw new Error('Session export could not establish a durable IndexedDB snapshot.');
      }

      const recovery = await recoverSessionFromIndexedDb({
        tabId: tab.id,
        persistence: indexedDbPersistence
      });

      if (recovery.status !== 'recovered' || recovery.session?.sessionId !== expectedSessionId) {
        throw new Error('Session export could not recover the durable IndexedDB snapshot.');
      }

      sendResponse({ ok: true, session: recovery.session });
      return;
    }

    if (message?.type === 'BRT_GET_PARSER_BLUEPRINT') {
      const tab = await activeTab();

      if (!tab?.id) {
        sendResponse({ blueprint: null, markdown: '' });
        return;
      }

      const session = await loadSession(tab.id);
      const blueprint = generateParserBlueprint(session);
      const markdown =
        renderParserBlueprintMarkdown(blueprint);

      sendResponse({
        blueprint,
        markdown
      });
      return;
    }

    if (message?.type === 'BRT_GET_TASKS') {
      const tab = await activeTab();
      sendResponse({ tasks: tab?.id == null ? [] : taskRunner.list({ tabId: tab.id }) });
      return;
    }

    if (message?.type === 'BRT_CANCEL_TASK') {
      if (typeof message.taskId !== 'string' || message.taskId.length > 120) throw new TaskError('INVALID_TASK_ID', 'Invalid task id.');
      sendResponse({ ok: taskRunner.cancel(message.taskId, 'Cancelled by user.') });
      return;
    }

    if (message?.type === 'BRT_SEARCH') {
      const tab = await activeTab();
      if (!tab?.id) return sendResponse({ results: [] });
      const session = await loadSession(tab.id);
      sendResponse({ results: searchSession(session, message.query || '', message.scopes || {}) });
      return;
    }

    if (message?.type === 'BRT_GET_DIAGNOSTICS') {
      const tab = await activeTab();
      const session = tab?.id ? await loadSession(tab.id) : null;
      sendResponse({
        diagnostics: session?.diagnostics || [], correlations: session?.correlations || [],
        inferences: session?.inferences || [], api: session ? buildApiAnalysis(session) : [],
        antiBot: session?.antiBot || createAntiBotState(false),
        antiBotAnalysis: session && tab?.id != null ? getAntiBotAnalysis(tab.id, session) : null,
        tasks: tab?.id == null ? [] : taskRunner.list({ tabId: tab.id })
      });
      return;
    }

    if (message?.type === 'BRT_LABEL_CORRELATION') {
      const tab = await activeTab();
      const session = tab?.id ? await loadSession(tab.id) : null;
      const item = session?.correlations?.find(relationship => relationship.relationshipId === message.relationshipId);
      if (!item) throw new Error('Correlation record not found.');
      item.manualStatus = message.status === 'not-related' ? 'not-related' : 'related';
      item.manualLabelAt = Date.now();
      if (session) scheduleFlush(tab.id);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'BRT_IMPORT_SESSION') {
      const tab = await activeTab();
      if (!tab?.id || !message.session || typeof message.session !== 'object') throw new Error('Invalid session import.');
      const imported = message.session;

      await settleFlushBeforeLifecycle(tab.id, { flushDirty: true });

      const session = { ...freshSession(tab.id), ...imported, tabId: tab.id, sessionId: `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, running: false, importedReadOnly: true, importedAt: Date.now() };
      resetRecordDelta(tab.id);
      resetEntityDelta(tab.id);
      resetIndexedDbBootstrap(tab.id);
      taskAccounting.delete(tab.id);
      antiBotAnalysisCache.delete(tab.id);
      ensureSessionCounters(session);
      for (const key of ['timeline', 'network', 'sources', 'runtime', 'errors', 'correlations', 'inferences']) if (!Array.isArray(session[key])) session[key] = [];
      session.captureSettings = { ...freshSession(tab.id).captureSettings, ...(session.captureSettings || {}) };
      session.antiBot = ensureAntiBotState(session.antiBot, Boolean(session.captureSettings.antibot));
      session.tasks = Array.isArray(session.tasks) ? session.tasks.slice(-100) : [];
      rebuildStorageStats(session);
      pushTimeline(session, { kind: 'session-import', eventId: `evt_${Date.now().toString(36)}_${++session.sequence}`, sessionId: session.sessionId, sequence: session.sequence, wallTime: Date.now(), monotonicTime: null, label: 'Imported session', data: { originalSessionId: imported.sessionId || null } });
      sessions.set(tab.id, session);
      await flushSessionNow(tab.id);
      sendResponse({ ok: true, sessionId: session.sessionId });
      return;
    }
  })().catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.webNavigation?.onCommitted?.addListener(async details => {
  const session = await loadSession(details.tabId);
  if (!session.running || !session.preserveSession || session.importedReadOnly) return;

  const safeUrl = sanitizeUrl(details.url);
  const committedAt = Date.now();

  const navigation = applyCommittedNavigation(session, {
    documentId: details.documentId,
    url: safeUrl,
    frameId: details.frameId,
    parentFrameId: details.parentFrameId,
    parentDocumentId: details.parentDocumentId,
    frameType: details.frameType,
    documentLifecycle: details.documentLifecycle,
    transitionType: details.transitionType,
    firstSeen: committedAt
  });

  antiBotAnalysisCache.delete(details.tabId);
  session.counters.navigations += 1;

  const hardNavigation = {
    kind: 'hard-navigation',
    eventId: `evt_${Date.now().toString(36)}_${++session.sequence}`,
    sessionId: session.sessionId,
    sequence: session.sequence,
    wallTime: committedAt,
    monotonicTime: null,

    documentId: navigation.documentId,
    frameId: navigation.frameId,

    label: `${navigation.isTopFrame ? 'document' : 'subframe'} ${safeUrl}`,

    data: {
      documentId: navigation.documentId,
      url: safeUrl,
      transitionType: details.transitionType,
      frameId: navigation.frameId,
      parentFrameId: details.parentFrameId,
      parentDocumentId: details.parentDocumentId,
      frameType: details.frameType,
      documentLifecycle: details.documentLifecycle,
      isTopFrame: navigation.isTopFrame
    },

    provenance: {
      collector: 'chrome.webNavigation',
      transport: 'chrome.webNavigation',
      integrity: 'browser-controlled'
    }
  };

  pushTimeline(session, hardNavigation);

  if (
    navigation.isTopFrame &&
    session.captureSettings?.antibot === true
  ) {
    session.antiBot =
      ensureAntiBotState(session.antiBot, true);

    recordAntiBotNavigation(
      session.antiBot,
      hardNavigation
    );
  }

  scheduleFlush(details.tabId);

  if (/^https?:/i.test(details.url || '')) {
    try {
      await injectBridge(
        details.tabId,
        details.frameId,
        details.documentId || null
      );
    } catch (error) {
      const message = String(error?.message || error);

      const transientFrameRace =
        /frame with (?:id )?\d+ was removed|no frame with id \d+|no document with id|document with (?:id )?.+ was removed/i.test(
          message
        );

      if (!transientFrameRace) {
        diagnostic(session, 'on-demand-bridge-injection-failed', {
          frameId: details.frameId,
          documentId: details.documentId || null,
          message
        });

        /*
         * A top-frame navigation without a bridge means page-level
         * evidence continuity is broken. Never leave the session
         * reporting "running" while the destination document is
         * uninstrumented.
         *
         * Subframe failures remain degraded diagnostics because the
         * authoritative top-frame capture can still be healthy.
         */
        if (navigation.isTopFrame) {
          session.stopRequested = true;
          session.running = false;
          session.runState = 'interrupted';
          session.agentActive = false;
          session.agentStatusAt = Date.now();

          diagnostic(session, 'capture-continuity-lost', {
            reason: 'top-frame-injection-unavailable',
            frameId: details.frameId,
            documentId: details.documentId || null,
            url: safeUrl,
            message
          });

          if (session.runId) {
            taskRunner.cancelRun(
              session.runId,
              'Capture continuity lost after top-frame navigation.'
            );
          }

          await detachDeepMode(
            details.tabId,
            session
          );
        }

        scheduleFlush(details.tabId);
      }
    }
  }
});

function sanitizeNavigationUrl(url) {
  return sanitizeUrl(url);
}

function cleanupRemovedTabState(tabId) {
  const flushState = flushStates.get(tabId);
  if (flushState?.timer) clearTimeout(flushState.timer);
  cancelIndexedDbRetry(flushState);

  flushStates.delete(tabId);
  sessionLoads.delete(tabId);
  cdpTabs.delete(tabId);
  generationCounters.delete(tabId);
  resetRecordDelta(tabId);
  resetEntityDelta(tabId);
  resetIndexedDbBootstrap(tabId);
  sessions.delete(tabId);
}

async function finalizeRemovedTab(tabId) {
  const session = sessions.get(tabId);

  try {
    if (!session) return;

    diagnostic(session, 'tab-close-finalization', {
      sessionId: session.sessionId
    });

    await flushSessionNow(tabId);
  } finally {
    cleanupRemovedTabState(tabId);
  }
}

chrome.tabs?.onRemoved?.addListener((tabId) => {
  for (const task of taskRunner.list({ tabId })) taskRunner.cancel(task.taskId, 'Tab closed.');
  taskAccounting.delete(tabId);
  antiBotAnalysisCache.delete(tabId);
  for (const key of pendingSourceTasks.keys()) if (key.startsWith(`${tabId}:`)) pendingSourceTasks.delete(key);

  void finalizeRemovedTab(tabId);
});
