import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  EXTENSION_CAPTURE_LIMITS
} from '../dist/shared-text.js';

import {
  LIMITS
} from '../src/shared.js';

const pageAgentSource =
  fs.readFileSync(
    new URL(
      '../src/page-agent.js',
      import.meta.url
    ),
    'utf8'
  );

test('extension facade reuses shared capture limits', () => {
  for (
    const [
      key,
      value
    ] of Object.entries(
      EXTENSION_CAPTURE_LIMITS
    )
  ) {
    assert.equal(
      LIMITS[key],
      value,
      key
    );
  }

  assert.equal(
    Object.isFrozen(LIMITS),
    true
  );
});

test('MAIN-world agent composes its local policy from shared capture limits', () => {
  assert.match(
    pageAgentSource,
    /import\s*\{\s*EXTENSION_CAPTURE_LIMITS\s*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/src\/shared\/limits\.ts['"]/
  );

  assert.match(
    pageAgentSource,
    /\.\.\.EXTENSION_CAPTURE_LIMITS/
  );

  for (
    const duplicated of [
      'maxResponseChars: 80_000',
      'maxHtmlChars: 1_500_000',
      'maxRuntimeEntries: 4000',
      'maxStructuredBodyChars: 120_000'
    ]
  ) {
    assert.equal(
      pageAgentSource.includes(
        duplicated
      ),
      false,
      `page-agent duplicated shared limit: ${duplicated}`
    );
  }
});
