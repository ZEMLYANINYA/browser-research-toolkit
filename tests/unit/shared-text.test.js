import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateText } from '../../dist/shared/text.js';

test('truncateText preserves text within the limit', () => {
  assert.equal(
    truncateText('abc', 3, '...'),
    'abc'
  );
});

test('truncateText truncates and appends the caller-provided suffix', () => {
  assert.equal(
    truncateText('abcdef', 3, '...'),
    'abc...'
  );

  assert.equal(
    truncateText('abcdef', 3, '\n/* …truncated… */'),
    'abc\n/* …truncated… */'
  );
});

test('truncateText supports an empty suffix', () => {
  assert.equal(
    truncateText('abcdef', 3, ''),
    'abc'
  );
});
