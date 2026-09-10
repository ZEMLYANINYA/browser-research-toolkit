import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ResponseAnalyzer } from '../../dist/analysis/response-analyzer.js';
import { CollectorContext } from '../../dist/context.js';
import { mergeConfig } from '../../dist/config.js';

function makeHarness(maxResponseSize) {
  const ctx = new CollectorContext(
    mergeConfig({
      maxResponseSize,
      logLevel: 'error'
    })
  );

  return {
    ctx,
    analyzer: new ResponseAnalyzer(ctx)
  };
}

function makeRequest(id = 'req_response_test') {
  return {
    id,
    type: 'fetch',
    url: 'https://example.test/api/data',
    method: 'GET',
    timestamp: 1
  };
}

test('ResponseAnalyzer parses and sanitizes JSON below the response-size limit', async () => {
  const { analyzer, ctx } =
    makeHarness(1000);

  const request =
    makeRequest('req_json_small');

  const response =
    new Response(
      JSON.stringify({
        safe: 'keep',
        token: 'secret'
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      }
    );

  await analyzer.analyzeFetchResponse(
    response,
    request
  );

  assert.equal(
    request.status,
    200
  );

  assert.equal(
    request.contentType,
    'application/json'
  );

  assert.equal(
    request.responseType,
    'json'
  );

  assert.deepEqual(
    request.jsonData,
    {
      safe: 'keep',
      token: '[REDACTED]'
    }
  );

  assert.ok(
    ctx.jsonData.has('req_json_small')
  );
});

test('ResponseAnalyzer marks truncated JSON when the character slice remains valid JSON', async () => {
  const json =
    '{"safe":1}';

  assert.equal(
    json.length,
    10
  );

  const { analyzer } =
    makeHarness(json.length);

  const request =
    makeRequest('req_json_valid_slice');

  const response =
    new Response(
      json + '     ',
      {
        headers: {
          'content-type': 'application/json'
        }
      }
    );

  await analyzer.analyzeFetchResponse(
    response,
    request
  );

  assert.equal(
    request.responseType,
    'json'
  );

  assert.deepEqual(
    request.jsonData,
    {
      safe: 1,
      __response_truncated__: true
    }
  );
});

test('ResponseAnalyzer slices plain text by maxResponseSize before storing it', async () => {
  const { analyzer } =
    makeHarness(5);

  const request =
    makeRequest('req_text_slice');

  const response =
    new Response(
      'abcdefgh',
      {
        headers: {
          'content-type': 'text/plain'
        }
      }
    );

  await analyzer.analyzeFetchResponse(
    response,
    request
  );

  assert.equal(
    request.responseType,
    'text'
  );

  assert.equal(
    request.responseText,
    'abcde'
  );
});

test('ResponseAnalyzer currently interprets maxResponseSize as JavaScript characters rather than UTF-8 bytes', async () => {
  const { analyzer } =
    makeHarness(2);

  const request =
    makeRequest('req_unicode_character_limit');

  const response =
    new Response(
      '€€€',
      {
        headers: {
          'content-type': 'text/plain'
        }
      }
    );

  await analyzer.analyzeFetchResponse(
    response,
    request
  );

  assert.equal(
    request.responseType,
    'text'
  );

  assert.equal(
    request.responseText,
    '€€'
  );

  assert.equal(
    new TextEncoder().encode(
      request.responseText
    ).byteLength,
    6
  );
});

test('ResponseAnalyzer currently loses truncation metadata when truncated JSON becomes invalid', async () => {
  const { analyzer, ctx } =
    makeHarness(8);

  const request =
    makeRequest('req_json_invalid_slice');

  const response =
    new Response(
      '{"safe":12345}',
      {
        headers: {
          'content-type': 'application/json'
        }
      }
    );

  await analyzer.analyzeFetchResponse(
    response,
    request
  );

  assert.equal(
    request.responseType,
    'text'
  );

  assert.equal(
    request.responseText,
    '{"safe":'
  );

  assert.equal(
    request.jsonData,
    undefined
  );

  assert.equal(
    ctx.jsonData.has(
      'req_json_invalid_slice'
    ),
    false
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      request,
      '__response_truncated__'
    ),
    false
  );
});

test('ResponseAnalyzer stops fetch body analysis at maxResponseBytes before the legacy character cap', async () => {
  const ctx = new CollectorContext(
    mergeConfig({
      maxResponseBytes: 5,
      maxResponseSize: 100,
      logLevel: 'error'
    })
  );

  const analyzer =
    new ResponseAnalyzer(ctx);

  const request =
    makeRequest('req_byte_cap_ascii');

  const response =
    new Response(
      'abcdefgh',
      {
        headers: {
          'content-type': 'text/plain'
        }
      }
    );

  await analyzer.analyzeFetchResponse(
    response,
    request
  );

  assert.equal(
    request.responseType,
    'text'
  );

  assert.equal(
    request.responseText,
    'abcde'
  );
});

test('ResponseAnalyzer applies maxResponseBytes as a UTF-8 byte cap', async () => {
  const ctx = new CollectorContext(
    mergeConfig({
      maxResponseBytes: 6,
      maxResponseSize: 100,
      logLevel: 'error'
    })
  );

  const analyzer =
    new ResponseAnalyzer(ctx);

  const request =
    makeRequest('req_byte_cap_unicode');

  const response =
    new Response(
      '€€€',
      {
        headers: {
          'content-type': 'text/plain'
        }
      }
    );

  await analyzer.analyzeFetchResponse(
    response,
    request
  );

  assert.equal(
    request.responseType,
    'text'
  );

  assert.equal(
    request.responseText,
    '€€'
  );
});
