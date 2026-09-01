function text(value, fallback = '') {
  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  return fallback;
}

function number(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function confidence(value) {
  const parsed = number(value);

  if (parsed == null) {
    return 'unknown';
  }

  return parsed.toFixed(2);
}

function inline(value) {
  return text(value, 'unknown')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function code(value) {
  const safe = text(value, 'unknown')
    .replace(/`/g, "'");

  return '`' + safe + '`';
}

function sortedCopy(items, selector) {
  return Array.isArray(items)
    ? [...items].sort((a, b) =>
        selector(a).localeCompare(
          selector(b)
        )
      )
    : [];
}

function evidenceIdentity(item) {
  return [
    text(item?.eventId),
    text(item?.signalId),
    String(number(item?.sequence) ?? ''),
    text(item?.kind),
    text(item?.documentId)
  ].join('|');
}

function renderEvidence(items) {
  const rows = sortedCopy(
    items,
    evidenceIdentity
  );

  if (rows.length === 0) {
    return ['  - Evidence: none'];
  }

  return rows.map(item => {
    const identity =
      text(item?.eventId) ||
      text(item?.signalId) ||
      'unidentified';

    const details = [
      item?.sequence != null
        ? 'seq=' +
          String(item.sequence)
        : null,

      text(item?.kind)
        ? 'kind=' + text(item.kind)
        : null,

      text(item?.documentId)
        ? 'document=' +
          text(item.documentId)
        : null,

      Number.isInteger(item?.frameId)
        ? 'frame=' +
          String(item.frameId)
        : null,

      text(item?.reason)
        ? text(item.reason)
        : null
    ].filter(Boolean);

    return (
      '  - Evidence ' +
      code(identity) +
      (
        details.length
          ? ': ' + details.join(', ')
          : ''
      )
    );
  });
}

function renderTransport(transport) {
  const counts =
    transport?.counts &&
    typeof transport.counts === 'object'
      ? transport.counts
      : {};

  const lines = [
    '## Transport Model',
    '',
    '- Primary: ' +
      code(
        text(
          transport?.primary,
          'unknown'
        )
      ),
    '- Confidence: ' +
      confidence(
        transport?.confidence
      ),
    '- Fetch: ' +
      String(number(counts.fetch) ?? 0),
    '- XHR: ' +
      String(number(counts.xhr) ?? 0),
    '- Classic form: ' +
      String(
        number(
          counts.classicForm
        ) ?? 0
      ),
    '- Hard navigation: ' +
      String(
        number(
          counts.hardNavigation
        ) ?? 0
      )
  ];

  lines.push(
    ...renderEvidence(
      transport?.evidence
    )
  );

  return lines;
}

function workflowSortKey(step) {
  const index =
    number(step?.stepIndex);

  return (
    String(
      index == null
        ? Number.MAX_SAFE_INTEGER
        : index
    ).padStart(20, '0') +
    '|' +
    evidenceIdentity(
      step?.evidence || {}
    )
  );
}

function renderWorkflow(workflow) {
  const steps = sortedCopy(
    workflow?.steps,
    workflowSortKey
  );

  const lines = [
    '## Workflow',
    ''
  ];

  if (steps.length === 0) {
    lines.push(
      '_No workflow evidence observed._'
    );

    return lines;
  }

  for (const step of steps) {
    lines.push(
      '### Step ' +
        String(
          number(step.stepIndex) ?? 0
        ),
      '',
      '- Kind: ' +
        code(text(step.kind, 'unknown')),
      '- Transport: ' +
        code(
          text(
            step.transport,
            'unknown'
          )
        ),
      '- Method: ' +
        code(
          text(
            step.method,
            'unknown'
          )
        ),
      '- Target: ' +
        inline(
          text(
            step.target,
            'unknown'
          )
        ),
      '- Trigger: ' +
        code(
          text(
            step.trigger,
            'unknown'
          )
        ),
      '- Document: ' +
        code(
          text(
            step.documentId,
            'unknown'
          )
        ),
      '- Frame: ' +
        String(
          Number.isInteger(
            step.frameId
          )
            ? step.frameId
            : 'unknown'
        )
    );

    lines.push(
      ...renderEvidence(
        step.evidence
          ? [step.evidence]
          : []
      )
    );

    lines.push('');
  }

  return lines;
}

function formModelSortKey(model) {
  return [
    text(model?.modelId),
    text(model?.selectorHint),
    text(model?.action)
  ].join('|');
}

function fieldSortKey(field) {
  return String(
    Number.isInteger(
      field?.fieldIndex
    )
      ? field.fieldIndex
      : Number.MAX_SAFE_INTEGER
  ).padStart(20, '0');
}

function renderForms(forms) {
  const models = sortedCopy(
    forms?.models,
    formModelSortKey
  );

  const lines = [
    '## Forms',
    '',
    '- Status: ' +
      code(
        text(
          forms?.status,
          'not-observed'
        )
      ),
    '- Value comparison: ' +
      code(
        text(
          forms?.valueComparison,
          'unknown'
        )
      ),
    ''
  ];

  if (models.length === 0) {
    lines.push(
      '_No form models observed._'
    );

    return lines;
  }

  for (const model of models) {
    lines.push(
      '### ' +
        inline(
          text(
            model.modelId,
            'Form'
          )
        ),
      '',
      '- Selector: ' +
        code(
          text(
            model.selectorHint,
            'unknown'
          )
        ),
      '- Name: ' +
        code(
          text(
            model.formName,
            'unknown'
          )
        ),
      '- Action: ' +
        inline(
          text(
            model.action,
            'unknown'
          )
        ),
      '- Method: ' +
        code(
          text(
            model.method,
            'unknown'
          )
        ),
      '- Enctype: ' +
        code(
          text(
            model.enctype,
            'unknown'
          )
        ),
      '- Observations: ' +
        String(
          number(
            model.observationCount
          ) ?? 0
        ),
      ''
    );

    const fields = sortedCopy(
      model.fields,
      fieldSortKey
    );

    if (fields.length === 0) {
      lines.push(
        '_No fields observed._',
        ''
      );

      continue;
    }

    lines.push(
      '| Index | Name | Name stability | Type | Value presence |',
      '| ---: | --- | --- | --- | --- |'
    );

    for (const field of fields) {
      const presence =
        field?.valuePresence || {};

      lines.push(
        '| ' +
          String(
            Number.isInteger(
              field.fieldIndex
            )
              ? field.fieldIndex
              : '?'
          ) +
          ' | ' +
          inline(
            text(
              field.stableName,
              field.observedNames?.join(
                ', '
              ) || 'unknown'
            )
          ) +
          ' | ' +
          inline(
            text(
              field.nameStability,
              'unknown'
            )
          ) +
          ' | ' +
          inline(
            text(
              field.stableType,
              field.observedTypes?.join(
                ', '
              ) || 'unknown'
            )
          ) +
          ' | ' +
          inline(
            text(
              presence.stability,
              'unknown'
            )
          ) +
          ' |'
      );
    }

    lines.push('');
  }

  return lines;
}

function carrierSortKey(carrier) {
  return [
    text(carrier?.type),
    text(carrier?.storage),
    text(carrier?.name),
    text(carrier?.key),
    text(carrier?.documentId)
  ].join('|');
}

function renderStateCarriers(carriers) {
  const rows = sortedCopy(
    carriers,
    carrierSortKey
  );

  const lines = [
    '## State Carriers',
    ''
  ];

  if (rows.length === 0) {
    lines.push(
      '_No state carriers observed._'
    );

    return lines;
  }

  for (const carrier of rows) {
    lines.push(
      '- ' +
        code(
          text(
            carrier.type,
            'unknown'
          )
        ) +
        ': ' +
        inline(
          text(
            carrier.name,
            text(
              carrier.key,
              'unnamed'
            )
          )
        ) +
        ' (confidence ' +
        confidence(
          carrier.confidence
        ) +
        ')'
    );

    lines.push(
      ...renderEvidence(
        carrier.evidence
      )
    );
  }

  return lines;
}

function signalSortKey(signal) {
  return [
    text(signal?.provider),
    signal?.categories?.join(',') || '',
    evidenceIdentity(
      signal?.evidence?.[0] || {}
    )
  ].join('|');
}

function renderSignalGroup(
  title,
  signals
) {
  const rows = sortedCopy(
    signals,
    signalSortKey
  );

  const lines = [
    '### ' + title,
    ''
  ];

  if (rows.length === 0) {
    lines.push('_None observed._');

    return lines;
  }

  for (const signal of rows) {
    const label =
      text(signal.provider) ||
      (
        Array.isArray(
          signal.categories
        )
          ? signal.categories.join(', ')
          : ''
      ) ||
      text(signal.classification) ||
      'unknown';

    lines.push(
      '- ' +
        inline(label) +
        ' (confidence ' +
        confidence(
          signal.confidence
        ) +
        ')'
    );

    lines.push(
      ...renderEvidence(
        signal.evidence
      )
    );
  }

  return lines;
}

function renderSignals(signals) {
  return [
    '## Signals',
    '',
    ...renderSignalGroup(
      'Protection',
      signals?.protection
    ),
    '',
    ...renderSignalGroup(
      'Analytics',
      signals?.analytics
    ),
    '',
    ...renderSignalGroup(
      'Infrastructure',
      signals?.infrastructure
    ),
    '',
    ...renderSignalGroup(
      'Unknown',
      signals?.unknown
    )
  ];
}

function implicationSortKey(item) {
  return text(item?.id);
}

function renderImplications(items) {
  const rows = sortedCopy(
    items,
    implicationSortKey
  );

  const lines = [
    '## Parser Implications',
    ''
  ];

  if (rows.length === 0) {
    lines.push(
      '_No parser implications inferred._'
    );

    return lines;
  }

  for (const item of rows) {
    lines.push(
      '### ' +
        inline(
          text(
            item.id,
            'implication'
          )
        ),
      '',
      inline(
        text(
          item.text,
          'No description.'
        )
      ),
      '',
      '- Confidence: ' +
        confidence(
          item.confidence
        )
    );

    lines.push(
      ...renderEvidence(
        item.evidence
      )
    );

    lines.push('');
  }

  return lines;
}

function gapSortKey(gap) {
  return text(gap?.id);
}

function renderGaps(gaps) {
  const rows = sortedCopy(
    gaps,
    gapSortKey
  );

  const lines = [
    '## Evidence Gaps',
    ''
  ];

  if (rows.length === 0) {
    lines.push(
      '_No unresolved evidence gaps._'
    );

    return lines;
  }

  for (const gap of rows) {
    lines.push(
      '- ' +
        code(
          text(
            gap.id,
            'unknown'
          )
        ) +
        ': ' +
        inline(
          text(
            gap.reason,
            'No reason provided.'
          )
        )
    );
  }

  return lines;
}

export function renderParserBlueprintMarkdown(
  blueprint = {}
) {
  const safe =
    blueprint &&
    typeof blueprint === 'object'
      ? blueprint
      : {};

  const source =
    safe.source &&
    typeof safe.source === 'object'
      ? safe.source
      : {};

  const lines = [
    '# Parser Blueprint',
    '',
    '- Schema version: ' +
      String(
        number(
          safe.schemaVersion
        ) ?? 'unknown'
      ),
    '- Session: ' +
      code(
        text(
          source.sessionId,
          'unknown'
        )
      ),
    '- Session sequence: ' +
      String(
        number(
          source.sessionSequence
        ) ?? 'unknown'
      ),
    '- Page: ' +
      inline(
        text(
          source.pageUrl,
          'unknown'
        )
      ),
    '',
    ...renderTransport(
      safe.transport || {}
    ),
    '',
    ...renderWorkflow(
      safe.workflow || {}
    ),
    '',
    ...renderForms(
      safe.forms || {}
    ),
    '',
    ...renderStateCarriers(
      safe.stateCarriers
    ),
    '',
    ...renderSignals(
      safe.signals || {}
    ),
    '',
    ...renderImplications(
      safe.implications
    ),
    '',
    ...renderGaps(
      safe.gaps
    )
  ];

  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() +
    '\n'
  );
}
