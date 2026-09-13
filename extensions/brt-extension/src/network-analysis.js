import { classifyAntiBotRecord } from './antibot.js';

const ANALYTICS_URL_TOKEN =
  /(?:^|[./_-])(?:analytics|telemetry|collect|pixel|beacon|gtag|webvisor|pagead\d*|doubleclick|rmkt|ccm|tracking)(?:[./_?=&-]|$)/i;

function isGoogleHostname(hostname) {
  return /(^|\.)google\.(?:com|[a-z]{2,3})(?:\.[a-z]{2})?$/i
    .test(String(hostname || ''));
}

export function isAnalyticsNetworkRecord(data = {}) {
  const url = String(data?.url || '');

  if (ANALYTICS_URL_TOKEN.test(url)) {
    return true;
  }

  let parsed = null;

  try {
    parsed = new URL(url);
  } catch {}

  const pathname =
    String(parsed?.pathname || '').toLowerCase();

  if (
    pathname.endsWith('/log204') ||
    pathname.endsWith('/gen_204')
  ) {
    return true;
  }

  if (pathname === '/log') {
    const transport =
      String(data?.transport || '').toLowerCase();

    if (
      isGoogleHostname(parsed?.hostname) ||
      transport === 'beacon'
    ) {
      return true;
    }

    if (
      Number(data?.status) === 204 &&
      (data?.body == null || data.body === '')
    ) {
      return true;
    }
  }

  return false;
}

export function classifyNetwork(data, pageUrl = '') {
  const url = String(data?.url || '');
  const antiBot = classifyAntiBotRecord({ kind: 'network-request', data }).isAntiBotSignal;
  const analytics = isAnalyticsNetworkRecord(data);
  const bodyText = typeof data?.body === 'string' ? data.body : '';
  const graphql = /graphql/i.test(url) || /operationName|query\s*[:=]/i.test(bodyText);
  return {
    classification: antiBot
      ? 'anti-bot-signal'
      : analytics
        ? 'analytics'
        : graphql
          ? 'graphql'
          : /\.((js|css|png|jpg|svg|woff2?)(\?|$))/i.test(url)
            ? 'static-asset'
            : 'unknown',
    firstParty: (() => {
      try {
        return new URL(url).hostname === new URL(pageUrl || url).hostname;
      } catch {
        return null;
      }
    })()
  };
}

export function graphqlFinding(data) {
  const body = data?.body;
  if (!body || typeof body !== 'string') return null;

  try {
    const parsed = JSON.parse(body);
    const query = parsed.query || '';
    const operation =
      parsed.operationName ||
      (query.match(/(?:query|mutation|subscription)\s+([A-Za-z0-9_]+)/)?.[1] || null);

    if (!operation && !parsed.extensions?.persistedQuery) return null;

    return {
      operationName: operation,
      operationType:
        query.match(/^(?:\s*)(query|mutation|subscription)/)?.[1] || 'unknown',
      variableNames: Object.keys(parsed.variables || {}),
      persistedQueryHash: parsed.extensions?.persistedQuery?.sha256Hash || null
    };
  } catch {
    return null;
  }
}

export function endpointFamily(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname.replace(/\/(?:\d+|[a-f0-9]{8,})\b/gi, '/{id}')}`;
  } catch {
    return url;
  }
}

export function buildApiAnalysis(session) {
  const families = new Map();

  for (const item of session.network.filter(record => record.kind === 'network-request')) {
    const data = item.data || {};
    const key = `${data.method || 'GET'} ${data.endpointFamily || data.url || 'unknown'}`;
    const family = families.get(key) || {
      key,
      method: data.method || 'GET',
      family: data.endpointFamily || data.url,
      count: 0,
      statuses: [],
      contentTypes: [],
      queryKeys: [],
      graphqlOperations: new Set(),
      firstParty: data.firstParty,
      firstSeen: item.wallTime,
      lastSeen: item.wallTime
    };

    family.count++;
    family.lastSeen = item.wallTime;

    if (data.graphql?.operationName) {
      family.graphqlOperations.add(data.graphql.operationName);
    }

    families.set(key, family);
  }

  return [...families.values()].map(family => ({
    ...family,
    graphqlOperations: [...family.graphqlOperations]
  }));
}
