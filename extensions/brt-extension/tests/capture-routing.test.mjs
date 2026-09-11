import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureScriptTarget,
  createCaptureRouting
} from '../src/capture-routing.js';

test('captureScriptTarget targets all frames by default', () => {
  assert.deepEqual(
    captureScriptTarget(42),
    { tabId: 42, allFrames: true }
  );
});

test('captureScriptTarget targets an explicit frame', () => {
  assert.deepEqual(
    captureScriptTarget(42, 7),
    { tabId: 42, frameIds: [7] }
  );
});

test('captureScriptTarget prefers document identity over frame identity', () => {
  assert.deepEqual(
    captureScriptTarget(42, 7, 'doc-123'),
    { tabId: 42, documentIds: ['doc-123'] }
  );
});

test('capture routing injects isolated bridge and MAIN-world agent', async () => {
  const calls = [];

  const chromeApi = {
    scripting: {
      executeScript: async options => {
        calls.push(options);
      }
    }
  };

  const { injectBridge, injectAgent } = createCaptureRouting(chromeApi);

  await injectBridge(42, 7, 'doc-bridge');
  await injectAgent(42, 8, 'doc-agent');

  assert.deepEqual(calls, [
    {
      target: {
        tabId: 42,
        documentIds: ['doc-bridge']
      },
      files: ['src/content-bridge.js']
    },
    {
      target: {
        tabId: 42,
        documentIds: ['doc-agent']
      },
      files: ['dist/page-agent.js'],
      world: 'MAIN'
    }
  ]);
});

test('capture routing requires scripting.executeScript', () => {
  assert.throws(
    () => createCaptureRouting({}),
    /chrome\.scripting\.executeScript is required/
  );
});
