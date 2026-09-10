import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONFIG,
  mergeConfig
} from '../../dist/config.js';

test('default config exposes an explicit bounded fetch response byte cap', () => {
  assert.equal(
    DEFAULT_CONFIG.maxResponseBytes,
    1024 * 1024
  );

  assert.equal(
    DEFAULT_CONFIG.maxResponseSize,
    1024 * 1024
  );
});

test('maxResponseBytes can be overridden independently from maxResponseSize', () => {
  const config =
    mergeConfig({
      maxResponseBytes: 4096,
      maxResponseSize: 1024
    });

  assert.equal(
    config.maxResponseBytes,
    4096
  );

  assert.equal(
    config.maxResponseSize,
    1024
  );
});
