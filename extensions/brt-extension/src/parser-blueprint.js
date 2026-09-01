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

function compareBlueprintEvents(a, b) {
  const sequenceA = Number.isFinite(Number(a?.sequence))
    ? Number(a.sequence)
    : Number.MAX_SAFE_INTEGER;

  const sequenceB = Number.isFinite(Number(b?.sequence))
    ? Number(b.sequence)
    : Number.MAX_SAFE_INTEGER;

  if (sequenceA !== sequenceB) {
    return sequenceA - sequenceB;
  }

  const timeA = Number.isFinite(Number(a?.wallTime))
    ? Number(a.wallTime)
    : Number.MAX_SAFE_INTEGER;

  const timeB = Number.isFinite(Number(b?.wallTime))
    ? Number(b.wallTime)
    : Number.MAX_SAFE_INTEGER;

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  return String(a?.eventId || '')
    .localeCompare(String(b?.eventId || ''));
}

function workflowEventKey(item) {
  const eventId = safeString(item?.eventId);

  if (eventId) {
    return 'event:' + eventId;
  }

  return [
    safeString(item?.kind),
    Number(item?.sequence) || 0,
    safeString(item?.documentId),
    Number.isInteger(item?.frameId)
      ? item.frameId
      : 'unknown'
  ].join('|');
}

function buildWorkflow(session) {
  const timeline = Array.isArray(session?.timeline)
    ? session.timeline
    : [];

  const network = Array.isArray(session?.network)
    ? session.network
    : [];

  const relevant = [
    ...timeline,
    ...network
  ].filter(item =>
    item?.kind === 'form-submit' ||
    item?.kind === 'network-request' ||
    item?.kind === 'hard-navigation'
  );

  const deduped = new Map();

  for (const item of relevant) {
    const key = workflowEventKey(item);

    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  const ordered = [...deduped.values()]
    .sort(compareBlueprintEvents);

  return {
    steps: ordered.map((item, stepIndex) => {
      const data =
        item?.data && typeof item.data === 'object'
          ? item.data
          : {};

      let target = null;
      let transport = null;
      let method = null;
      let reason = 'observed workflow event';

      if (item.kind === 'form-submit') {
        target = safeString(data.action) || null;
        transport = 'classic-form';
        method = safeString(data.method)
          ? safeString(data.method).toUpperCase()
          : null;
        reason = 'observed form submission';
      }

      if (item.kind === 'network-request') {
        target = safeString(data.url) || null;
        transport =
          safeString(data.transport) || 'network';
        method = safeString(data.method)
          ? safeString(data.method).toUpperCase()
          : null;
        reason = 'observed network request';
      }

      if (item.kind === 'hard-navigation') {
        target =
          safeString(data.url) ||
          safeString(data.to) ||
          null;
        transport = 'document';
        reason = 'observed hard navigation';
      }

      return {
        stepIndex,
        kind: safeString(item.kind) || 'unknown',
        method,
        target,
        transport,
        trigger:
          item.kind === 'form-submit'
            ? safeString(data.trigger) || null
            : null,
        documentId:
          safeString(item.documentId) || null,
        frameId:
          Number.isInteger(item.frameId)
            ? item.frameId
            : null,
        evidence: evidenceRef(item, reason)
      };
    })
  };
}

function normalizeFormField(field, fallbackIndex) {
  return {
    fieldIndex:
      Number.isInteger(field?.fieldIndex)
        ? field.fieldIndex
        : fallbackIndex,
    name: safeString(field?.name) || null,
    type: safeString(field?.type) || 'unknown',
    hidden: Boolean(field?.hidden),
    disabled: Boolean(field?.disabled),
    required: Boolean(field?.required),
    multiple: Boolean(field?.multiple),
    checked: Boolean(field?.checked),
    hasValue: Boolean(field?.hasValue)
  };
}

function normalizeFormObservation(item) {
  const data =
    item?.data && typeof item.data === 'object'
      ? item.data
      : {};

  const fields = Array.isArray(data.fields)
    ? data.fields.map(
        (field, index) =>
          normalizeFormField(field, index)
      )
    : [];

  return {
    eventId: safeString(item?.eventId) || null,
    sequence:
      Number.isFinite(Number(item?.sequence))
        ? Number(item.sequence)
        : null,
    documentId:
      safeString(item?.documentId) || null,
    frameId:
      Number.isInteger(item?.frameId)
        ? item.frameId
        : null,
    trigger:
      safeString(data.trigger) || 'unknown',
    action:
      safeString(data.action) || null,
    method:
      safeString(data.method)
        ? safeString(data.method).toUpperCase()
        : null,
    enctype:
      safeString(data.enctype) || null,
    form: {
      selectorHint:
        safeString(data.form?.selectorHint) || null,
      name:
        safeString(data.form?.name) || null
    },
    fieldCount:
      Number.isInteger(data.fieldCount)
        ? data.fieldCount
        : fields.length,
    fieldsTruncated:
      Boolean(data.fieldsTruncated),
    fields,
    evidence: evidenceRef(
      item,
      'observed form submission'
    )
  };
}

function formIdentity(observation) {
  return [
    Number.isInteger(observation.frameId)
      ? observation.frameId
      : 'unknown',
    observation.form?.selectorHint ||
      observation.form?.name ||
      '[anonymous-form]',
    observation.method || '',
    observation.action || ''
  ].join('|');
}

function uniqueObserved(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (value == null || value === '') {
      continue;
    }

    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function buildFormFieldModel(
  observations,
  fieldIndex
) {
  const rows = observations
    .map(observation =>
      observation.fields.find(
        field => field.fieldIndex === fieldIndex
      )
    )
    .filter(Boolean);

  const observedNames = uniqueObserved(
    rows.map(row => row.name)
  );

  const observedTypes = uniqueObserved(
    rows.map(row => row.type)
  );

  let nameStability = 'insufficient-evidence';

  if (observations.length >= 2) {
    nameStability =
      rows.length === observations.length &&
      rows.every(
        row => row.name === rows[0]?.name
      )
        ? 'stable'
        : 'changing';
  }

  let typeStability = 'insufficient-evidence';

  if (observations.length >= 2) {
    typeStability =
      rows.length === observations.length &&
      rows.every(
        row => row.type === rows[0]?.type
      )
        ? 'stable'
        : 'changing';
  }

  const present =
    rows.filter(row => row.hasValue).length;

  const empty =
    observations.length - present;

  let presenceStability =
    'insufficient-evidence';

  if (observations.length >= 2) {
    presenceStability =
      present === observations.length ||
      empty === observations.length
        ? 'stable'
        : 'changing';
  }

  return {
    fieldIndex,

    observedNames,

    nameStability,

    stableName:
      nameStability === 'stable'
        ? observedNames[0] ?? null
        : null,

    observedTypes,

    typeStability,

    stableType:
      typeStability === 'stable'
        ? observedTypes[0] ?? null
        : null,

    observedIn: rows.length,

    missingFrom:
      observations.length - rows.length,

    valuePresence: {
      present,
      empty,
      stability: presenceStability
    },

    evidence: observations
      .filter(observation =>
        observation.fields.some(
          field =>
            field.fieldIndex === fieldIndex
        )
      )
      .map(observation => observation.evidence)
  };
}

function buildForms(session) {
  const timeline = Array.isArray(session?.timeline)
    ? session.timeline
    : [];

  const observations = timeline
    .filter(item => item?.kind === 'form-submit')
    .sort(compareBlueprintEvents)
    .map(normalizeFormObservation);

  const grouped = new Map();

  for (const observation of observations) {
    const key = formIdentity(observation);

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(observation);
  }

  const models = [...grouped.values()]
    .map((group, index) => {
      const indices = new Set();

      for (const observation of group) {
        for (const field of observation.fields) {
          indices.add(field.fieldIndex);
        }
      }

      const fields = [...indices]
        .sort((a, b) => a - b)
        .map(fieldIndex =>
          buildFormFieldModel(
            group,
            fieldIndex
          )
        );

      const first = group[0];

      return {
        modelId: 'form-' + (index + 1),
        frameId: first?.frameId ?? null,
        selectorHint:
          first?.form?.selectorHint || null,
        formName:
          first?.form?.name || null,
        action: first?.action || null,
        method: first?.method || null,
        enctype: first?.enctype || null,
        observationCount: group.length,
        fields,
        evidence:
          group.map(
            observation => observation.evidence
          )
      };
    });

  return {
    status:
      observations.length > 0
        ? 'observed'
        : 'not-observed',

    valueComparison: 'presence-only',

    observations,

    models
  };
}

function buildBlueprintGaps(forms) {
  const gaps = [];

  if (forms.observations.length > 0) {
    gaps.push({
      id: 'form-value-equality',
      reason:
        'Raw form field values are intentionally not retained; only value presence can be compared.'
    });
  }

  return gaps;
}

export function generateParserBlueprint(session = {}) {
  const safeSession =
    session && typeof session === 'object'
      ? session
      : {};

  const workflow =
    buildWorkflow(safeSession);

  const forms =
    buildForms(safeSession);

  const gaps =
    buildBlueprintGaps(forms);

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
    workflow,

    forms,

    stateCarriers: [],

    signals: {
      protection: [],
      analytics: [],
      infrastructure: [],
      unknown: []
    },

    implications: [],

    gaps
  };
}
