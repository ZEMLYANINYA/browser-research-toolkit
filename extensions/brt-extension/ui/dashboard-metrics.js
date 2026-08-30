export function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function formatBytes(bytes) {
  const value = Math.max(0, finiteNumber(bytes));
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function sessionDurationMs(session) {
  const events = session?.timeline || [];
  const times = events.map(item => finiteNumber(item.wallTime, NaN)).filter(Number.isFinite);
  const start = finiteNumber(session?.startedAt, times.length ? Math.min(...times) : Date.now());
  const end = session?.running ? Date.now() : finiteNumber(session?.updatedAt, times.length ? Math.max(...times) : start);
  return Math.max(0, end - start);
}

function bucketIndex(time, start, span, count) {
  if (count <= 1 || span <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor(((time - start) / span) * count)));
}

export function buildTimeBuckets(session, count = 42) {
  const timeline = (session?.timeline || []).filter(item => Number.isFinite(Number(item.wallTime)));
  if (!timeline.length) return [];
  const min = Math.min(...timeline.map(item => Number(item.wallTime)));
  const max = Math.max(...timeline.map(item => Number(item.wallTime)));
  const span = Math.max(1, max - min);
  const buckets = Array.from({ length: count }, (_, index) => ({
    index,
    from: min + (span * index / count),
    to: min + (span * (index + 1) / count),
    network: 0,
    dom: 0,
    navigation: 0,
    sources: 0,
    antibot: 0,
    other: 0,
    total: 0
  }));
  for (const item of timeline) {
    const bucket = buckets[bucketIndex(Number(item.wallTime), min, span, count)];
    const kind = String(item.kind || '');
    if (kind.includes('network') || kind.includes('websocket')) bucket.network += 1;
    else if (kind === 'dom-event' || kind === 'mutation') bucket.dom += 1;
    else if (kind.includes('navigation') || kind.includes('frame')) bucket.navigation += 1;
    else if (kind.includes('source') || kind.includes('script')) bucket.sources += 1;
    else if (kind.includes('antibot') || kind.includes('challenge') || kind.includes('captcha')) bucket.antibot += 1;
    else bucket.other += 1;
    bucket.total += 1;
  }
  return buckets;
}

export function summarizeNetwork(session) {
  const records = session?.network || [];
  const requests = records.filter(row => row.kind === 'network-request');
  const responses = records.filter(row => row.kind === 'network-response');
  const byTransport = {};
  const byStatus = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, Other: 0 };
  const byHost = {};
  for (const row of requests) {
    const transport = String(row.data?.transport || 'other').toUpperCase();
    byTransport[transport] = (byTransport[transport] || 0) + 1;
    try {
      const host = new URL(row.data?.url || '').hostname || 'unknown';
      byHost[host] = (byHost[host] || 0) + 1;
    } catch { byHost.unknown = (byHost.unknown || 0) + 1; }
  }
  for (const row of responses) {
    const status = finiteNumber(row.data?.status, 0);
    if (status >= 200 && status < 300) byStatus['2xx'] += 1;
    else if (status >= 300 && status < 400) byStatus['3xx'] += 1;
    else if (status >= 400 && status < 500) byStatus['4xx'] += 1;
    else if (status >= 500 && status < 600) byStatus['5xx'] += 1;
    else byStatus.Other += 1;
  }
  return {
    requests: requests.length,
    responses: responses.length,
    byTransport: Object.entries(byTransport).sort((a,b) => b[1] - a[1]),
    byStatus: Object.entries(byStatus).filter(([,v]) => v > 0),
    topHosts: Object.entries(byHost).sort((a,b) => b[1] - a[1]).slice(0, 8)
  };
}

export function buildWaterfall(session, limit = 28) {
  const records = session?.network || [];
  const requests = new Map();
  const rows = [];
  for (const row of records) {
    const id = row.data?.requestId;
    if (!id) continue;
    if (row.kind === 'network-request') requests.set(id, row);
    if (row.kind === 'network-response') {
      const request = requests.get(id);
      const start = finiteNumber(request?.wallTime, finiteNumber(row.wallTime));
      const duration = Math.max(0.2, finiteNumber(row.data?.duration, finiteNumber(row.wallTime) - start));
      rows.push({
        id,
        start,
        duration,
        status: finiteNumber(row.data?.status, 0),
        transport: row.data?.transport || request?.data?.transport || 'network',
        method: request?.data?.method || '',
        url: row.data?.url || request?.data?.url || '',
        classification: row.data?.classification || request?.data?.classification || ''
      });
    }
  }
  return rows.sort((a,b) => b.start - a.start).slice(0, limit).sort((a,b) => a.start - b.start);
}

export function provenanceBreakdown(session) {
  const counts = { 'extension-controlled': 0, 'browser-controlled': 0, 'page-observable': 0, unknown: 0 };
  for (const row of session?.timeline || []) {
    const integrity = row.provenance?.integrity || (row.source === 'cdp' ? 'extension-controlled' : row.source === 'webNavigation' ? 'browser-controlled' : row.source === 'page-agent' ? 'page-observable' : 'unknown');
    counts[integrity] = (counts[integrity] || 0) + 1;
  }
  return Object.entries(counts).filter(([, value]) => value > 0).sort((a,b) => b[1] - a[1]);
}

export function buildHealth(session) {
  const storage = session?.storageStats || {};
  const retention = session?.retention || {};
  const errors = session?.errors || [];
  const cdpState = String(session?.cdpState || 'disabled');
  const requested = String(session?.requestedMode || session?.mode || 'standard');
  return [
    { key: 'Capture', state: session?.running ? 'healthy' : 'stopped', value: session?.running ? 'Running' : 'Stopped' },
    { key: 'CDP', state: requested === 'deep' && cdpState !== 'attached' ? 'warn' : cdpState === 'attached' ? 'healthy' : 'neutral', value: cdpState },
    { key: 'Storage', state: finiteNumber(storage.approxBytes) > 48 * 1024 * 1024 ? 'warn' : 'healthy', value: formatBytes(storage.approxBytes || 0) },
    { key: 'Timeline retention', state: finiteNumber(retention.timelineDropped) > 0 ? 'warn' : 'healthy', value: `${finiteNumber(retention.timelineEvicted)} evicted` },
    { key: 'Network retention', state: finiteNumber(retention.networkEvicted) > 0 ? 'warn' : 'healthy', value: `${finiteNumber(retention.networkEvicted)} evicted` },
    { key: 'Errors', state: errors.length ? 'bad' : 'healthy', value: String(errors.length) }
  ];
}

export function buildCorrelationGraph(session, limitOrOptions = 18) {
  const options = typeof limitOrOptions === 'number'
    ? { limit: limitOrOptions }
    : (limitOrOptions || {});
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 18));
  const kindFilter = String(options.kind || 'all').toLowerCase();
  const hostFilter = String(options.host || '').trim().toLowerCase();
  const focusNodeId = options.focusNodeId ? String(options.focusNodeId) : '';
  const eventKind = event => {
    const kind = String(event?.kind || '').toLowerCase();
    if (kind.includes('network') || kind.includes('websocket')) return 'network';
    if (kind === 'dom-event' || kind === 'mutation') return 'dom';
    if (kind.includes('navigation') || kind.includes('frame')) return 'navigation';
    return 'other';
  };
  const eventHost = event => {
    const raw = event?.summary?.url || event?.data?.url || event?.url || '';
    try { return new URL(raw).hostname.toLowerCase(); } catch { return ''; }
  };
  const matches = relationship => {
    const events = [relationship?.fromEvent, relationship?.toEvent].filter(Boolean);
    if (focusNodeId && !events.some(event => event.eventId === focusNodeId)) return false;
    if (kindFilter !== 'all' && !events.some(event => eventKind(event) === kindFilter)) return false;
    if (hostFilter && !events.some(event => eventHost(event).includes(hostFilter))) return false;
    return true;
  };
  const correlations = [...(session?.correlations || [])].filter(matches).slice(-limit);
  const nodes = new Map();
  const edges = [];
  const addNode = event => {
    if (!event?.eventId) return;
    if (!nodes.has(event.eventId)) nodes.set(event.eventId, {
      id: event.eventId,
      kind: event.kind || 'event',
      label: event.label || event.kind || event.eventId,
      sequence: finiteNumber(event.sequence),
      wallTime: finiteNumber(event.wallTime),
      summary: event.summary || {}
    });
  };
  for (const relationship of correlations) {
    addNode(relationship.fromEvent);
    addNode(relationship.toEvent);
    if (relationship.fromEventId && relationship.toEventId) edges.push({
      id: relationship.relationshipId,
      from: relationship.fromEventId,
      to: relationship.toEventId,
      confidence: finiteNumber(relationship.confidence),
      status: relationship.manualStatus || relationship.status || 'candidate'
    });
  }
  return { nodes: [...nodes.values()].sort((a,b) => a.sequence - b.sequence), edges, limit, kindFilter, hostFilter, focusNodeId };
}
