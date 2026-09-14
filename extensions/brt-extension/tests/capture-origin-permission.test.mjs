import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureOriginPattern,
  requestCaptureOriginPermission
} from '../ui/capture-origin-permission.js';

test('captureOriginPattern scopes permission to the current http(s) host', () => {
  assert.equal(
    captureOriginPattern('https://www.google.com/maps/place/example?hl=en'),
    'https://www.google.com/*'
  );

  assert.equal(
    captureOriginPattern('http://127.0.0.1:8123/index.html'),
    'http://127.0.0.1/*'
  );

  assert.equal(captureOriginPattern('chrome://extensions'), '');
  assert.equal(captureOriginPattern('ftp://example.com/file'), '');
  assert.equal(captureOriginPattern('not a url'), '');
});

test('requestCaptureOriginPermission requests only the derived capture host', async () => {
  const calls = [];
  const chromeApi = {
    permissions: {
      request(options) {
        calls.push(options);
        return Promise.resolve(true);
      }
    }
  };

  const result = await requestCaptureOriginPermission(
    chromeApi,
    'https://maps.example.test/place/123'
  );

  assert.deepEqual(calls, [
    { origins: ['https://maps.example.test/*'] }
  ]);

  assert.deepEqual(result, {
    granted: true,
    originPattern: 'https://maps.example.test/*',
    reason: 'granted'
  });
});

test('requestCaptureOriginPermission is fail-closed when the user denies access', async () => {
  const chromeApi = {
    permissions: {
      request() {
        return false;
      }
    }
  };

  const result = await requestCaptureOriginPermission(
    chromeApi,
    'https://example.test/research'
  );

  assert.equal(result.granted, false);
  assert.equal(result.reason, 'denied');
  assert.equal(result.originPattern, 'https://example.test/*');
});

test('requestCaptureOriginPermission never requests access for unsupported URLs', async () => {
  let requested = false;
  const chromeApi = {
    permissions: {
      request() {
        requested = true;
        return true;
      }
    }
  };

  const result = await requestCaptureOriginPermission(
    chromeApi,
    'chrome-extension://example/panel.html'
  );

  assert.equal(requested, false);
  assert.deepEqual(result, {
    granted: false,
    originPattern: '',
    reason: 'unsupported-url'
  });
});
