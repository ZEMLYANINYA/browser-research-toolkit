import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPersistedEntity,
  decomposeSessionEntities,
  hydrateSessionEntities,
  singletonEntityKey,
  sourceEntityKey
} from '../src/session-entity-model.js';

test('source entities use stable source identity', () => {
  const value = { id: 'src-1', text: 'hello' };
  const entity = createPersistedEntity('session-a', 'source', value);

  assert.equal(entity.entityKey, 'session-a:source:src-1');
  assert.equal(entity.sessionId, 'session-a');
  assert.equal(entity.bucket, 'source');
  assert.equal(entity.value, value);
  assert.equal(sourceEntityKey('session-a', 'src-1'), entity.entityKey);
});

test('html and runtime use singleton entity keys', () => {
  const html = createPersistedEntity('session-a', 'html', '<main>ok</main>');
  const runtime = createPersistedEntity('session-a', 'runtime', [{ key: 'x' }]);

  assert.equal(html.entityKey, 'session-a:html:current');
  assert.equal(runtime.entityKey, 'session-a:runtime:current');
  assert.equal(singletonEntityKey('session-a', 'html'), html.entityKey);
  assert.equal(singletonEntityKey('session-a', 'runtime'), runtime.entityKey);
});

test('decomposition removes bulk entities from the session header', () => {
  const session = {
    sessionId: 'session-a',
    tabId: 7,
    runState: 'running',
    html: '<html></html>',
    runtime: [{ key: 'token', value: '[REDACTED]' }],
    sources: [{ id: 'src-1', text: 'const x = 1;' }],
    timeline: [],
    network: []
  };

  const result = decomposeSessionEntities(session);

  assert.equal('html' in result.header, false);
  assert.equal('runtime' in result.header, false);
  assert.equal('sources' in result.header, false);
  assert.equal(result.entities.length, 3);
  assert.deepEqual(result.entities.map(item => item.bucket).sort(), ['html', 'runtime', 'source']);
});

test('hydration reconstructs sources html and runtime from persisted entities', () => {
  const session = {
    sessionId: 'session-a',
    tabId: 7,
    timeline: [],
    network: []
  };

  const entities = [
    createPersistedEntity('session-a', 'source', { id: 'src-1', text: 'one' }),
    createPersistedEntity('session-a', 'source', { id: 'src-2', text: 'two' }),
    createPersistedEntity('session-a', 'html', '<body>saved</body>'),
    createPersistedEntity('session-a', 'runtime', [{ key: 'answer', value: 42 }]),
    createPersistedEntity('foreign-session', 'source', { id: 'foreign', text: 'ignore' })
  ];

  const hydrated = hydrateSessionEntities(session, entities);

  assert.deepEqual(hydrated.sources.map(item => item.id), ['src-1', 'src-2']);
  assert.equal(hydrated.html, '<body>saved</body>');
  assert.deepEqual(hydrated.runtime, [{ key: 'answer', value: 42 }]);
});
