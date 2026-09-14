const DEFAULT_TAIL_LIMIT = 50;

function array(value) {
  return Array.isArray(value)
    ? value
    : [];
}

export function createSessionSummary(
  session,
  {
    tailLimit = DEFAULT_TAIL_LIMIT
  } = {}
) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const timeline = array(session.timeline);
  const network = array(session.network);
  const sources = array(session.sources);
  const correlations = array(session.correlations);
  const inferences = array(session.inferences);
  const diagnostics = array(session.diagnostics);
  const runtime = array(session.runtime);
  const errors = array(session.errors);

  const antiBot =
    session.antiBot &&
    typeof session.antiBot === 'object'
      ? session.antiBot
      : {};

  const antiBotSignals =
    array(antiBot.signals);

  const limit =
    Math.max(
      1,
      Number(tailLimit) ||
        DEFAULT_TAIL_LIMIT
    );

  return {
    schemaVersion:
      session.schemaVersion,

    sessionId:
      session.sessionId,

    runId:
      session.runId,

    runState:
      session.runState,

    stopRequested:
      session.stopRequested === true,

    generation:
      session.generation,

    sequence:
      session.sequence,

    tabId:
      session.tabId,

    preserveSession:
      session.preserveSession !== false,

    requestedMode:
      session.requestedMode,

    effectiveMode:
      session.effectiveMode,

    cdpState:
      session.cdpState,

    mode:
      session.mode,

    captureSettings:
      session.captureSettings || {},

    running:
      session.running === true,

    agentActive:
      session.agentActive === true,

    agentStatusAt:
      session.agentStatusAt ?? null,

    startedAt:
      session.startedAt ?? null,

    updatedAt:
      session.updatedAt ?? null,

    pageUrl:
      session.pageUrl || '',

    importedReadOnly:
      session.importedReadOnly === true,

    counters:
      session.counters || {},

    retention:
      session.retention || {},

    storageStats:
      session.storageStats || {},

    errors,

    summaryMode: true,

    summaryCounts: {
      timeline:
        timeline.length,

      network:
        network.length,

      sources:
        sources.length,

      sourcesIndexed:
        sources.filter(
          source => source?.indexed
        ).length,

      sourcesMetadataOnly:
        sources.filter(
          source =>
            source?.fetchPolicy?.decision ===
              'blocked'
        ).length,

      correlations:
        correlations.length,

      inferences:
        inferences.length,

      diagnostics:
        diagnostics.length,

      runtime:
        runtime.length,

      htmlChars:
        typeof session.html === 'string'
          ? session.html.length
          : 0,

      antiBotSignals:
        antiBotSignals.length,

      errors:
        errors.length
    },

    timeline:
      timeline.slice(-limit),

    network:
      network.slice(-limit),

    sources: [],
    correlations: [],
    inferences: [],
    diagnostics: [],
    runtime: [],
    html: '',

    antiBot: {
      enabled:
        antiBot.enabled === true,

      stats:
        antiBot.stats || {},

      lifecycle:
        antiBot.lifecycle || {},

      signals: []
    }
  };
}
