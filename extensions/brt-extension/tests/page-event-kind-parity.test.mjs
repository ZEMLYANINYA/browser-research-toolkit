import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  PAGE_EVENT_KINDS
} from '../src/protocol.js';

const bridge =
  fs.readFileSync(
    new URL(
      '../src/content-bridge.js',
      import.meta.url
    ),
    'utf8'
  );

function bridgeAllowedKinds(source) {
  const match =
    source.match(
      /const\s+ALLOWED_PAGE_EVENT_KINDS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/
    );

  assert.ok(
    match,
    'content bridge allow-list was not found'
  );

  const kinds = [];

  for (
    const item of
    match[1].matchAll(
      /['"]([^'"]+)['"]/g
    )
  ) {
    kinds.push(item[1]);
  }

  return kinds;
}

test('isolated bridge page-event allow-list stays in parity with shared protocol kinds', () => {
  const bridgeKinds =
    bridgeAllowedKinds(bridge);

  assert.equal(
    new Set(bridgeKinds).size,
    bridgeKinds.length,
    'bridge allow-list contains duplicates'
  );

  assert.deepEqual(
    [...bridgeKinds].sort(),
    [...PAGE_EVENT_KINDS].sort()
  );
});
