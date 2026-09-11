import { trimText, sanitizeUrl } from './shared.js';

export function sanitizeCdpEvent(method, params = {}) {
  const safe = { method };

  if (method === 'Network.requestWillBeSent') {
    safe.request = {
      requestId: params.requestId,
      loaderId: params.loaderId,
      documentURL: sanitizeUrl(params.documentURL),
      url: sanitizeUrl(params.request?.url),
      method: params.request?.method,
      resourceType: params.type,
      timestamp: params.timestamp,
      initiator: {
        type: params.initiator?.type,
        url: sanitizeUrl(params.initiator?.url),
        lineNumber: params.initiator?.lineNumber
      }
    };
  } else if (method === 'Network.responseReceived') {
    safe.response = {
      requestId: params.requestId,
      url: sanitizeUrl(params.response?.url),
      status: params.response?.status,
      mimeType: params.response?.mimeType,
      encodedDataLength: params.response?.encodedDataLength,
      resourceType: params.type
    };
  } else if (method === 'Network.loadingFailed') {
    safe.failure = {
      requestId: params.requestId,
      errorText: trimText(params.errorText || '', 500),
      canceled: Boolean(params.canceled),
      blockedReason: params.blockedReason || null,
      resourceType: params.type || null
    };
  } else if (method === 'Debugger.scriptParsed') {
    safe.script = {
      scriptId: params.scriptId,
      url: sanitizeUrl(params.url),
      sourceMapURL: sanitizeUrl(params.sourceMapURL),
      startLine: params.startLine,
      startColumn: params.startColumn,
      endLine: params.endLine,
      endColumn: params.endColumn,
      length: params.length,
      hash: trimText(params.hash || '', 160),
      isModule: Boolean(params.isModule)
    };
  } else if (method === 'Runtime.exceptionThrown') {
    const detail = params.exceptionDetails || {};
    safe.exception = {
      exceptionId: detail.exceptionId,
      text: trimText(detail.text || '', 1000),
      url: sanitizeUrl(detail.url),
      lineNumber: detail.lineNumber,
      columnNumber: detail.columnNumber,
      timestamp: params.timestamp
    };
  } else if (method === 'Page.frameNavigated') {
    safe.frame = {
      id: params.frame?.id,
      parentId: params.frame?.parentId || null,
      loaderId: params.frame?.loaderId,
      url: sanitizeUrl(params.frame?.url),
      securityOrigin: sanitizeUrl(params.frame?.securityOrigin)
    };
  } else if (/WebSocket/.test(method)) {
    safe.websocket = {
      requestId: params.requestId,
      url: sanitizeUrl(params.url),
      opcode: params.opcode,
      timestamp: params.timestamp,
      payloadLength: params.payloadData?.length || 0
    };
  } else {
    safe.metadata = {
      requestId: params.requestId,
      targetId: params.targetId,
      frameId: params.frameId,
      type: params.type
    };
  }

  return safe;
}
