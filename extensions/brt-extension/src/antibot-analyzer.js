import {
  analyzeBehaviorPatterns,
  analyzeRateLimiting as analyzeRateLimitingRecords,
  classifyAntiBotRecord,
  detectChallengePage,
  detectProtectionsFromCookies,
  detectProtectionsFromHeaders
} from './antibot.js';

const MAX_NETWORK = 5000;
const MAX_TIMELINE = 5000;
const MAX_SOURCES = 500;
const MAX_TEXT = 80_000;
const MAX_EVIDENCE = 20;
const MAX_ENDPOINTS = 200;

const PROTECTION_SIGNATURES = Object.freeze({
  Cloudflare: [/cloudflare/i, /\/cdn-cgi\//i, /challenges\.cloudflare\.com/i, /cf-chl/i],
  Akamai: [/akamai/i, /akamaized/i, /akamaiedge\.net/i, /\/akamai\/botmanager\//i],
  PerimeterX: [/perimeterx/i, /px-captcha/i, /px[0-9]+/i],
  DataDome: [/datadome/i, /datadome\.co/i],
  'Incapsula (Imperva)': [/incapsula/i, /imperva/i, /incapsula\.net/i],
  Fastly: [/fastly\.net/i],
  'F5 BIG-IP / Advanced WAF': [
    /\/TSPD\/(?:\?|$)/i,
    /the requested url was rejected[\s\S]{0,1200}your support id is/i
  ]
});

const CAPTCHA_SIGNATURES = Object.freeze({
  'reCAPTCHA (Google)': [/google\.com\/recaptcha/i, /g-recaptcha/i, /\/recaptcha\/api/i],
  hCaptcha: [/hcaptcha\.com/i, /h-captcha/i],
  'Cloudflare Turnstile': [/turnstile/i, /challenges\.cloudflare\.com\/turnstile/i]
});

function bounded(value, max = MAX_TEXT) {
  return String(value ?? '').slice(0, max);
}

function sessionRows(session) {
  const source = session && typeof session === 'object' ? session : {};
  const network = Array.isArray(source.network) ? source.network.slice(-MAX_NETWORK) : [];
  const timeline = Array.isArray(source.timeline) ? source.timeline.slice(-MAX_TIMELINE) : [];
  const sources = Array.isArray(source.sources) ? source.sources.slice(-MAX_SOURCES) : [];
  return { source, network, timeline, sources, html: bounded(source.html) };
}

function addEvidence(map, name, evidence, at = null) {
  if (!name) return;
  let item = map.get(name);
  if (!item) {
    item = { name, count: 0, evidence: [], firstSeen: null, lastSeen: null };
    map.set(name, item);
  }
  item.count += 1;
  if (evidence && item.evidence.length < MAX_EVIDENCE && !item.evidence.includes(evidence)) item.evidence.push(bounded(evidence, 500));
  if (at != null && Number.isFinite(Number(at))) {
    item.firstSeen = item.firstSeen == null ? Number(at) : Math.min(item.firstSeen, Number(at));
    item.lastSeen = item.lastSeen == null ? Number(at) : Math.max(item.lastSeen, Number(at));
  }
}

function addMatches(map, text, source, at = null) {
  const value = bounded(text, MAX_TEXT);
  if (!value) return;
  for (const [name, patterns] of Object.entries(PROTECTION_SIGNATURES)) {
    if (patterns.some(pattern => pattern.test(value))) addEvidence(map, name, source || value.slice(0, 160), at);
  }
  for (const [name, patterns] of Object.entries(CAPTCHA_SIGNATURES)) {
    if (patterns.some(pattern => pattern.test(value))) addEvidence(map, name, source || value.slice(0, 160), at);
  }
}

export function detectProtectionDetails(session) {
  const { network, timeline, sources, html } = sessionRows(session);
  const details = new Map();

  for (const item of network) {
    const data = item?.data || {};
    const url = bounded(data.url, 4000);
    addMatches(details, url, url, item.wallTime);
    for (const name of detectProtectionsFromHeaders(data.responseHeaders || data.headers)) addEvidence(details, name, `header:${name}`, item.wallTime);
    for (const name of detectProtectionsFromCookies(data.cookies || data.setCookie)) addEvidence(details, name, `cookie:${name}`, item.wallTime);
    const classification = classifyAntiBotRecord(item);
    for (const category of classification.categories || []) {
      const provider = ({
        cloudflare: 'Cloudflare',
        akamai: 'Akamai',
        perimeterx: 'PerimeterX',
        datadome: 'DataDome',
        incapsula: 'Incapsula (Imperva)',
        f5: 'F5 BIG-IP / Advanced WAF'
      })[category];
      if (provider) addEvidence(details, provider, `category:${category}`, item.wallTime);
    }
    for (const name of [...(classification.endpointMatches || [])]) {
      const provider =
        name.includes('cloudflare') ? 'Cloudflare' :
        name.includes('akamai') ? 'Akamai' :
        name.includes('perimeterx') ? 'PerimeterX' :
        name.includes('datadome') ? 'DataDome' :
        name.includes('f5') ? 'F5 BIG-IP / Advanced WAF' :
        null;
      if (provider) addEvidence(details, provider, `endpoint:${name}`, item.wallTime);
    }
  }

  for (const source of sources) {
    addMatches(details, `${source?.url || ''}\n${source?.text || ''}`, source?.url || source?.label || 'source', source?.firstSeen);
  }
  addMatches(details, html, 'html');
  for (const item of timeline) {
    const data = item?.data || {};
    addMatches(details, Array.isArray(data.signals) ? data.signals.join(' ') : '', item?.kind || 'timeline', item.wallTime);
    const classification = classifyAntiBotRecord(item);
    for (const category of classification.categories || []) {
      const provider = ({
        cloudflare: 'Cloudflare',
        akamai: 'Akamai',
        perimeterx: 'PerimeterX',
        datadome: 'DataDome',
        incapsula: 'Incapsula (Imperva)',
        f5: 'F5 BIG-IP / Advanced WAF'
      })[category];
      if (provider) addEvidence(details, provider, `timeline:${category}`, item.wallTime);
    }
  }

  return [...details.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, MAX_ENDPOINTS);
}

export function detectProtections(session) {
  return detectProtectionDetails(session).map(item => item.name);
}

export function analyzeRateLimiting(session) {
  return analyzeRateLimitingRecords(Array.isArray(session?.network) ? session.network : []);
}

function signalSummary(record, classification) {
  const data = record?.data || {};
  return {
    kind: record?.kind || 'unknown',
    sequence: Number.isFinite(Number(record?.sequence)) ? Number(record.sequence) : null,
    wallTime: Number.isFinite(Number(record?.wallTime)) ? Number(record.wallTime) : null,
    documentId: record?.documentId || null,
    url: bounded(data.url, 500),
    status: Number.isFinite(Number(data.status)) ? Number(data.status) : null,
    categories: (classification.categories || []).filter(category => category !== 'analytics').slice(0, 20),
    confidence: classification.confidence || 0,
    evidence: (classification.evidence || []).slice(0, 20)
  };
}

export function detectAntiBotSignals(session, options = {}) {
  const { timeline, network } = sessionRows(session);
  const records = timeline.length ? timeline : network;
  const limit = Math.max(1, Number(options.maxSignals) || 500);
  const signals = [];
  const aggregated = {};
  const seen = new Set();
  for (const record of records) {
    const classification = classifyAntiBotRecord(record);
    if (!classification.isAntiBotSignal) continue;
    const key = record.eventId || `${record.kind}|${record.sequence}|${record.wallTime}|${record.data?.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const signal = signalSummary(record, classification);
    if (signals.length < limit) signals.push(signal);
    for (const category of signal.categories) {
      const bucket = aggregated[category] || { count: 0, maxConfidence: 0, firstSeen: null, lastSeen: null, evidence: [] };
      bucket.count += 1;
      bucket.maxConfidence = Math.max(bucket.maxConfidence, signal.confidence);
      if (signal.wallTime != null) {
        bucket.firstSeen = bucket.firstSeen == null ? signal.wallTime : Math.min(bucket.firstSeen, signal.wallTime);
        bucket.lastSeen = bucket.lastSeen == null ? signal.wallTime : Math.max(bucket.lastSeen, signal.wallTime);
      }
      for (const evidence of signal.evidence) if (bucket.evidence.length < MAX_EVIDENCE && !bucket.evidence.includes(evidence)) bucket.evidence.push(evidence);
      aggregated[category] = bucket;
    }
  }
  return { totalSignals: seen.size, retainedSignals: signals.length, aggregated, signals };
}

export function analyzeResponseTiming(session) {
  const { network } = sessionRows(session);
  const byEndpoint = {};
  const overall = { min: null, max: null, total: 0, count: 0, average: null };
  for (const item of network) {
    if (item?.kind !== 'network-response') continue;
    const duration = Number(item.data?.duration);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    const endpoint = bounded(item.data?.endpointFamily || item.data?.url || 'unknown', 300);
    const key = Object.prototype.hasOwnProperty.call(byEndpoint, endpoint) || Object.keys(byEndpoint).length < MAX_ENDPOINTS ? endpoint : '__other__';
    const bucket = byEndpoint[key] || { count: 0, total: 0, min: null, max: null, average: null };
    bucket.count += 1;
    bucket.total += duration;
    bucket.min = bucket.min == null ? duration : Math.min(bucket.min, duration);
    bucket.max = bucket.max == null ? duration : Math.max(bucket.max, duration);
    bucket.average = bucket.total / bucket.count;
    byEndpoint[key] = bucket;
    overall.count += 1;
    overall.total += duration;
    overall.min = overall.min == null ? duration : Math.min(overall.min, duration);
    overall.max = overall.max == null ? duration : Math.max(overall.max, duration);
  }
  overall.average = overall.count ? overall.total / overall.count : null;
  const sorted = Object.entries(byEndpoint).sort((a, b) => b[1].average - a[1].average);
  return {
    overall,
    byEndpoint,
    slowest: sorted.slice(0, 5).map(([endpoint, stats]) => ({ endpoint, ...stats })),
    fastest: sorted.slice(-5).reverse().map(([endpoint, stats]) => ({ endpoint, ...stats }))
  };
}

export function analyzeBehavior(session) {
  const { timeline } = sessionRows(session);
  const result = analyzeBehaviorPatterns(timeline);
  const navigations = timeline.filter(item => item?.kind === 'navigation' || item?.kind === 'hard-navigation');
  const navigationTypes = {};
  for (const item of navigations) {
    const type = bounded(item.data?.type || item.data?.transitionType || item.kind, 80);
    navigationTypes[type] = (navigationTypes[type] || 0) + 1;
  }
  return { ...result, totalNavigations: navigations.length, navigationTypes };
}

export function analyzeAntiBot(session, options = {}) {
  const safeSession = session && typeof session === 'object' ? session : {};
  const protectionDetails = detectProtectionDetails(safeSession);
  const signals = detectAntiBotSignals(safeSession, options);
  const html = bounded(safeSession.html);
  return {
    schemaVersion: 1,
    sessionSequence: Number(safeSession.sequence) || 0,
    generatedAt: Date.now(),
    protections: protectionDetails.map(item => item.name),
    protectionDetails,
    rateLimit: analyzeRateLimiting(safeSession),
    signals,
    timing: analyzeResponseTiming(safeSession),
    behavior: analyzeBehavior(safeSession),
    challengePage: detectChallengePage(html)
  };
}
