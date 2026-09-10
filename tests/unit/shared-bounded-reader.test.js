import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readResponseTextBounded
} from '../../dist/shared/bounded-reader.js';

const encoder =
  new TextEncoder();

function makeReader(chunks) {
  let index = 0;
  const cancellations = [];
  let released = false;

  const reader = {
    async read() {
      if (index >= chunks.length) {
        return {
          value: undefined,
          done: true
        };
      }

      return {
        value: chunks[index++],
        done: false
      };
    },

    async cancel(reason) {
      cancellations.push(reason);
    },

    releaseLock() {
      released = true;
    }
  };

  return {
    response: {
      body: {
        getReader() {
          return reader;
        }
      }
    },

    cancellations,

    wasReleased() {
      return released;
    }
  };
}

test('bounded reader reports an unavailable response body', async () => {
  assert.deepEqual(
    await readResponseTextBounded(
      { body: null },
      100,
      'cap'
    ),
    {
      text: '',
      bytesRead: 0,
      truncated: false,
      unavailable: true
    }
  );
});

test('bounded reader preserves a body smaller than the byte cap', async () => {
  const mock =
    makeReader([
      encoder.encode('hello')
    ]);

  const result =
    await readResponseTextBounded(
      mock.response,
      10,
      'cap'
    );

  assert.deepEqual(result, {
    text: 'hello',
    bytesRead: 5,
    truncated: false,
    unavailable: false
  });

  assert.deepEqual(
    mock.cancellations,
    []
  );

  assert.equal(
    mock.wasReleased(),
    true
  );
});

test('bounded reader truncates a chunk that crosses the byte cap', async () => {
  const mock =
    makeReader([
      encoder.encode('abcdef')
    ]);

  const result =
    await readResponseTextBounded(
      mock.response,
      3,
      'body-cap'
    );

  assert.deepEqual(result, {
    text: 'abc',
    bytesRead: 3,
    truncated: true,
    unavailable: false
  });

  assert.deepEqual(
    mock.cancellations,
    ['body-cap']
  );
});

test('bounded reader preserves current exact-cap truncation behavior', async () => {
  const mock =
    makeReader([
      encoder.encode('abc')
    ]);

  const result =
    await readResponseTextBounded(
      mock.response,
      3,
      'exact-cap'
    );

  assert.deepEqual(result, {
    text: 'abc',
    bytesRead: 3,
    truncated: true,
    unavailable: false
  });

  assert.deepEqual(
    mock.cancellations,
    ['exact-cap']
  );
});

test('bounded reader releases the stream lock after truncation', async () => {
  const mock =
    makeReader([
      encoder.encode('abcdef')
    ]);

  await readResponseTextBounded(
    mock.response,
    2,
    'cap'
  );

  assert.equal(
    mock.wasReleased(),
    true
  );
});

test('bounded reader uses the caller-provided cancellation reason', async () => {
  const mock =
    makeReader([
      encoder.encode('abcdef')
    ]);

  await readResponseTextBounded(
    mock.response,
    2,
    'BRT source size cap reached'
  );

  assert.deepEqual(
    mock.cancellations,
    ['BRT source size cap reached']
  );
});

test('bounded reader decodes UTF-8 characters split across chunks', async () => {
  const euro =
    encoder.encode('€');

  const mock =
    makeReader([
      euro.subarray(0, 1),
      euro.subarray(1)
    ]);

  const result =
    await readResponseTextBounded(
      mock.response,
      10,
      'cap'
    );

  assert.deepEqual(result, {
    text: '€',
    bytesRead: 3,
    truncated: false,
    unavailable: false
  });
});
