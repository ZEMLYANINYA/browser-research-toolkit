export function classifySourceFetchPolicy({ pageUrl, sourceUrl, allowThirdParty = false } = {}) {
  let source;
  try {
    source = new URL(String(sourceUrl || ''));
  } catch {
    return { allowed: false, firstParty: false, classification: 'unknown', reason: 'invalid-source-url' };
  }

  if (!['http:', 'https:'].includes(source.protocol)) {
    return { allowed: false, firstParty: false, classification: 'unknown', reason: 'unsupported-scheme' };
  }

  let page;
  try {
    page = new URL(String(pageUrl || ''));
  } catch {
    return { allowed: false, firstParty: false, classification: 'unknown', reason: 'page-url-unavailable' };
  }

  if (!['http:', 'https:'].includes(page.protocol) || !page.hostname) {
    return { allowed: false, firstParty: false, classification: 'unknown', reason: 'page-url-unavailable' };
  }

  const firstParty = source.hostname.toLowerCase() === page.hostname.toLowerCase();
  if (firstParty) {
    return { allowed: true, firstParty: true, classification: 'first-party', reason: 'same-hostname' };
  }

  if (allowThirdParty === true) {
    return { allowed: true, firstParty: false, classification: 'third-party', reason: 'third-party-opt-in' };
  }

  return { allowed: false, firstParty: false, classification: 'third-party', reason: 'third-party-disabled' };
}
