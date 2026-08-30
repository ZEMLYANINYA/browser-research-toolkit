(() => {
  const CHANNEL = '__BRT_LAB_V01__';
  const ALLOWED_PAGE_EVENT_KINDS = new Set([
    'agent-status', 'antibot-dom-signal', 'connection-lifecycle', 'diagnostic', 'dom-event',
    'html-snapshot', 'mutation', 'navigation', 'network-body', 'network-error', 'network-request',
    'network-response', 'performance', 'performance-summary', 'runtime-snapshot', 'runtime-watch',
    'source-inline', 'source-url', 'storage-snapshot', 'timer-fire', 'timer-schedule', 'worker-awareness'
  ]);
  const MAX_PAGE_EVENT_CHARS = 2_200_000;
  let contextAlive = true;

  const stopInvalidatedBridge = () => {
    if (!contextAlive) return;
    contextAlive = false;
    window.removeEventListener('message', onPageMessage);
    try { chrome.runtime.onMessage.removeListener(onExtensionMessage); } catch {}
  };

  const sendRuntimeMessage = (message) => {
    if (!contextAlive) return;
    try {
      const pending = chrome.runtime.sendMessage(message);
      pending?.catch?.(error => {
        if (/context invalidated|extension context/i.test(String(error?.message || error))) stopInvalidatedBridge();
      });
    } catch (error) {
      if (/context invalidated|extension context/i.test(String(error?.message || error))) stopInvalidatedBridge();
    }
  };

  function isBoundedPageEvent(payload) {
    try { return JSON.stringify(payload).length <= MAX_PAGE_EVENT_CHARS; }
    catch { return false; }
  }

  function onPageMessage(event) {
    if (!contextAlive) return;
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL || msg.direction !== 'PAGE_TO_EXTENSION') return;
    const payload = msg.payload;
    if (!payload || !ALLOWED_PAGE_EVENT_KINDS.has(payload.kind)) return;
    if (!Number.isInteger(payload.sequence) || payload.sequence < 1) return;
    if (!Number.isInteger(payload.generation) || payload.generation < 1) return;
    if (typeof payload.runId !== 'string' || payload.runId.length < 5 || payload.runId.length > 120) return;
    if (!Number.isFinite(payload.wallTime) || payload.wallTime <= 0) return;
    if (!isBoundedPageEvent(payload)) return;
    if (payload.kind === 'source-url') {
      const rawUrl = payload.data?.rawUrl;
      const observed = rawUrl && [...document.scripts].some(script => script.src === rawUrl);
      if (!observed) return;
    }
    sendRuntimeMessage({ type: 'BRT_PAGE_EVENT', payload });
  }
  window.addEventListener('message', onPageMessage);

  function onExtensionMessage(message) {
    if (!message || message.type !== 'BRT_EXTENSION_COMMAND') return;
    window.postMessage({
      channel: CHANNEL,
      direction: 'EXTENSION_TO_PAGE',
      payload: message.payload
    }, '*');
  }
  chrome.runtime.onMessage.addListener(onExtensionMessage);

  sendRuntimeMessage({ type: 'BRT_BRIDGE_READY' });
})();
