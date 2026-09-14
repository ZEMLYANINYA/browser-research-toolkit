export function captureOriginPattern(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));

    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }

    /*
     * Chrome extension host permissions use match patterns. Match-pattern
     * hosts do not carry a port component, so scope this grant to the exact
     * scheme + hostname supported by the permissions API.
     */
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return '';
  }
}

export function requestCaptureOriginPermission(chromeApi, rawUrl) {
  const originPattern = captureOriginPattern(rawUrl);

  if (!originPattern) {
    return Promise.resolve({
      granted: false,
      originPattern: '',
      reason: 'unsupported-url'
    });
  }

  const request = chromeApi?.permissions?.request;

  if (typeof request !== 'function') {
    return Promise.reject(
      new TypeError('chrome.permissions.request is unavailable')
    );
  }

  let pending;

  try {
    /*
     * Invoke permissions.request() before the first await so the call remains
     * directly attached to the Start button user gesture.
     */
    pending = request.call(
      chromeApi.permissions,
      { origins: [originPattern] }
    );
  } catch (error) {
    return Promise.reject(error);
  }

  return Promise.resolve(pending).then(granted => ({
    granted: Boolean(granted),
    originPattern,
    reason: granted ? 'granted' : 'denied'
  }));
}
