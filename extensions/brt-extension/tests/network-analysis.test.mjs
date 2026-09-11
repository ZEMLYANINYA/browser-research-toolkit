import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyNetwork,
  graphqlFinding,
  endpointFamily,
  buildApiAnalysis
} from '../src/network-analysis.js';

test('classifyNetwork identifies analytics and first-party traffic', () => {
  assert.deepEqual(
    classifyNetwork(
      { url: 'https://example.test/analytics/collect' },
      'https://example.test/page'
    ),
    {
      classification: 'analytics',
      firstParty: true
    }
  );
});

test('classifyNetwork identifies GraphQL and static assets', () => {
  assert.equal(
    classifyNetwork({ url: 'https://api.example.test/graphql' }).classification,
    'graphql'
  );

  assert.equal(
    classifyNetwork({ url: 'https://example.test/app.js' }).classification,
    'static-asset'
  );
});

test('graphqlFinding extracts operation metadata without values', () => {
  const finding = graphqlFinding({
    body: JSON.stringify({
      operationName: 'SearchProducts',
      query: 'query SearchProducts($query: String!) { search(query: $query) { id } }',
      variables: {
        query: 'SECRET_VALUE'
      }
    })
  });

  assert.deepEqual(finding, {
    operationName: 'SearchProducts',
    operationType: 'query',
    variableNames: ['query'],
    persistedQueryHash: null
  });
});

test('graphqlFinding rejects malformed and unrelated bodies', () => {
  assert.equal(graphqlFinding({ body: 'not-json' }), null);
  assert.equal(graphqlFinding({ body: '{"foo":"bar"}' }), null);
});

test('endpointFamily normalizes numeric and long hexadecimal path identities', () => {
  assert.equal(
    endpointFamily('https://example.test/api/users/123/orders/abcdef123456'),
    '/api/users/{id}/orders/{id}'
  );
});

test('buildApiAnalysis groups network requests by method and endpoint family', () => {
  const analysis = buildApiAnalysis({
    network: [
      {
        kind: 'network-request',
        wallTime: 10,
        data: {
          method: 'GET',
          endpointFamily: '/api/items/{id}',
          firstParty: true,
          graphql: { operationName: 'Items' }
        }
      },
      {
        kind: 'network-request',
        wallTime: 20,
        data: {
          method: 'GET',
          endpointFamily: '/api/items/{id}',
          firstParty: true,
          graphql: { operationName: 'Items' }
        }
      }
    ]
  });

  assert.equal(analysis.length, 1);
  assert.equal(analysis[0].count, 2);
  assert.equal(analysis[0].firstSeen, 10);
  assert.equal(analysis[0].lastSeen, 20);
  assert.deepEqual(analysis[0].graphqlOperations, ['Items']);
});
