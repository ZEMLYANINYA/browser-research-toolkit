import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTENSION_CAPTURE_LIMITS
} from '../../dist/shared/limits.js';

test('shared extension capture limits preserve the existing bounded capture policy', () => {
  assert.deepEqual(
    EXTENSION_CAPTURE_LIMITS,
    {
      maxResponseChars: 80_000,
      maxHtmlChars: 1_500_000,
      maxRuntimeEntries: 4000,
      maxStructuredBodyChars: 120_000
    }
  );

  assert.equal(
    Object.isFrozen(EXTENSION_CAPTURE_LIMITS),
    true
  );
});
