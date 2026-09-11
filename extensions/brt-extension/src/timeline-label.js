export function timelineLabel(payload) {
  const d = payload.data || {};

  switch (payload.kind) {
    case 'network-request':
      return `${d.transport || 'net'} ${d.method || ''} ${d.url || ''}`;
    case 'network-response':
      return `${d.transport || 'net'} response ${d.status ?? ''} ${d.url || ''}`;
    case 'network-body':
      return `body ${d.url || ''}`;
    case 'dom-event':
      return `${d.type || 'event'} ${d.target?.selectorHint || ''}`;
    case 'form-submit':
      return `${d.method || 'GET'} form ${d.action || ''} · ${d.trigger || 'native'}`;
    case 'navigation':
      return `${d.type || 'navigation'} ${d.to || ''}`;
    case 'source-url':
      return `script ${d.url || ''}`;
    case 'source-inline':
      return d.label || 'inline script';
    case 'antibot-dom-signal':
      return `anti-bot DOM ${Array.isArray(d.signals) ? d.signals.join(', ') : ''}`;
    case 'connection-lifecycle':
      return `${d.transport || 'connection'} ${d.state || 'state'} ${d.url || ''}`;
    case 'timer-schedule':
      return `${d.timerType || 'timer'} ${d.delay ?? ''}ms${d.callbackKeywords?.length ? ` · ${d.callbackKeywords.join(',')}` : ''}`;
    case 'timer-fire':
      return `${d.timerType || 'timer'} fired${d.callbackKeywords?.length ? ` · ${d.callbackKeywords.join(',')}` : ''}`;
    case 'cdp-event':
      return `CDP ${d.method || 'event'}${d.request?.url ? ` · ${d.request.url}` : d.response?.url ? ` · ${d.response.url}` : d.script?.url ? ` · ${d.script.url}` : d.frame?.url ? ` · ${d.frame.url}` : ''}`;
    default:
      return payload.kind;
  }
}
