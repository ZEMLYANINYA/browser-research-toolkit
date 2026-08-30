import {
  buildCorrelationGraph,
  buildHealth,
  buildTimeBuckets,
  buildWaterfall,
  formatBytes,
  provenanceBreakdown,
  sessionDurationMs,
  summarizeNetwork
} from './dashboard-metrics.js';

const $ = (id) => document.getElementById(id);
let currentSession = null;
let currentDiagnostics = { correlations: [], diagnostics: [], api: [] };

async function call(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.ok === false) throw new Error(response.error || 'Unknown extension error');
  return response;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

function compactUrl(raw) {
  try {
    const url = new URL(raw || '');
    const queryCount = [...url.searchParams.keys()].length;
    return `${url.hostname}${url.pathname}${queryCount ? ` · +${queryCount} query` : ''}`;
  } catch { return String(raw || '').slice(0, 180); }
}

function compactDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const seconds = Math.floor(total / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours) return `${String(hours).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
  return `${String(minutes).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
}

function classifyKind(kind = '') {
  const value = String(kind);
  if (value.includes('network') || value.includes('websocket')) return 'network';
  if (value === 'dom-event' || value === 'mutation') return 'dom';
  if (value.includes('navigation') || value.includes('frame')) return 'navigation';
  if (value.includes('source') || value.includes('script')) return 'source';
  return 'other';
}

function setStatus(running, session) {
  const el = $('status');
  const requested = String(session?.requestedMode || session?.mode || 'standard').toUpperCase();
  const effective = String(session?.effectiveMode || session?.mode || 'standard').toUpperCase();
  const cdp = String(session?.cdpState || 'disabled').toUpperCase();
  if (!running) {
    el.innerHTML = '<span class="statusDot"></span>STOPPED';
    el.className = 'statusPill stopped';
    return;
  }
  const fallback = requested === 'DEEP' && effective !== requested;
  const label = requested === 'DEEP' ? `${requested}${fallback ? `→${effective}` : ''} · CDP ${cdp}` : `${effective} · RUNNING`;
  el.innerHTML = `<span class="statusDot"></span>${escapeHtml(label)}`;
  el.className = `statusPill ${fallback || (requested === 'DEEP' && cdp !== 'ATTACHED') ? 'warn' : 'running'}`;
}

function metricCard(label, value, meta = '') {
  return `<div class="metricCard"><span class="metricLabel">${escapeHtml(label)}</span><strong class="metricValue">${escapeHtml(value)}</strong><span class="metricMeta">${escapeHtml(meta)}</span></div>`;
}

function renderStats(session) {
  const c = session?.counters || {};
  const duration = sessionDurationMs(session);
  const retained = session?.timeline?.length || 0;
  const seen = session?.retention?.timelineSeen || retained;
  const retentionPct = seen ? Math.round((retained / seen) * 100) : 100;
  const values = [
    ['Requests', c.requests || 0, `${c.responses || 0} responses`],
    ['DOM events', c.domEvents || 0, `${c.navigations || 0} navigations`],
    ['Sources', c.sources || 0, `${(session?.sources || []).filter(source => source.indexed).length} indexed · ${(session?.sources || []).filter(source => source.fetchPolicy?.decision === 'blocked').length} metadata-only`],
    ['Evidence', retained, `${retentionPct}% retained`],
    ['Anti-bot', session?.antiBot?.stats?.totalSeen || 0, `${session?.antiBot?.signals?.length || 0} retained`],
    ['Correlations', session?.correlations?.length || 0, 'candidate relationships'],
    ['Tasks', c.tasksCreated || 0, `${c.tasksCompleted || 0} completed · ${c.tasksRateLimited || 0} rate-limited`],
    ['Storage', formatBytes(session?.storageStats?.approxBytes || 0), `${session?.retention?.timelineEvicted || 0} timeline evicted`],
    ['Duration', compactDuration(duration), session?.running ? 'live session' : 'captured session']
  ];
  $('stats').innerHTML = values.map(v => metricCard(...v)).join('');
}

function pointsFor(values, width, height, max) {
  if (!values.length) return '';
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((Number(value) || 0) / Math.max(1, max)) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function renderActivityChart(session) {
  const buckets = buildTimeBuckets(session, 42);
  if (!buckets.length) {
    $('activityChart').className = 'chartSurface emptyState';
    $('activityChart').textContent = 'Start capture or import a session.';
    $('activityPeak').textContent = 'peak 0';
    return;
  }
  const width = 720, height = 150, plotHeight = 118, top = 8;
  const max = Math.max(1, ...buckets.map(b => Math.max(b.network, b.dom, b.navigation, b.sources)));
  $('activityPeak').textContent = `peak ${max}/bucket`;
  const networkPoints = pointsFor(buckets.map(b => b.network), width, plotHeight, max).split(' ').map(p => { const [x,y] = p.split(','); return `${x},${Number(y)+top}`; }).join(' ');
  const domPoints = pointsFor(buckets.map(b => b.dom), width, plotHeight, max).split(' ').map(p => { const [x,y] = p.split(','); return `${x},${Number(y)+top}`; }).join(' ');
  const navPoints = pointsFor(buckets.map(b => b.navigation), width, plotHeight, max).split(' ').map(p => { const [x,y] = p.split(','); return `${x},${Number(y)+top}`; }).join(' ');
  const sourcePoints = pointsFor(buckets.map(b => b.sources), width, plotHeight, max).split(' ').map(p => { const [x,y] = p.split(','); return `${x},${Number(y)+top}`; }).join(' ');
  const first = networkPoints.split(' ')[0]?.split(',') || ['0', String(height)];
  const last = networkPoints.split(' ').at(-1)?.split(',') || [String(width), String(height)];
  const area = `0,${height} ${networkPoints} ${last[0]},${height}`;
  $('activityChart').className = 'chartSurface';
  $('activityChart').innerHTML = `<svg class="chartSvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Session activity chart">
    <line class="chartGrid" x1="0" y1="${top + plotHeight * .25}" x2="${width}" y2="${top + plotHeight * .25}" />
    <line class="chartGrid" x1="0" y1="${top + plotHeight * .5}" x2="${width}" y2="${top + plotHeight * .5}" />
    <line class="chartGrid" x1="0" y1="${top + plotHeight * .75}" x2="${width}" y2="${top + plotHeight * .75}" />
    <polygon class="chartAreaNetwork" points="${area}" />
    <polyline class="chartLineNetwork" points="${networkPoints}" />
    <polyline class="chartLineDom" points="${domPoints}" />
    <polyline class="chartLineNav" points="${navPoints}" />
    <polyline class="chartLineSource" points="${sourcePoints}" />
  </svg>`;
}

function renderHealth(session) {
  const rows = buildHealth(session);
  $('healthPanel').innerHTML = rows.map(row => `<div class="healthRow"><i class="healthIndicator ${escapeHtml(row.state)}"></i><span class="healthName">${escapeHtml(row.key)}</span><span class="healthValue">${escapeHtml(row.value)}</span></div>`).join('');
}

function renderBars(target, rows, className = '') {
  const total = rows.reduce((sum, [,value]) => sum + Number(value || 0), 0);
  const max = Math.max(1, ...rows.map(([,value]) => Number(value || 0)));
  target.innerHTML = `<div class="barStack">${rows.map(([label,value]) => `<div class="barRow"><span class="barLabel" title="${escapeHtml(label)}">${escapeHtml(label)}</span><span class="barTrack"><i class="barFill ${className}" style="width:${Math.max(2,(Number(value || 0)/max)*100).toFixed(1)}%"></i></span><span class="barValue">${escapeHtml(value)}${total ? ` · ${Math.round((Number(value || 0)/total)*100)}%` : ''}</span></div>`).join('')}</div>`;
}

function renderProvenance(session) {
  const rows = provenanceBreakdown(session);
  if (!rows.length) { $('provenancePanel').innerHTML = '<div class="muted">No provenance data yet.</div>'; return; }
  renderBars($('provenancePanel'), rows, 'alt');
}

function renderNetworkPulse(session) {
  const summary = summarizeNetwork(session);
  const transports = summary.byTransport.length ? summary.byTransport.slice(0, 6) : [['No requests',0]];
  const hosts = summary.topHosts.length ? summary.topHosts : [['No hosts',0]];
  $('networkPulse').innerHTML = `<div><h3 class="splitTitle">Transport mix</h3><div id="transportBars"></div></div><div><h3 class="splitTitle">Top hosts</h3><div id="hostBars"></div></div>`;
  renderBars($('transportBars'), transports, 'green');
  renderBars($('hostBars'), hosts, '');
}

function renderRecentEvidence(session) {
  const rows = [...(session?.timeline || [])].filter(row => !['performance','timer'].includes(row.kind)).slice(-9).reverse();
  $('recentEvidence').innerHTML = rows.map(row => `<div class="feedRow"><i class="feedKind ${classifyKind(row.kind)}"></i><span class="feedLabel" title="${escapeHtml(row.label || row.kind)}">${escapeHtml(row.label || row.kind)}</span><span class="feedMeta">#${escapeHtml(row.sequence ?? '')}</span></div>`).join('') || '<div class="muted">No evidence yet.</div>';
}

function renderTimelineHeatmap(session) {
  const buckets = buildTimeBuckets(session, 42);
  const max = Math.max(1, ...buckets.map(b => b.total));
  $('timelineHeatmap').innerHTML = buckets.map(bucket => {
    const h = Math.max(3, (bucket.total / max) * 30);
    const opacity = Math.max(.18, bucket.total / max);
    return `<span class="heatCell" style="height:${h.toFixed(1)}px;opacity:${opacity.toFixed(2)}" title="${bucket.total} events"></span>`;
  }).join('');
}

function renderTimeline(session) {
  const filter = $('timelineFilter').value;
  const rows = [...(session?.timeline || [])].filter(row => !filter || String(row.kind || '').includes(filter)).slice(-350).reverse();
  $('timeline').innerHTML = rows.map(r => `<div class="item"><div class="itemHeader"><span class="itemTitle">${escapeHtml(r.label || r.kind)}</span><span class="badge">#${escapeHtml(r.sequence)} · ${escapeHtml(r.kind)}</span></div><div class="muted">${escapeHtml(r.provenance?.integrity || r.source || 'unknown')} · ${new Date(Number(r.wallTime) || 0).toLocaleTimeString()}</div></div>`).join('') || '<div class="muted">No timeline records yet.</div>';
  renderTimelineHeatmap(session);
}

function renderWaterfall(session) {
  const rows = buildWaterfall(session, 26);
  if (!rows.length) { $('waterfall').innerHTML = '<div class="cardHeader"><div><h2>Request waterfall</h2><p>No paired request/response timing yet.</p></div></div>'; return; }
  const min = Math.min(...rows.map(r => r.start));
  const max = Math.max(...rows.map(r => r.start + r.duration));
  const span = Math.max(1, max - min);
  $('waterfall').innerHTML = `<div class="cardHeader"><div><h2>Request waterfall</h2><p>Recent paired requests, normalized to the visible window</p></div></div><div class="waterfallViewport">${rows.map(row => {
    const left = ((row.start - min) / span) * 100;
    const width = Math.max(.8, (row.duration / span) * 100);
    const state = row.status >= 500 ? 'bad' : row.status >= 400 || row.status === 0 ? 'warn' : 'ok';
    return `<div class="waterfallRow"><span class="waterfallLabel" title="${escapeHtml(row.url)}">${escapeHtml(row.method || row.transport)} ${escapeHtml(compactUrl(row.url))}</span><span class="waterfallTrack"><i class="waterfallBar ${state}" style="left:${left.toFixed(2)}%;width:${Math.min(100-left,width).toFixed(2)}%"></i></span><span class="waterfallMs">${Math.round(row.duration)}ms</span></div>`;
  }).join('')}</div>`;
}

function renderNetworkSummary(session) {
  const summary = summarizeNetwork(session);
  $('networkSummary').innerHTML = `<div class="cardHeader"><div><h2>Network composition</h2><p>${summary.requests} retained requests · ${summary.responses} responses</p></div></div><h3 class="splitTitle">HTTP status</h3><div id="statusBars"></div><h3 class="splitTitle" style="margin-top:12px">Transport</h3><div id="networkTransportBars"></div>`;
  renderBars($('statusBars'), summary.byStatus.length ? summary.byStatus : [['No status',0]], 'green');
  renderBars($('networkTransportBars'), summary.byTransport.length ? summary.byTransport.slice(0,7) : [['No transport',0]], '');
}

function renderNetwork(session) {
  const transport = $('networkFilter').value;
  const classification = $('networkClassFilter').value;
  const rows = [...(session?.network || [])].filter(row => (!transport || row.data?.transport === transport) && (!classification || row.data?.classification === classification)).slice(-260).reverse();
  $('network').innerHTML = rows.map(r => `<button class="recordButton" data-network-index="${session.network.indexOf(r)}"><div class="itemHeader"><span class="itemTitle">${escapeHtml(r.data?.url || r.kind)}</span><span class="badge">${escapeHtml(r.kind)}</span></div><div class="muted">${escapeHtml(r.data?.transport || '')} · ${escapeHtml(r.data?.classification || '')} · #${escapeHtml(r.sequence)}</div></button>`).join('') || '<div class="muted">No network records yet.</div>';
  renderWaterfall(session);
  renderNetworkSummary(session);
}

function renderAntiBotTimeline(session) {
  const signals = session?.antiBot?.signals || [];
  if (!signals.length) { $('antibotTimeline').innerHTML = '<div class="cardHeader"><div><h2>Signal chronology</h2><p>No anti-bot signals retained.</p></div></div>'; return; }
  const min = Math.min(...signals.map(s => Number(s.firstSeen) || 0));
  const max = Math.max(...signals.map(s => Number(s.lastSeen || s.firstSeen) || min));
  const span = Math.max(1, max - min);
  $('antibotTimeline').innerHTML = `<div class="cardHeader"><div><h2>Signal chronology</h2><p>Retained signals positioned within the observed window</p></div></div><div style="position:relative;height:58px;border-top:1px solid var(--line);margin-top:18px">${signals.slice(-80).map((signal,index) => {
    const left = ((Number(signal.firstSeen || min)-min)/span)*100;
    const confidence = Number(signal.confidence || 0);
    const top = 8 + (index % 3) * 13;
    return `<i title="${escapeHtml((signal.categories || []).join(', ') || signal.kind)} · confidence ${confidence.toFixed(2)}" style="position:absolute;left:${Math.min(99,left).toFixed(2)}%;top:${top}px;width:${Math.max(5,confidence*9)}px;height:${Math.max(5,confidence*9)}px;border-radius:50%;background:${confidence >= .8 ? 'var(--red)' : confidence >= .5 ? 'var(--amber)' : 'var(--violet)'}"></i>`;
  }).join('')}</div>`;
}

function renderAntiBot(session) {
  const antiBot = session?.antiBot || {}, stats = antiBot.stats || {}, lifecycle = antiBot.lifecycle || {};
  const sensorState = !antiBot.enabled ? 'OFF' : lifecycle.currentDocumentActive ? 'ACTIVE' : session?.running ? 'WAITING' : 'STOPPED';
  const values = [
    ['Sensor', sensorState, antiBot.enabled ? 'enabled' : 'disabled'],
    ['Signals', stats.totalSeen || 0, `${antiBot.signals?.length || 0} retained`],
    ['Documents', lifecycle.documentsObserved || 0, `${lifecycle.agentStarts || 0} agent starts`],
    ['Deduplicated', stats.deduplicated || 0, 'repeated evidence']
  ];
  $('antibotStats').innerHTML = values.map(v => metricCard(...v)).join('');
  const analysis = currentDiagnostics?.antiBotAnalysis;
  if (!analysis) {
    $('antibotAnalysis').innerHTML = '<div class="muted">No session anti-bot analysis yet.</div>';
  } else {
    const rate = analysis.rateLimit || {};
    const timing = analysis.timing?.overall || {};
    const providers = (analysis.protectionDetails || []).map(item => `${item.name} ×${item.count}`).join(', ') || 'none';
    $('antibotAnalysis').innerHTML = `<div class="item"><div class="itemHeader"><span class="itemTitle">Session analysis</span><span class="badge">sequence ${escapeHtml(analysis.sessionSequence || 0)}</span></div><div class="muted">Protections: ${escapeHtml(providers)}</div><div class="muted">Rate limit: ${escapeHtml(rate.detected ? 'detected' : 'not detected')} · HTTP 429: ${escapeHtml(rate.status429Count || 0)} · response errors: ${escapeHtml(Math.round((rate.errorRate || 0) * 100))}%</div><div class="muted">Response timing: ${escapeHtml(timing.count || 0)} samples · avg ${escapeHtml(Math.round(timing.average || 0))} ms · challenge page: ${escapeHtml(analysis.challengePage ? 'yes' : 'no')}</div></div>`;
  }
  $('antibotSignals').innerHTML = [...(antiBot.signals || [])].slice(-250).reverse().map(signal => `<div class="item"><div class="itemHeader"><span class="itemTitle">${escapeHtml((signal.categories || []).join(', ') || signal.kind)}</span><span class="badge">confidence ${escapeHtml(signal.confidence?.toFixed?.(2) ?? signal.confidence ?? 0)} · ×${escapeHtml(signal.repeatCount || 1)}</span></div><div class="muted">#${escapeHtml(signal.firstSequence ?? '')}→${escapeHtml(signal.lastSequence ?? '')} · ${escapeHtml(signal.kind)}${signal.navigationDeltaMs != null ? ` · nav +${escapeHtml(signal.navigationDeltaMs)}ms` : ''}</div><pre class="snippet">${escapeHtml(JSON.stringify({ evidence: signal.evidence, endpointMatches: signal.endpointMatches, summary: signal.summary }, null, 2))}</pre></div>`).join('') || '<div class="muted">No anti-bot signals yet.</div>';
  renderAntiBotTimeline(session);
}

const graphState = { kind: 'all', host: '', limit: 18, focusNodeId: '' };

function graphKind(kind = '') {
  const value = String(kind).toLowerCase();
  if (value.includes('network') || value.includes('websocket')) return 'network';
  if (value === 'dom-event' || value === 'mutation') return 'dom';
  if (value.includes('navigation') || value.includes('frame')) return 'navigation';
  return 'other';
}

function graphTimeLabel(value, span) {
  const date = new Date(Number(value) || 0);
  if (!Number.isFinite(date.getTime())) return '';
  return span > 86_400_000 ? date.toLocaleDateString() : date.toLocaleTimeString();
}

function graphPosition(node, nodes, width, height, minTime, span) {
  const type = graphKind(node.kind);
  const laneY = { dom: 95, network: 195, navigation: 295, other: 350 }[type] || 350;
  const laneIndex = nodes.filter(item => graphKind(item.kind) === type && item.sequence <= node.sequence).length - 1;
  const offset = ((laneIndex % 5) - 2) * 13;
  const rawTime = Number(node.wallTime);
  const x = 70 + ((Number.isFinite(rawTime) ? rawTime : minTime) - minTime) / span * (width - 130);
  return { x: Math.max(45, Math.min(width - 45, x)), y: laneY + offset };
}

function graphOptions() {
  return { kind: graphState.kind, host: graphState.host, limit: graphState.limit, focusNodeId: graphState.focusNodeId };
}

function renderCorrelationGraph(session) {
  const graph = buildCorrelationGraph({ ...session, correlations: currentDiagnostics.correlations?.length ? currentDiagnostics.correlations : session?.correlations }, graphOptions());
  const filterLabel = [graphState.kind !== 'all' ? graphState.kind : '', graphState.host ? `host:${graphState.host}` : '', graphState.focusNodeId ? 'focus:on' : ''].filter(Boolean).join(' · ') || 'No filters';
  $('graphMeta').textContent = `${graph.edges.length} relations · ${graph.nodes.length} events · ${filterLabel}`;
  if (!graph.nodes.length) { $('correlationGraph').className = 'graphCanvas emptyState'; $('correlationGraph').textContent = graphState.focusNodeId ? 'No relations for focused event.' : 'No candidate relationships yet.'; return; }
  const width = 980, height = 420;
  const times = graph.nodes.map(node => Number(node.wallTime)).filter(Number.isFinite);
  const minTime = times.length ? Math.min(...times) : Date.now();
  const maxTime = times.length ? Math.max(...times) : minTime + 1;
  const span = Math.max(1, maxTime - minTime);
  const positions = new Map(graph.nodes.map(node => [node.id, graphPosition(node, graph.nodes, width, height, minTime, span)]));
  const edges = graph.edges.map(edge => {
    const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return '';
    const cls = edge.status === 'related' ? 'reviewed' : edge.confidence >= .7 ? 'strong' : '';
    return `<line class="graphEdge ${cls}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" marker-end="url(#graphArrow)" data-edge-id="${escapeHtml(edge.id)}" />`;
  }).join('');
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const x = 70 + (index / 4) * (width - 130);
    const value = minTime + (span * index / 4);
    return `<line class="graphTick" x1="${x.toFixed(1)}" y1="365" x2="${x.toFixed(1)}" y2="370" /><text class="graphAxisText" x="${x.toFixed(1)}" y="387" text-anchor="middle">${escapeHtml(graphTimeLabel(value, span))}</text>`;
  }).join('');
  const nodes = graph.nodes.map(node => {
    const p = positions.get(node.id); const type = graphKind(node.kind); const label = String(node.label || node.kind).replace(/^xhr\s+/i,'').slice(0,34);
    let shape = `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="13"></circle>`;
    if (type === 'network') shape = `<rect x="${(p.x-15).toFixed(1)}" y="${(p.y-10).toFixed(1)}" width="30" height="20" rx="5"></rect>`;
    if (type === 'navigation') shape = `<polygon points="${p.x.toFixed(1)},${(p.y-14).toFixed(1)} ${(p.x+15).toFixed(1)},${p.y.toFixed(1)} ${p.x.toFixed(1)},${(p.y+14).toFixed(1)} ${(p.x-15).toFixed(1)},${p.y.toFixed(1)}"></polygon>`;
    const focus = graphState.focusNodeId === node.id ? ' focused' : '';
    return `<g class="graphNode ${type}${focus}" data-node-id="${escapeHtml(node.id)}">${shape}<text x="${p.x.toFixed(1)}" y="${(p.y+30).toFixed(1)}" text-anchor="middle">${escapeHtml(label)}</text><text x="${p.x.toFixed(1)}" y="${(p.y+41).toFixed(1)}" text-anchor="middle" fill="#6f7d90">#${node.sequence}</text></g>`;
  }).join('');
  $('correlationGraph').className = 'graphCanvas';
  $('correlationGraph').innerHTML = `<svg class="graphSvg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Candidate correlation graph"><defs><marker id="graphArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#63758f"></path></marker></defs><line class="graphAxis" x1="70" y1="365" x2="${width-60}" y2="365"></line><text class="graphLaneLabel" x="12" y="99">DOM</text><text class="graphLaneLabel" x="12" y="199">NETWORK</text><text class="graphLaneLabel" x="12" y="299">NAV</text>${ticks}${edges}${nodes}</svg>`;
}

function renderSources(session) {
  $('sources').innerHTML = (session?.sources || []).map((source,index) => {
    const policy = source.fetchPolicy?.decision === 'blocked' ? `blocked: ${source.fetchPolicy.reason || 'policy'}` : source.indexed ? 'indexed' : 'metadata-only';
    const status = source.status == null ? policy : `${source.status} · ${policy}`;
    return `<button class="recordButton" data-source-index="${index}"><div class="itemHeader"><span class="itemTitle">${escapeHtml(source.label || source.url)}</span><span class="badge">${escapeHtml(source.classification || source.type || 'source')}</span></div><div class="muted">${escapeHtml(source.url || '')} · ${escapeHtml(status)}${source.contentHash ? ` · ${escapeHtml(source.contentHash)}` : ''}</div></button>`;
  }).join('') || '<div class="muted">No source evidence yet.</div>';
}

function renderSession(session) {
  $('sessionDump').textContent = JSON.stringify({
    tabId: session?.tabId, running: session?.running, agentActive: session?.agentActive, agentStatusAt: session?.agentStatusAt, startedAt: session?.startedAt, updatedAt: session?.updatedAt, pageUrl: session?.pageUrl,
    requestedMode: session?.requestedMode, effectiveMode: session?.effectiveMode, cdpState: session?.cdpState,
    provenanceModel: { pageAgent: 'page-observable', cdp: 'extension-controlled', navigation: 'browser-controlled' },
    captureSettings: session?.captureSettings,
    antiBot: { enabled: session?.antiBot?.enabled, lifecycle: session?.antiBot?.lifecycle, stats: session?.antiBot?.stats, retained: session?.antiBot?.signals?.length || 0 },
    documents: session?.documents?.length || 0, counters: session?.counters, retention: session?.retention, storageStats: session?.storageStats,
    htmlChars: session?.html?.length || 0, runtimeEntries: session?.runtime?.length || 0, sourceCount: session?.sources?.length || 0,
    networkCount: session?.network?.length || 0, timelineCount: session?.timeline?.length || 0, errors: session?.errors || [],
    tasks: (session?.tasks || []).map(task => ({ taskId: task.taskId, name: task.name, status: task.status, attempt: task.attempt, queuedAt: task.queuedAt, startedAt: task.startedAt, waitMs: task.waitMs, rateKey: task.rateKey, queueDepth: task.queueDepth, error: task.error }))
  }, null, 2);
  $('watchList').innerHTML = Object.entries(session?.watches || {}).map(([path,value]) => `<div class="item"><div class="itemHeader"><span class="itemTitle">${escapeHtml(path)}</span><span class="badge">${value.changed ? 'CHANGED' : 'same'}</span></div><pre class="snippet">${escapeHtml(JSON.stringify({ previous:value.previous, current:value.current }, null, 2))}</pre></div>`).join('') || '<div class="muted">No watched paths.</div>';
  const tasks = session?.tasks || [];
  $('tasks').innerHTML = tasks.slice().reverse().map(task => `<div class="item"><div class="itemHeader"><span class="itemTitle">${escapeHtml(task.name)} · ${escapeHtml(task.status)}</span><span class="badge">attempt ${escapeHtml(task.attempt)}/${escapeHtml(task.maxAttempts)}</span></div><div class="muted">${escapeHtml(task.taskId)}${task.error ? ` · ${escapeHtml(task.error.message)}` : ''}</div><div class="muted">wait ${escapeHtml(task.waitMs || 0)} ms · queue ${escapeHtml(task.queueDepth || 0)}${task.rateKey ? ` · ${escapeHtml(task.rateKey)}` : ''}</div>${['queued','running','retrying'].includes(task.status) ? `<button class="button cancelTaskBtn" data-task-id="${escapeHtml(task.taskId)}">Cancel</button>` : ''}</div>`).join('') || '<div class="muted">No tasks.</div>';
}

function showNetworkDetails(index) { const record = currentSession?.network?.[index]; if (record) $('networkDetails').innerHTML = `<pre class="snippet">${escapeHtml(JSON.stringify(record, null, 2))}</pre>`; }
function showSourceDetails(index) { const source = currentSession?.sources?.[index]; if (source) $('sourceDetails').innerHTML = `<pre class="snippet">${escapeHtml(JSON.stringify({ ...source, text: source.text?.slice(0,12000) }, null, 2))}</pre>`; }

async function renderResearchLab() {
  currentDiagnostics = await call({ type:'BRT_GET_DIAGNOSTICS' });
  renderAntiBot(currentSession);
  $('correlations').innerHTML = (currentDiagnostics.correlations || []).map(item => `<div class="item"><div class="itemHeader"><span class="itemTitle">${escapeHtml(item.fromEvent?.label || 'event')} → ${escapeHtml(item.toEvent?.label || 'event')}</span><span class="badge">confidence ${escapeHtml(item.confidence)} · ${escapeHtml(item.manualStatus || 'unreviewed')}</span></div><div class="muted">${escapeHtml((item.evidence || []).join(' · '))}</div><div class="labelRow"><button class="button" data-label-id="${escapeHtml(item.relationshipId)}" data-label="related">RELATED</button><button class="button" data-label-id="${escapeHtml(item.relationshipId)}" data-label="not-related">NOT RELATED</button></div></div>`).join('') || '<div class="muted">No candidate relationships yet.</div>';
  $('diagnostics').innerHTML = (currentDiagnostics.diagnostics || []).map(item => `<div class="item"><div class="itemHeader"><span class="itemTitle">${escapeHtml(item.kind)}</span><span class="badge">${escapeHtml(item.at)}</span></div><pre class="snippet">${escapeHtml(JSON.stringify(item,null,2))}</pre></div>`).join('') || '<div class="muted">No diagnostics.</div>';
  $('apiExplorer').innerHTML = (currentDiagnostics.api || []).map(item => `<div class="item"><div class="itemHeader"><span class="itemTitle">${escapeHtml(item.key)}</span><span class="badge">${escapeHtml(item.count)} calls</span></div><div class="muted">${escapeHtml(item.firstParty === true ? 'first-party' : item.firstParty === false ? 'third-party' : 'unknown')} · GraphQL: ${escapeHtml(item.graphqlOperations?.join(', ') || 'none')}</div></div>`).join('') || '<div class="muted">No API families yet.</div>';
  renderCorrelationGraph(currentSession);
}

function renderOverview(session) {
  renderStats(session); renderActivityChart(session); renderHealth(session); renderProvenance(session); renderNetworkPulse(session); renderRecentEvidence(session);
}

async function refresh() {
  const [tabRes, sessionRes] = await Promise.all([call({ type:'BRT_GET_ACTIVE_TAB' }), call({ type:'BRT_GET_SESSION' })]);
  const tab = tabRes?.tab; currentSession = sessionRes?.session || null;
  $('pageInfo').textContent = currentSession?.pageUrl ? `Captured: ${compactUrl(currentSession.pageUrl)}` : tab ? `Active: ${tab.title || '(untitled)'} · ${compactUrl(tab.url || '')}` : 'No active page';
  setStatus(Boolean(currentSession?.running), currentSession);
  $('sessionClock').textContent = compactDuration(sessionDurationMs(currentSession));
  renderOverview(currentSession); renderTimeline(currentSession); renderNetwork(currentSession); renderAntiBot(currentSession); renderSources(currentSession); renderSession(currentSession);
  await renderResearchLab().catch(() => {});
}

async function doSearch() {
  const query = $('searchInput').value.trim(); if (!query) return;
  const scopes = { html:$('scopeHtml').checked, javascript:$('scopeJs').checked, network:$('scopeNetwork').checked, runtime:$('scopeRuntime').checked, timeline:$('scopeTimeline').checked, diagnostics:$('scopeDiagnostics').checked, regex:$('searchRegex').checked, caseSensitive:$('searchCase').checked };
  const res = await call({ type:'BRT_SEARCH', query, scopes }); const results = res?.results || [];
  $('searchMeta').textContent = `${results.length} matches (capped)`;
  $('searchResults').innerHTML = results.map(r => `<div class="item"><div class="itemHeader"><span class="itemTitle">${escapeHtml(r.label)}</span><span class="badge">${escapeHtml(r.scope)}</span></div>${r.url ? `<div class="muted">${escapeHtml(r.url)}</div>` : ''}<pre class="snippet">${escapeHtml(r.snippet)}</pre></div>`).join('') || '<div class="muted">No matches.</div>';
}

function exportCurrent() {
  if (!currentSession) return;
  const blob = new Blob([JSON.stringify(currentSession,null,2)], { type:'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `brt-session-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}

function openTab(name) {
  const tab = document.querySelector(`.tab[data-tab="${name}"]`); if (!tab) return;
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active')); document.querySelectorAll('.tabPane').forEach(x => x.classList.remove('active'));
  tab.classList.add('active'); $(`tab-${name}`).classList.add('active');
}

$('startBtn').addEventListener('click', async () => { await call({ type:'BRT_START', mode:$('captureMode').value, antibot:$('antiBotToggle').checked, preserveSession:true }); await refresh(); });
$('stopBtn').addEventListener('click', async () => { await call({ type:'BRT_STOP' }); await refresh(); });
$('clearBtn').addEventListener('click', async () => { await call({ type:'BRT_CLEAR' }); await refresh(); });
$('refreshBtn').addEventListener('click', async () => { await call({ type:'BRT_REFRESH_SOURCES' }); setTimeout(refresh,500); });
$('exportBtn').addEventListener('click', exportCurrent);
$('markBtn').addEventListener('click', async () => { const text=$('markerText').value.trim(); if(text){ await call({ type:'BRT_MARK', text }); $('markerText').value=''; await refresh(); } });
$('watchBtn').addEventListener('click', async () => { const path=$('watchPath').value.trim(); if(path){ await call({ type:'BRT_WATCH_ADD', path }); $('watchPath').value=''; await refresh(); } });
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async event => { const file=event.target.files?.[0]; if(!file)return; try { const imported=JSON.parse(await file.text()); await call({ type:'BRT_IMPORT_SESSION', session:imported.session || imported }); await refresh(); } catch(error){ $('pageInfo').textContent=`Import failed: ${error.message}`; } event.target.value=''; });
$('searchBtn').addEventListener('click', doSearch); $('searchInput').addEventListener('keydown', e => { if(e.key==='Enter') doSearch(); });
$('timelineFilter').addEventListener('change', () => renderTimeline(currentSession)); $('networkFilter').addEventListener('change', () => renderNetwork(currentSession)); $('networkClassFilter').addEventListener('change', () => renderNetwork(currentSession));
$('graphKindFilter').addEventListener('change', () => {
  graphState.kind = $('graphKindFilter').value || 'all';
  graphState.focusNodeId = '';
  renderCorrelationGraph(currentSession);
});
$('graphLimit').addEventListener('change', () => {
  graphState.limit = Number($('graphLimit').value) || 18;
  renderCorrelationGraph(currentSession);
});
$('graphHostFilter').addEventListener('input', () => {
  graphState.host = $('graphHostFilter').value.trim();
  graphState.focusNodeId = '';
  renderCorrelationGraph(currentSession);
});
$('graphResetBtn').addEventListener('click', () => {
  graphState.kind = 'all'; graphState.host = ''; graphState.limit = 18; graphState.focusNodeId = '';
  $('graphKindFilter').value = 'all'; $('graphHostFilter').value = ''; $('graphLimit').value = '18';
  $('graphInspector').className = 'details muted';
  $('graphInspector').textContent = 'Click a node to focus its connected relationships, or click an edge to inspect its evidence.';
  renderCorrelationGraph(currentSession);
});
$('network').addEventListener('click', event => { const button=event.target.closest('[data-network-index]'); if(button) showNetworkDetails(Number(button.dataset.networkIndex)); });
$('sources').addEventListener('click', event => { const button=event.target.closest('[data-source-index]'); if(button) showSourceDetails(Number(button.dataset.sourceIndex)); });
$('correlations').addEventListener('click', async event => { const button=event.target.closest('[data-label-id]'); if(!button)return; await call({ type:'BRT_LABEL_CORRELATION', relationshipId:button.dataset.labelId, status:button.dataset.label }); await renderResearchLab(); });
$('tasks').addEventListener('click', async event => { const button = event.target.closest('.cancelTaskBtn'); if (!button) return; await call({ type: 'BRT_CANCEL_TASK', taskId: button.dataset.taskId }); await refresh(); });
$('correlationGraph').addEventListener('click', event => {
  const nodeEl=event.target.closest('[data-node-id]'); const edgeEl=event.target.closest('[data-edge-id]');
  if(nodeEl){
    const id = nodeEl.dataset.nodeId;
    graphState.focusNodeId = graphState.focusNodeId === id ? '' : id;
    const graph = buildCorrelationGraph({ ...(currentSession || {}), correlations:currentDiagnostics.correlations || [] }, graphOptions());
    const node = graph.nodes.find(item => item.id === id);
    const connectedEdges = graph.edges.filter(edge => edge.from === id || edge.to === id);
    renderCorrelationGraph(currentSession);
    $('graphInspector').className = 'details';
    $('graphInspector').innerHTML = `<div class="muted">${graphState.focusNodeId ? 'Focus enabled — click the node again to clear it.' : 'Focus cleared.'}</div><pre class="snippet">${escapeHtml(JSON.stringify({ node, connectedEdges }, null, 2))}</pre>`;
  } else if(edgeEl){
    const rel=(currentDiagnostics.correlations || []).find(r=>r.relationshipId===edgeEl.dataset.edgeId);
    $('graphInspector').className = 'details';
    $('graphInspector').innerHTML=`<pre class="snippet">${escapeHtml(JSON.stringify(rel,null,2))}</pre>`;
  }
});
for(const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => openTab(tab.dataset.tab));
for(const button of document.querySelectorAll('[data-open-tab]')) button.addEventListener('click', () => openTab(button.dataset.openTab));
for(const tab of document.querySelectorAll('.subTab')) tab.addEventListener('click', () => { document.querySelectorAll('.subTab').forEach(x=>x.classList.remove('active')); document.querySelectorAll('.labPane').forEach(x=>x.classList.remove('active')); tab.classList.add('active'); $(`lab-${tab.dataset.lab}`).classList.add('active'); });

chrome.runtime.onMessage.addListener(message => { if(message?.type==='BRT_SESSION_UPDATED' || message?.type==='BRT_TASK_UPDATED') refresh().catch(()=>{}); });
refresh().catch(err => { $('pageInfo').textContent = err.message; });
setInterval(() => { $('sessionClock').textContent = compactDuration(sessionDurationMs(currentSession)); },1000);
setInterval(() => refresh().catch(()=>{}),1800);
