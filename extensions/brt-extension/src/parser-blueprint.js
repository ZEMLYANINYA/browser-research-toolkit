import { classifyAntiBotRecord } from './antibot.js';

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

const PROVIDER_BY_CATEGORY = Object.freeze({
  cloudflare: 'Cloudflare',
  akamai: 'Akamai',
  perimeterx: 'PerimeterX',
  datadome: 'DataDome',
  incapsula: 'Incapsula',
  f5: 'F5 BIG-IP / Advanced WAF'
});

function providerFromCategories(categories) {
  for (const category of Array.isArray(categories) ? categories : []) {
    const provider =
      PROVIDER_BY_CATEGORY[
        String(category || '').toLowerCase()
      ];

    if (provider) return provider;
  }

  return null;
}

function signalEvidenceRef(signal, reason) {
  return {
    signalId:
      safeString(signal?.signalId) || null,
    sequence:
      Number.isFinite(Number(signal?.firstSequence))
        ? Number(signal.firstSequence)
        : null,
    kind:
      safeString(signal?.kind) || 'unknown',
    documentId:
      safeString(signal?.documentId) || null,
    reason
  };
}

function buildSignals(session) {
  const network =
    Array.isArray(session?.network)
      ? session.network
      : [];

  const retained =
    Array.isArray(session?.antiBot?.signals)
      ? session.antiBot.signals
      : [];

  const protection = retained
    .map(signal => {
      const categories =
        Array.isArray(signal?.categories)
          ? signal.categories
              .map(value => safeString(value))
              .filter(Boolean)
          : [];

      return {
        provider:
          providerFromCategories(categories),

        categories,

        confidence:
          Number.isFinite(Number(signal?.confidence))
            ? Math.max(
                0,
                Math.min(
                  1,
                  Number(signal.confidence)
                )
              )
            : 0,

        endpointMatches:
          Array.isArray(signal?.endpointMatches)
            ? signal.endpointMatches
                .map(value => safeString(value))
                .filter(Boolean)
            : [],

        summary: {
          url:
            safeString(signal?.summary?.url) || null,
          transport:
            safeString(
              signal?.summary?.transport
            ) || null,
          method:
            safeString(
              signal?.summary?.method
            ) || null,
          status:
            Number.isFinite(
              Number(signal?.summary?.status)
            )
              ? Number(signal.summary.status)
              : null
        },

        evidence: [
          signalEvidenceRef(
            signal,
            'retained anti-bot signal'
          )
        ]
      };
    })
    .sort((a, b) => {
      const aId =
        a.evidence[0]?.signalId || '';

      const bId =
        b.evidence[0]?.signalId || '';

      return aId.localeCompare(bId);
    });

  const analytics = [];

  const infrastructure = [];

  const unknown = [];

  for (const item of network) {
    const data =
      item?.data && typeof item.data === 'object'
        ? item.data
        : {};

    let classification = null;

    try {
      classification =
        classifyAntiBotRecord(item);
    } catch {}

    const telemetry =
      data.classification === 'analytics' ||
      (
        Array.isArray(
          classification?.telemetryMatches
        ) &&
        classification.telemetryMatches.length > 0
      );

    if (telemetry) {
      analytics.push({
        classification: 'analytics',
        transport:
          safeString(data.transport) || null,
        method:
          safeString(data.method) || null,
        target:
          safeString(data.url) || null,
        confidence: 0.95,
        evidence: [
          evidenceRef(
            item,
            'observed analytics or telemetry request'
          )
        ]
      });
    }

    if (
      classification &&
      classification.isAntiBotSignal !== true
    ) {
      const providers =
        (classification.evidence || [])
          .filter(value =>
            String(value).startsWith(
              'provider:'
            )
          )
          .map(value =>
            String(value).slice(
              'provider:'.length
            )
          )
          .filter(Boolean);

      for (const provider of providers) {
        infrastructure.push({
          provider,
          confidence: 0.72,
          evidence: [
            evidenceRef(
              item,
              'provider or routing infrastructure evidence'
            )
          ]
        });
      }

      const categories =
        Array.isArray(classification.categories)
          ? classification.categories
              .map(value => safeString(value))
              .filter(Boolean)
          : [];

      const weakEvidence =
        Array.isArray(classification.evidence)
          ? classification.evidence
              .map(value => safeString(value))
              .filter(Boolean)
          : [];

      if (
        !telemetry &&
        providers.length === 0 &&
        categories.length > 0 &&
        weakEvidence.length > 0
      ) {
        unknown.push({
          categories,

          confidence:
            Number.isFinite(
              Number(classification.ruleWeight)
            )
              ? Math.max(
                  0,
                  Math.min(
                    0.49,
                    Number(
                      classification.ruleWeight
                    )
                  )
                )
              : 0.25,

          evidence: [
            evidenceRef(
              item,
              'weak signal evidence without a confirmed classification'
            )
          ]
        });
      }
    }
  }

  analytics.sort((a, b) =>
    String(
      a.evidence[0]?.eventId || ''
    ).localeCompare(
      String(
        b.evidence[0]?.eventId || ''
      )
    )
  );

  infrastructure.sort((a, b) => {
    const providerDelta =
      String(a.provider || '')
        .localeCompare(
          String(b.provider || '')
        );

    if (providerDelta !== 0) {
      return providerDelta;
    }

    return String(
      a.evidence[0]?.eventId || ''
    ).localeCompare(
      String(
        b.evidence[0]?.eventId || ''
      )
    );
  });

  unknown.sort((a, b) =>
    String(
      a.evidence[0]?.eventId || ''
    ).localeCompare(
      String(
        b.evidence[0]?.eventId || ''
      )
    )
  );

  return {
    protection,
    analytics,
    infrastructure,
    unknown
  };
}

const COOKIE_ATTRIBUTE_NAMES =
  new Set([
    'path',
    'domain',
    'expires',
    'max-age',
    'secure',
    'httponly',
    'samesite',
    'priority',
    'partitioned'
  ]);

function cookieNames(value) {
  const names = [];

  const add = name => {
    const normalized =
      String(name || '').trim();

    if (!normalized) return;

    if (
      COOKIE_ATTRIBUTE_NAMES.has(
        normalized.toLowerCase()
      )
    ) {
      return;
    }

    if (!names.includes(normalized)) {
      names.push(normalized);
    }
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (
        item &&
        typeof item === 'object'
      ) {
        add(item.name);
        continue;
      }

      if (typeof item === 'string') {
        for (
          const name
          of cookieNames(item)
        ) {
          add(name);
        }
      }
    }

    return names;
  }

  if (typeof value !== 'string') {
    return names;
  }

  for (
    const chunk
    of value.split(/[;\r\n]+/)
  ) {
    const trimmed = chunk.trim();

    if (!trimmed) continue;

    const separator =
      trimmed.indexOf('=');

    if (separator < 0) {
      add(trimmed);
      continue;
    }

    add(
      trimmed.slice(0, separator)
    );
  }

  return names;
}

function carrierKey(carrier) {
  return [
    carrier.type || '',
    carrier.storage || '',
    carrier.name || '',
    carrier.key || '',
    carrier.documentId || '',
    Number.isInteger(carrier.frameId)
      ? carrier.frameId
      : ''
  ].join('|');
}

function buildStateCarriers(
  session,
  forms
) {
  const timeline =
    Array.isArray(session?.timeline)
      ? session.timeline
      : [];

  const network =
    Array.isArray(session?.network)
      ? session.network
      : [];

  const carriers = [];

  for (const item of timeline) {
    if (
      item?.kind !==
      'storage-snapshot'
    ) {
      continue;
    }

    const storage =
      safeString(item?.data?.storage) ||
      'unknown';

    const keys =
      Array.isArray(item?.data?.keys)
        ? item.data.keys
        : [];

    for (const entry of keys) {
      const key =
        safeString(entry?.key);

      if (!key) continue;

      carriers.push({
        type: 'storage-key',
        storage,
        key,
        valueLength:
          Number.isFinite(
            Number(entry?.length)
          )
            ? Number(entry.length)
            : null,
        documentId:
          safeString(
            item.documentId
          ) || null,
        frameId:
          Number.isInteger(item.frameId)
            ? item.frameId
            : null,
        confidence: 0.95,
        evidence: [
          evidenceRef(
            item,
            'observed storage key metadata'
          )
        ]
      });
    }
  }

  for (
    const observation
    of forms?.observations || []
  ) {
    for (
      const field
      of observation.fields || []
    ) {
      if (!field.hidden) continue;

      carriers.push({
        type: 'hidden-form-field',
        name: field.name || null,
        fieldIndex:
          Number.isInteger(
            field.fieldIndex
          )
            ? field.fieldIndex
            : null,
        hasValue:
          Boolean(field.hasValue),
        documentId:
          observation.documentId || null,
        frameId:
          Number.isInteger(
            observation.frameId
          )
            ? observation.frameId
            : null,
        confidence: 0.9,
        evidence: [
          observation.evidence
        ].filter(Boolean)
      });
    }
  }

  for (const item of network) {
    const values = [
      item?.data?.cookies,
      item?.data?.setCookie
    ];

    for (const value of values) {
      for (
        const name
        of cookieNames(value)
      ) {
        carriers.push({
          type: 'cookie',
          name,
          documentId:
            safeString(
              item.documentId
            ) || null,
          frameId:
            Number.isInteger(
              item.frameId
            )
              ? item.frameId
              : null,
          confidence: 0.9,
          evidence: [
            evidenceRef(
              item,
              'observed cookie carrier name'
            )
          ]
        });
      }
    }
  }

  const deduped = new Map();

  for (const carrier of carriers) {
    const key = carrierKey(carrier);

    if (!deduped.has(key)) {
      deduped.set(key, carrier);
    }
  }

  return [...deduped.values()];
}

function uniqueEvidence(items) {
  const result = [];
  const seen = new Set();

  for (const item of items) {
    if (!item) continue;

    const key = [
      item.eventId || '',
      item.signalId || '',
      item.sequence ?? '',
      item.kind || '',
      item.documentId || ''
    ].join('|');

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(item);
  }

  return result;
}

function buildImplications(
  transport,
  forms,
  stateCarriers
) {
  const implications = [];

  const cookieEvidence =
    uniqueEvidence(
      stateCarriers
        .filter(
          carrier =>
            carrier.type === 'cookie'
        )
        .flatMap(
          carrier =>
            carrier.evidence || []
        )
    );

  if (cookieEvidence.length > 0) {
    implications.push({
      id: 'preserve-cookies',
      text:
        'Preserve observed cookie state across parser workflow steps.',
      confidence: 0.9,
      evidence: cookieEvidence
    });
  }

  const hiddenEvidence =
    uniqueEvidence(
      stateCarriers
        .filter(
          carrier =>
            carrier.type ===
            'hidden-form-field'
        )
        .flatMap(
          carrier =>
            carrier.evidence || []
        )
    );

  if (hiddenEvidence.length > 0) {
    implications.push({
      id:
        'refresh-hidden-form-state',
      text:
        'Refresh document-scoped hidden form state before reproducing form submissions.',
      confidence: 0.82,
      evidence: hiddenEvidence
    });
  }

  const changingFields =
    (forms?.models || [])
      .flatMap(
        model =>
          model.fields || []
      )
      .filter(
        field =>
          field.nameStability ===
          'changing'
      );

  const changingEvidence =
    uniqueEvidence(
      changingFields.flatMap(
        field =>
          field.evidence || []
      )
    );

  if (
    changingEvidence.length > 0
  ) {
    implications.push({
      id:
        'do-not-hard-code-generated-field-names',
      text:
        'Do not hard-code field names that change across observed form submissions.',
      confidence: 0.9,
      evidence: changingEvidence
    });
  }

  const formEvidence =
    uniqueEvidence(
      [
        ...(transport?.evidence || [])
          .filter(item =>
            String(
              item?.reason || ''
            ).includes(
              'form submission'
            )
          ),

        ...(forms?.observations || [])
          .map(
            observation =>
              observation.evidence
          )
      ]
    );

  if (
    Number(
      transport?.counts?.classicForm
    ) > 0 &&
    formEvidence.length > 0
  ) {
    implications.push({
      id:
        'reproduce-classic-form-submission',
      text:
        'Reproduce the observed classic form submission semantics.',
      confidence: 0.92,
      evidence: formEvidence
    });
  }

  return implications;
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

  const transport =
    inferTransport(safeSession);

  const signals =
    buildSignals(safeSession);

  const stateCarriers =
    buildStateCarriers(
      safeSession,
      forms
    );

  const implications =
    buildImplications(
      transport,
      forms,
      stateCarriers
    );

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

    transport,

    /*
     * These sections are part of the stable schema now,
     * but their inference arrives in later PB stages.
     */
    workflow,

    forms,

    stateCarriers,

    signals,

    implications,

    gaps
  };
}
