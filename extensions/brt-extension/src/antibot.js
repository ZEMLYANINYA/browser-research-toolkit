export const ANTIBOT_RULES = Object.freeze([
  { id: 'captcha', pattern: /\b(?:captcha|recaptcha|hcaptcha|turnstile|image-challenge|audio-challenge)\b/i, weight: 0.95, strong: true },
  { id: 'challenge', pattern: /\b(?:challenge(?:-platform)?|cf-chl|managed-challenge|js-challenge|browser-challenge)\b/i, weight: 0.90, strong: true },
  { id: 'fingerprint-signal', pattern: /\b(?:fingerprint(?:ing)?|canvas(?:fingerprint|readback|todataurl)|webgl(?:renderer|vendor|fingerprint)|audio(?:context|fingerprint)|font(?:fingerprint|enumeration)|client(?:hints|hint)|device(?:memory|concurrency))\b/i, weight: 0.78, strong: true },
  { id: 'rate-limit', pattern: /\b(?:rate[\s_-]?limit|too many requests|http\s*429|status\s*429|retry-after|throttled|overload)\b/i, weight: 0.85, strong: true },
  { id: 'bot-signal', pattern: /\b(?:headless|webdriver|phantom|selenium|puppeteer|playwright|bot(?:[-_ ]?(?:detect|check|signal|detection))|automation[-_ ]?(?:detect|check|flag|signal|test)|navigator\.webdriver)\b/i, weight: 0.72, strong: true },
  { id: 'verification', pattern: /\b(?:verify|verification|validate|nonce|signature|token|challenge-response|captcha-solved)\b/i, weight: 0.42, strong: false },
  { id: 'analytics', pattern: /\b(?:analytics|telemetry|pixel|gtag|beacon|doubleclick|pagead|google-analytics|facebook-pixel|hotjar|clarity)\b/i, weight: 0.20, strong: false },
  { id: 'cloudflare', pattern: /\b(?:cloudflare|cf[\s_-]?(?:turnstile|challenge|browser|ray|cookie))\b/i, weight: 0.88, strong: true },
  { id: 'akamai', pattern: /\b(?:akamai|akamaized|akamai(?:cdn|bot|manager)|x-akamai-transformed)\b/i, weight: 0.85, strong: true },
  { id: 'perimeterx', pattern: /\b(?:perimeterx|px[\s_-]?(?:challenge|token|cookie)|px[0-9]+)\b/i, weight: 0.85, strong: true },
  { id: 'datadome', pattern: /\b(?:datadome|dd[\s_-]?(?:challenge|cookie|token)|datadome-captcha)\b/i, weight: 0.83, strong: true }
]);

// Endpoint rules are intentionally narrow. They encode concrete observable
// protocol paths seen in real browser sessions, not assumptions about whether
// the site will actually block a user. These are observability signals only.
export const ANTIBOT_ENDPOINT_RULES = Object.freeze([
  {
    id: 'cloudflare-challenge-platform',
    pattern: /\/cdn-cgi\/challenge-platform\//i,
    categories: ['challenge', 'cloudflare'],
    weight: 0.98,
    strong: true
  },
  {
    id: 'recaptcha-userverify',
    pattern: /\/recaptcha\/api2\/userverify(?:\?|$)/i,
    categories: ['captcha', 'verification'],
    weight: 0.99,
    strong: true
  },
  {
    id: 'recaptcha-reload',
    pattern: /\/recaptcha\/api2\/reload(?:\?|$)/i,
    categories: ['captcha'],
    weight: 0.98,
    strong: true
  },
  {
    id: 'recaptcha-bootstrap',
    pattern: /\/recaptcha\/(?:api(?:\.js)?|api2\/(?:anchor|bframe))(?:\?|$)/i,
    categories: ['captcha'],
    weight: 0.96,
    strong: true
  },
  {
    id: 'cloudflare-turnstile',
    pattern: /(?:challenges\.cloudflare\.com\/turnstile|\/turnstile\/v0\/|\/turnstile\.js)/i,
    categories: ['captcha', 'challenge', 'cloudflare'],
    weight: 0.98,
    strong: true
  },
  {
    id: 'hcaptcha-api',
    pattern: /(?:hcaptcha\.com\/(?:1\/api\.js|checksiteconfig|getcaptcha|checkcaptcha)|\/hcaptcha\/)/i,
    categories: ['captcha'],
    weight: 0.97,
    strong: true
  },
  {
    id: 'akamai-bot-manager',
    pattern: /\/akamai\/botmanager\//i,
    categories: ['challenge', 'akamai'],
    weight: 0.92,
    strong: true
  },
  {
    id: 'perimeterx-challenge',
    pattern: /\/perimeterx\/api\/v1\/challenge\//i,
    categories: ['challenge', 'perimeterx'],
    weight: 0.93,
    strong: true
  },
  {
    id: 'datadome-captcha',
    pattern: /\/datadome\/captcha\//i,
    categories: ['captcha', 'datadome'],
    weight: 0.91,
    strong: true
  },
  {
    id: 'f5-tspd',
    pattern: /\/TSPD\/(?:\?|$)/i,
    categories: ['challenge', 'f5'],
    weight: 0.93,
    strong: true
  }
]);

const TELEMETRY_ENDPOINT_RULES = Object.freeze([
  { id: 'cloudflare-rum', pattern: /\/cdn-cgi\/rum(?:\?|$)/i },
  { id: 'google-analytics-collect', pattern: /(?:google-analytics\.com|analytics\.google\.com)\/g\/collect(?:\?|$)/i },
  { id: 'google-analytics-script', pattern: /\/gtag\/js\?/i },
  { id: 'facebook-pixel', pattern: /\/facebook\.com\/tr\?/i },
  { id: 'linkedin-analytics', pattern: /px\.ads\.linkedin\.com\/wa\/(?:\?|$)/i },
  { id: 'hotjar', pattern: /\/hotjar\.com\/\d+\.js/i },
  { id: 'clarity', pattern: /\/clarity\.ms\/tag\//i }
]);

const MAX_SIGNAL_TEXT = 6000;
const MAX_SIGNALS = 500;
const MAX_LIFECYCLE_DOCUMENT_IDS = 500;
const DEDUP_WINDOW_MS = 5000;

function boundedScalar(value, max = 1000) {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, max);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}

function normalizedHeaders(headers) {
  const result = {};
  if (!headers) return result;
  try {
    if (typeof headers.forEach === 'function') {
      headers.forEach((value, key) => { result[String(key).toLowerCase()] = boundedScalar(value, 500); });
      return result;
    }
    for (const [key, value] of Object.entries(headers)) {
      result[String(key).toLowerCase()] = boundedScalar(value, 500);
    }
  } catch {}
  return result;
}

function cookieText(cookies) {
  if (typeof cookies === 'string') return cookies.slice(0, 4000).toLowerCase();
  if (!Array.isArray(cookies)) return '';
  return cookies.slice(0, 200).map(cookie => {
    if (typeof cookie === 'string') return cookie;
    return `${cookie?.name || ''}=${cookie?.value || ''}`;
  }).join('; ').slice(0, 4000).toLowerCase();
}

export function detectProtectionsFromHeaders(headers) {
  const h = normalizedHeaders(headers);
  const protections = new Set();
  const add = (name) => protections.add(name);
  if (h['cf-ray'] || h['cf-cache-status'] || h['cf-worker'] || /cloudflare/i.test(h.server || '')) add('Cloudflare');
  if (h['x-akamai-transformed'] || h['x-akamai-request-id'] || h['akamai-origin-hop'] || /akamai/i.test(h.server || '')) add('Akamai');
  if (h['perimeterx-request-id'] || h['x-px']) add('PerimeterX');
  if (h['x-datadome'] || h.datadome) add('DataDome');
  if (h['x-incap-ses'] || h['x-iinfo'] || h['x-incapsula-id'] || /(?:incapsula|imperva)/i.test(h['x-cdn'] || '')) add('Incapsula');
  return [...protections];
}

export function detectProtectionsFromCookies(cookies) {
  const text = cookieText(cookies);
  if (!text) return [];
  const protections = new Set();
  if (/(?:^|[;\s])(?:__cf_bm|cf_clearance|__cfduid)=/i.test(text)) protections.add('Cloudflare');
  if (/(?:^|[;\s])(?:ak_bmsc|bm_sz|_abck)=/i.test(text)) protections.add('Akamai');
  if (/(?:^|[;\s])(?:_px|_px2|_px3|px[0-9]+)=/i.test(text)) protections.add('PerimeterX');
  if (/(?:^|[;\s])datadome=/i.test(text)) protections.add('DataDome');
  if (/(?:^|[;\s])(?:incap_ses|visid_incap)=/i.test(text)) protections.add('Incapsula');
  if (/(?:^|[;\s])(?:tspd_[^=;\s]*|ts[0-9a-f]{8,}|bigipserver[^=;\s]*)=/i.test(text)) {
    protections.add('F5 BIG-IP / Advanced WAF');
  }
  return [...protections];
}

function collectEvidenceText(record) {
  const data = record?.data || {};
  const requestHeaders = normalizedHeaders(data.requestHeaders || data.headers);
  const responseHeaders = normalizedHeaders(data.responseHeaders);
  const parts = [
    boundedScalar(record?.kind, 100),
    boundedScalar(data.url, 2000),
    boundedScalar(data.contentType, 300),
    boundedScalar(data.state, 100),
    boundedScalar(data.reason, 500),
    boundedScalar(data.text, 1600),
    boundedScalar(data.message, 800),
    boundedScalar(data.callbackHint, 800),
    boundedScalar(data.target?.selectorHint, 500),
    boundedScalar(data.attribute, 200),
    boundedScalar(data.status, 50),
    Object.keys(requestHeaders).slice(0, 20).join(' '),
    Object.keys(responseHeaders).slice(0, 20).join(' '),
    boundedScalar(responseHeaders['cf-ray'], 100),
    boundedScalar(responseHeaders['x-akamai-transformed'], 100),
    boundedScalar(responseHeaders['x-datadome'], 100),
    boundedScalar(responseHeaders['perimeterx-request-id'], 100),
    Array.isArray(data.signals) ? data.signals.slice(0, 30).map(item => boundedScalar(item, 100)).join(' ') : '',
    Array.isArray(data.callbackKeywords) ? data.callbackKeywords.slice(0, 20).map(item => boundedScalar(item, 100)).join(' ') : ''
  ];
  return parts.filter(Boolean).join(' ').slice(0, MAX_SIGNAL_TEXT);
}

function endpointEvidence(record) {
  const url = boundedScalar(record?.data?.url, 3000);
  const positives = url ? ANTIBOT_ENDPOINT_RULES.filter(rule => rule.pattern.test(url)) : [];
  const telemetry = url ? TELEMETRY_ENDPOINT_RULES.filter(rule => rule.pattern.test(url)) : [];
  return { url, positives, telemetry };
}

export function classifyAntiBotRecord(record) {
  const data = record?.data || {};
  const text = collectEvidenceText(record);
  const textRules = ANTIBOT_RULES.filter(rule => rule.pattern.test(text));
  const endpoints = endpointEvidence(record);
  const headerProtections = detectProtectionsFromHeaders(data.responseHeaders || data.headers);
  const cookieProtections = detectProtectionsFromCookies(data.cookies || data.setCookie);

  const categorySet = new Set(textRules.map(rule => rule.id));
  for (const endpoint of endpoints.positives) for (const category of endpoint.categories) categorySet.add(category);
  for (const protection of [...headerProtections, ...cookieProtections]) {
    categorySet.add(
      protection === 'F5 BIG-IP / Advanced WAF'
        ? 'f5'
        : protection.toLowerCase()
    );
  }
  if (Number(data.status) === 429) categorySet.add('rate-limit');
  const categories = [...categorySet];

  const rulesById = new Map(ANTIBOT_RULES.map(rule => [rule.id, rule]));
  const categoryRules = categories.map(id => rulesById.get(id)).filter(Boolean);
  const strongText = categoryRules.filter(rule => rule.strong && rule.id !== 'analytics');
  const strongEndpoint = endpoints.positives.some(rule => rule.strong);
  const nonAnalytics = categoryRules.filter(rule => rule.id !== 'analytics');
  const weakCorroborated = !strongEndpoint && strongText.length === 0 && nonAnalytics.length >= 2;

  // Known telemetry endpoints are explicit negative evidence. They remain
  // visible as analytics metadata but must not become anti-bot merely because
  // surrounding page text happens to mention Cloudflare or another vendor.
  const telemetryOnly = endpoints.telemetry.length > 0 && endpoints.positives.length === 0 && strongText.length === 0 && Number(data.status) !== 429;
  const isAntiBotSignal = !telemetryOnly && (strongEndpoint || strongText.length > 0 || weakCorroborated || Number(data.status) === 429);

  const textWeight = categoryRules.reduce((max, rule) => Math.max(max, rule.weight), Number(data.status) === 429 ? 0.85 : 0);
  const endpointWeight = endpoints.positives.reduce((max, rule) => Math.max(max, rule.weight), 0);
  const ruleWeight = Math.max(textWeight, endpointWeight);
  const corroborationCount = new Set([
    ...nonAnalytics.map(rule => `category:${rule.id}`),
    ...endpoints.positives.map(rule => `endpoint:${rule.id}`)
  ]).size;
  const corroborationBonus = Math.min(0.10, Math.max(0, corroborationCount - 1) * 0.03);
  const confidence = isAntiBotSignal ? Math.min(0.99, ruleWeight + corroborationBonus) : 0;

  return {
    categories,
    confidence,
    ruleWeight,
    heuristic: true,
    isAntiBotSignal,
    endpointMatches: endpoints.positives.map(rule => rule.id),
    telemetryMatches: endpoints.telemetry.map(rule => rule.id),
    evidence: [
      ...textRules.map(rule => `matched:${rule.id}`),
      ...endpoints.positives.map(rule => `endpoint:${rule.id}`),
      ...endpoints.telemetry.map(rule => `telemetry:${rule.id}`),
      ...[...new Set([...headerProtections, ...cookieProtections])].map(name => `provider:${name}`),
      ...(Number(data.status) === 429 ? ['status:429'] : [])
    ]
  };
}

export function analyzeRateLimiting(records, options = {}) {
  const rows = Array.isArray(records) ? records.slice(-(Number(options.maxRecords) || 5000)) : [];
  const responses = rows.filter(item => item?.kind === 'network-response');
  const statusCounts = {};
  const responseTimes = [];
  const byEndpoint = {};
  const status429Urls = [];
  let status429Count = 0;
  let detected = false;

  for (const response of responses) {
    const data = response.data || {};
    const status = Number(data.status);
    if (Number.isFinite(status) && status > 0) {
      const key = String(status);
      statusCounts[key] = (statusCounts[key] || 0) + 1;
      if (status === 429) {
        detected = true;
        status429Count += 1;
        const url = normalizeSignalUrl(data.url);
        if (url && status429Urls.length < 100 && !status429Urls.includes(url)) status429Urls.push(url);
      }
    }
    const headers = normalizedHeaders(data.responseHeaders || data.headers);
    if (headers['retry-after']) detected = true;
    const duration = Number(data.duration);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    responseTimes.push(duration);
    let endpoint = String(data.endpointFamily || normalizeSignalUrl(data.url) || 'unknown').slice(0, 300);
    if (!Object.prototype.hasOwnProperty.call(byEndpoint, endpoint)) {
      if (Object.keys(byEndpoint).length >= 200) endpoint = '__other__';
      if (!Object.prototype.hasOwnProperty.call(byEndpoint, endpoint)) byEndpoint[endpoint] = { count: 0, totalTime: 0, min: null, max: null, statusCounts: {} };
    }
    const bucket = byEndpoint[endpoint];
    bucket.count += 1;
    bucket.totalTime += duration;
    bucket.min = bucket.min == null ? duration : Math.min(bucket.min, duration);
    bucket.max = bucket.max == null ? duration : Math.max(bucket.max, duration);
    if (Number.isFinite(status) && status > 0) {
      const key = String(status);
      bucket.statusCounts[key] = (bucket.statusCounts[key] || 0) + 1;
    }
  }

  for (const bucket of Object.values(byEndpoint)) bucket.average = bucket.count ? bucket.totalTime / bucket.count : null;
  const totalResponses = responses.length;
  const successful = responses.filter(item => { const status = Number(item.data?.status); return status >= 200 && status < 300; }).length;
  const errors = responses.filter(item => Number(item.data?.status) >= 400).length;
  const finiteTimes = responseTimes.filter(Number.isFinite);
  return {
    detected,
    rateLimited: detected,
    status429Count,
    status429Urls,
    statusCounts,
    totalResponses,
    successRate: totalResponses ? successful / totalResponses : 0,
    errorRate: totalResponses ? errors / totalResponses : 0,
    responseTimeStats: {
      min: finiteTimes.length ? Math.min(...finiteTimes) : null,
      max: finiteTimes.length ? Math.max(...finiteTimes) : null,
      total: finiteTimes.reduce((sum, value) => sum + value, 0),
      count: finiteTimes.length,
      average: finiteTimes.length ? finiteTimes.reduce((sum, value) => sum + value, 0) / finiteTimes.length : null
    },
    avgResponseTime: finiteTimes.length ? finiteTimes.reduce((sum, value) => sum + value, 0) / finiteTimes.length : 0,
    responseTimes: finiteTimes.slice(0, 1000),
    byEndpoint
  };
}

export function analyzeBehaviorPatterns(records, options = {}) {
  const rows = Array.isArray(records) ? records : [];
  const events = rows.filter(item => item?.kind === 'dom-event' && Number.isFinite(Number(item.wallTime)))
    .slice(-(Number(options.maxEvents) || 2000));
  const timestamps = events.map(item => Number(item.wallTime)).sort((a, b) => a - b);
  const intervals = timestamps.slice(1).map((at, index) => Math.max(0, at - timestamps[index]));
  const actionDistribution = { click: 0, submit: 0, keydown: 0, input: 0, change: 0 };
  const eventTypes = {};
  for (const event of events) {
    const type = String(event.data?.type || 'unknown').slice(0, 80);
    eventTypes[type] = (eventTypes[type] || 0) + 1;
    if (Object.prototype.hasOwnProperty.call(actionDistribution, type)) actionDistribution[type] += 1;
  }
  const totalGap = intervals.reduce((sum, value) => sum + value, 0);
  return {
    totalDomEvents: events.length,
    eventTypes,
    actionDistribution,
    avgTimeBetweenEvents: intervals.length ? totalGap / intervals.length : null,
    minInterval: intervals.length ? Math.min(...intervals) : null,
    maxInterval: intervals.length ? Math.max(...intervals) : null,
    burstCount: intervals.filter(value => value < 100).length,
    duration: timestamps.length > 1 ? timestamps.at(-1) - timestamps[0] : 0
  };
}

export function detectChallengePage(text) {
  const value = boundedScalar(text, MAX_SIGNAL_TEXT);

  const genericChallenge =
    /cloudflare|checking your browser|captcha|challenge|verify you are human|access denied|security check|please wait/i.test(value);

  const f5Rejected =
    /the requested url was rejected/i.test(value) &&
    /your support id is/i.test(value);

  return genericChallenge || f5Rejected;
}

function freshLifecycle() {
  return {
    agentStarts: 0,
    agentStops: 0,
    documentsObserved: 0,
    documentIds: [],
    currentDocumentId: null,
    currentDocumentActive: false,
    pendingDocumentId: null,
    lastAgentStartAt: null,
    lastAgentStopAt: null,
    lastNavigationAt: null
  };
}

export function createAntiBotState(enabled = false) {
  return {
    enabled: Boolean(enabled),
    signals: [],
    lifecycle: freshLifecycle(),
    stats: {
      totalSeen: 0,
      retained: 0,
      deduplicated: 0,
      byCategory: {},
      byProtection: {},
      firstSeen: null,
      lastSeen: null,
      sequenceGap: { count: 0, min: null, max: null, total: 0, average: null },
      intervalMs: { count: 0, min: null, max: null, total: 0, average: null },
      requestResponseMs: { count: 0, min: null, max: null, total: 0, average: null },
      navigationProximity: { within1000ms: 0, within3000ms: 0, samples: 0 },
      lastSignalSequence: null,
      lastSignalAt: null,
      protectionsDetected: {},
      totalRateLimits: 0
    }
  };
}

export function ensureAntiBotState(antiBot, enabled = true) {
  if (!antiBot || typeof antiBot !== 'object') return createAntiBotState(enabled);
  antiBot.enabled = Boolean(enabled);
  antiBot.signals = Array.isArray(antiBot.signals) ? antiBot.signals : [];
  const defaults = createAntiBotState(enabled).stats;
  antiBot.stats = antiBot.stats && typeof antiBot.stats === 'object' ? { ...defaults, ...antiBot.stats } : defaults;
  antiBot.stats.byCategory = antiBot.stats.byCategory && typeof antiBot.stats.byCategory === 'object' ? antiBot.stats.byCategory : {};
  antiBot.stats.byProtection = antiBot.stats.byProtection && typeof antiBot.stats.byProtection === 'object' ? antiBot.stats.byProtection : {};
  antiBot.stats.protectionsDetected = antiBot.stats.protectionsDetected && typeof antiBot.stats.protectionsDetected === 'object' ? antiBot.stats.protectionsDetected : {};
  antiBot.stats.sequenceGap = { ...defaults.sequenceGap, ...(antiBot.stats.sequenceGap || {}) };
  antiBot.stats.intervalMs = { ...defaults.intervalMs, ...(antiBot.stats.intervalMs || {}) };
  antiBot.stats.requestResponseMs = { ...defaults.requestResponseMs, ...(antiBot.stats.requestResponseMs || {}) };
  antiBot.stats.navigationProximity = { ...defaults.navigationProximity, ...(antiBot.stats.navigationProximity || {}) };
  antiBot.lifecycle = antiBot.lifecycle && typeof antiBot.lifecycle === 'object'
    ? { ...freshLifecycle(), ...antiBot.lifecycle }
    : freshLifecycle();
  antiBot.lifecycle.documentIds = Array.isArray(antiBot.lifecycle.documentIds) ? antiBot.lifecycle.documentIds.slice(-MAX_LIFECYCLE_DOCUMENT_IDS) : [];
  antiBot.lifecycle.documentsObserved = antiBot.lifecycle.documentIds.length;
  return antiBot;
}

export function recordAntiBotAgentStatus(antiBot, record) {
  if (!antiBot) return;
  ensureAntiBotState(antiBot, antiBot.enabled !== false);
  const lifecycle = antiBot.lifecycle;
  const active = Boolean(record?.data?.active);
  const documentId = record?.documentId && record.documentId !== 'unknown' ? String(record.documentId) : null;
  const at = Number(record?.wallTime) || Date.now();

  if (active) {
    lifecycle.agentStarts += 1;
    lifecycle.currentDocumentActive = true;
    lifecycle.currentDocumentId = documentId || lifecycle.currentDocumentId;
    lifecycle.pendingDocumentId = null;
    lifecycle.lastAgentStartAt = at;
    if (documentId && !lifecycle.documentIds.includes(documentId)) {
      lifecycle.documentIds.push(documentId);
      if (lifecycle.documentIds.length > MAX_LIFECYCLE_DOCUMENT_IDS) lifecycle.documentIds.splice(0, lifecycle.documentIds.length - MAX_LIFECYCLE_DOCUMENT_IDS);
      lifecycle.documentsObserved = lifecycle.documentIds.length;
    }
  } else {
    lifecycle.agentStops += 1;
    lifecycle.currentDocumentActive = false;
    lifecycle.lastAgentStopAt = at;
  }
}

export function recordAntiBotNavigation(antiBot, record) {
  if (!antiBot) return;
  ensureAntiBotState(antiBot, antiBot.enabled !== false);
  const lifecycle = antiBot.lifecycle;
  const documentId = record?.documentId && record.documentId !== 'unknown' ? String(record.documentId) : null;
  lifecycle.lastNavigationAt = Number(record?.wallTime) || Date.now();

  // A hard navigation destroys the old MAIN world. Chrome normally reports the
  // commit before document_start, but keep this race-safe: if the new agent has
  // already announced itself for the same Chrome documentId, do not flip the
  // sensor back to WAITING merely because onCommitted arrived late.
  if (record?.kind === 'hard-navigation') {
    const alreadyActiveOnCommittedDocument = Boolean(documentId && lifecycle.currentDocumentActive && lifecycle.currentDocumentId === documentId);
    lifecycle.pendingDocumentId = alreadyActiveOnCommittedDocument ? null : documentId;
    if (!alreadyActiveOnCommittedDocument) lifecycle.currentDocumentActive = false;
  }
}

export function navigationDeltaMsFor(timeline, wallTime) {
  const at = Number(wallTime);
  if (!Number.isFinite(at)) return NaN;
  const rows = Array.isArray(timeline) ? timeline : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const item = rows[index];
    if (!item || !['navigation', 'hard-navigation'].includes(item.kind)) continue;
    const navAt = Number(item.wallTime);
    if (Number.isFinite(navAt) && navAt <= at) return Math.max(0, at - navAt);
  }
  return NaN;
}

function updateRange(bucket, value) {
  if (!Number.isFinite(value) || value < 0) return;
  bucket.count = (bucket.count || 0) + 1;
  bucket.total = (bucket.total || 0) + value;
  bucket.min = bucket.min == null ? value : Math.min(bucket.min, value);
  bucket.max = bucket.max == null ? value : Math.max(bucket.max, value);
  bucket.average = bucket.count ? bucket.total / bucket.count : null;
}

function normalizeSignalUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    return `${url.hostname}${url.pathname}`;
  } catch {
    return String(raw || '').slice(0, 500);
  }
}

function fingerprintFor(record, classification) {
  const categories = [...classification.categories].filter(category => category !== 'analytics').sort().join(',');
  const endpointMatches = [...(classification.endpointMatches || [])].sort().join(',');
  const data = record?.data || {};
  const detail = Array.isArray(data.signals) ? data.signals.slice().sort().join(',') : '';
  return `${record?.kind || ''}|${categories}|${endpointMatches}|${normalizeSignalUrl(data.url)}|${boundedScalar(data.state, 100)}|${detail}`;
}

function signalSummary(record) {
  const data = record?.data || {};
  return {
    url: data.url || null,
    transport: data.transport || null,
    method: data.method || null,
    status: data.status ?? null,
    state: data.state || null,
    direction: data.direction || null,
    signals: Array.isArray(data.signals) ? data.signals.slice(0, 20) : [],
    selectorHint: data.target?.selectorHint || data.selectorHint || null,
    delay: Number.isFinite(Number(data.delay)) ? Number(data.delay) : null,
    duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null
  };
}

function estimateSignalBytes(value) {
  if (value == null) return 0;
  try { return new TextEncoder().encode(JSON.stringify(value) || '').byteLength; }
  catch { return String(value ?? '').length; }
}

export function recordAntiBotSignal(antiBot, record, classification, context = {}) {
  if (!antiBot || !classification?.isAntiBotSignal) return null;
  ensureAntiBotState(antiBot, true);
  const stats = antiBot.stats;
  const now = Number(record?.wallTime) || Date.now();
  const sequence = Number(record?.sequence);
  const fingerprint = fingerprintFor(record, classification);

  stats.totalSeen = (stats.totalSeen || 0) + 1;
  stats.firstSeen = stats.firstSeen ?? now;
  stats.lastSeen = now;
  for (const category of classification.categories.filter(category => category !== 'analytics')) {
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
  }
  const protectionCategories = new Set(['cloudflare', 'akamai', 'perimeterx', 'datadome', 'incapsula']);
  for (const category of classification.categories) {
    if (protectionCategories.has(category)) {
      const label = category[0].toUpperCase() + category.slice(1);
      stats.byProtection[label] = (stats.byProtection[label] || 0) + 1;
      stats.protectionsDetected[label] = (stats.protectionsDetected[label] || 0) + 1;
    }
  }
  if (classification.categories.includes('rate-limit')) stats.totalRateLimits = (stats.totalRateLimits || 0) + 1;

  if (Number.isFinite(sequence) && Number.isFinite(stats.lastSignalSequence)) updateRange(stats.sequenceGap, Math.max(0, sequence - stats.lastSignalSequence));
  if (Number.isFinite(now) && Number.isFinite(stats.lastSignalAt)) updateRange(stats.intervalMs, Math.max(0, now - stats.lastSignalAt));
  stats.lastSignalSequence = Number.isFinite(sequence) ? sequence : stats.lastSignalSequence;
  stats.lastSignalAt = now;

  const duration = Number(record?.data?.duration);
  if (record?.kind === 'network-response' && Number.isFinite(duration)) updateRange(stats.requestResponseMs, duration);

  const navDelta = Number(context.navigationDeltaMs);
  if (Number.isFinite(navDelta) && navDelta >= 0) {
    stats.navigationProximity.samples += 1;
    if (navDelta <= 1000) stats.navigationProximity.within1000ms += 1;
    if (navDelta <= 3000) stats.navigationProximity.within3000ms += 1;
  }

  const existing = [...antiBot.signals].reverse().find(signal => signal.fingerprint === fingerprint && now - signal.lastSeen <= (context.dedupWindowMs || DEDUP_WINDOW_MS));
  if (existing) {
    const beforeBytes = estimateSignalBytes(existing);
    existing.repeatCount = (existing.repeatCount || 1) + 1;
    existing.lastSeen = now;
    existing.lastSequence = Number.isFinite(sequence) ? sequence : existing.lastSequence;
    existing.confidence = Math.max(existing.confidence || 0, classification.confidence || 0);
    existing.evidence = [...new Set([...(existing.evidence || []), ...(classification.evidence || [])])].slice(0, 30);
    existing.endpointMatches = [...new Set([...(existing.endpointMatches || []), ...(classification.endpointMatches || [])])].slice(0, 20);
    stats.deduplicated = (stats.deduplicated || 0) + 1;
    stats.retained = antiBot.signals.length;
    return { signal: existing, created: false, removed: null, deltaBytes: estimateSignalBytes(existing) - beforeBytes };
  }

  const signal = {
    signalId: `abs_${now.toString(36)}_${Number.isFinite(sequence) ? sequence : antiBot.signals.length + 1}`,
    fingerprint,
    firstSeen: now,
    lastSeen: now,
    firstSequence: Number.isFinite(sequence) ? sequence : null,
    lastSequence: Number.isFinite(sequence) ? sequence : null,
    repeatCount: 1,
    kind: record?.kind || 'unknown',
    documentId: record?.documentId || null,
    categories: classification.categories.filter(category => category !== 'analytics'),
    endpointMatches: classification.endpointMatches || [],
    confidence: classification.confidence,
    ruleWeight: classification.ruleWeight,
    evidence: classification.evidence,
    summary: signalSummary(record),
    navigationDeltaMs: Number.isFinite(navDelta) ? navDelta : null
  };
  antiBot.signals.push(signal);
  let removed = null;
  if (antiBot.signals.length > (context.maxSignals || MAX_SIGNALS)) {
    [removed] = antiBot.signals.splice(0, antiBot.signals.length - (context.maxSignals || MAX_SIGNALS));
  }
  stats.retained = antiBot.signals.length;
  return { signal, created: true, removed, deltaBytes: estimateSignalBytes(signal) - estimateSignalBytes(removed) };
}
