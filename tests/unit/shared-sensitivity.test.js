import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isExtensionSensitiveFieldName
} from '../../dist/shared/sensitivity.js';

test('extension sensitive-field classifier recognizes current protected field names', () => {
  const sensitive = [
    'authorization',
    'Proxy-Authorization',
    'cookie',
    'set-cookie',
    'x-csrf-token',
    'x-xsrf-header',
    'access_token',
    'refresh-token',
    'sessionId',
    'api_key',
    'visitor_id',
    'client-id',
    'deviceId',
    'tracking_id'
  ];

  for (const value of sensitive) {
    assert.equal(
      isExtensionSensitiveFieldName(value),
      true,
      `expected sensitive: ${value}`
    );
  }
});

test('extension sensitive-field classifier preserves current safe near-matches', () => {
  const safe = [
    'content-type',
    'accept',
    'cache-control',
    'username',
    'email',
    'phone',
    'request-id',
    'trace-id'
  ];

  for (const value of safe) {
    assert.equal(
      isExtensionSensitiveFieldName(value),
      false,
      `expected non-sensitive: ${value}`
    );
  }
});
