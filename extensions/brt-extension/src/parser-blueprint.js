function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function safeNumber(value) {
  return Number.isFinite(Number(value))
    ? Number(value)
    : 0;
}

function evidenceRef(item, reason) {
  return {
    eventId: safeString(item?.eventId) || null,
    sequence:
      Number.isFinite(Number(item?.sequence))
        ? Number(item.sequence)
        : null,
    kind: safeString(item?.kind) || 'unknown',
    documentId: safeString(item?.documentId) || null,
    frameId:
      Number.isInteger(item?.frameId)
        ? item.frameId
        : null,
    reason
  };
}

function inferTransport(session) {
  const network =
    Array.isArray(session?.network)
      ? session.network
      : [];

  const timeline =
    Array.isArray(session?.timeline)
      ? session.timeline
      : [];

  const counts = {
    fetch: 0,
    xhr: 0,
    classicForm: 0,
    hardNavigation: 0
  };

  const evidence = [];

  for (const item of network) {
    if (item?.kind !== 'network-request') {
      continue;
    }

    const transport =
      safeString(item?.data?.transport).toLowerCase();

    if (transport === 'fetch') {
      counts.fetch += 1;
      evidence.push(
        evidenceRef(item, 'observed fetch request')
      );
    }

    if (transport === 'xhr') {
      counts.xhr += 1;
      evidence.push(
        evidenceRef(item, 'observed XHR request')
      );
    }
  }

  for (const item of timeline) {
    if (item?.kind !== 'form-submit') {
      continue;
    }

    const isTopFrame =
      item?.data?.isTopFrame === true ||
      item?.frameId === 0;

    if (!isTopFrame) {
      continue;
    }

    counts.classicForm += 1;

    evidence.push(
      evidenceRef(
        item,
        'observed top-level form submission'
      )
    );
  }

  for (const item of timeline) {
    if (item?.kind !== 'hard-navigation') {
      continue;
    }

    /*
     * Parser transport describes the top-level workflow.
     * Frame-aware capture also records subframe navigations,
     * so those must not redefine the document transport model.
     */
    const isTopFrame =
      item?.data?.isTopFrame === true ||
      item?.frameId === 0;

    if (!isTopFrame) {
      continue;
    }

    counts.hardNavigation += 1;

    evidence.push(
      evidenceRef(
        item,
        'observed top-level hard navigation'
      )
    );
  }

  const active = [];

  if (counts.fetch > 0) {
    active.push('fetch');
  }

  if (counts.xhr > 0) {
    active.push('xhr');
  }

  if (counts.classicForm > 0) {
    active.push('classic-form');
  }

  if (counts.hardNavigation > 0) {
    active.push('hard-navigation');
  }

  let primary = 'unknown';
  let confidence = 0;

  if (active.length === 1) {
    primary = active[0];
    confidence = 0.9;
  } else if (active.length > 1) {
    primary = 'mixed';
    confidence = 0.85;
  }

  /*
   * Stable ordering makes the canonical blueprint deterministic
   * even if callers provide arrays assembled from different sources.
   */
  evidence.sort((a, b) => {
    const aSequence =
      Number.isFinite(a.sequence)
        ? a.sequence
        : Number.MAX_SAFE_INTEGER;

    const bSequence =
      Number.isFinite(b.sequence)
        ? b.sequence
        : Number.MAX_SAFE_INTEGER;

    if (aSequence !== bSequence) {
      return aSequence - bSequence;
    }

    return String(a.eventId || '').localeCompare(
      String(b.eventId || '')
    );
  });

  return {
    primary,
    counts,
    confidence,
    evidence
  };
}

export function generateParserBlueprint(session = {}) {
  const safeSession =
    session && typeof session === 'object'
      ? session
      : {};

  return {
    schemaVersion: 1,

    source: {
      sessionId:
        safeString(safeSession.sessionId) || null,

      sessionSequence:
        safeNumber(safeSession.sequence),

      pageUrl:
        safeString(safeSession.pageUrl)
    },

    transport:
      inferTransport(safeSession),

    /*
     * These sections are part of the stable schema now,
     * but their inference arrives in later PB stages.
     */
    workflow: {
      steps: []
    },

    forms: {
      status: 'not-observed',
      observations: []
    },

    stateCarriers: [],

    signals: {
      protection: [],
      analytics: [],
      infrastructure: [],
      unknown: []
    },

    implications: [],

    gaps: []
  };
}
