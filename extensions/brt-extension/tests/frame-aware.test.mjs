import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildDomNetworkCorrelation,
  ensureDocument,
  minimalEventEnvelope
} from '../src/session-utils.js';

const manifest = JSON.parse(
  fs.readFileSync(
    new URL('../manifest.json', import.meta.url),
    'utf8'
  )
);

test('both extension content scripts are enabled in all frames', () => {
  assert.equal(manifest.content_scripts.length, 2);

  for (const script of manifest.content_scripts) {
    assert.equal(
      script.all_frames,
      true,
      `${script.js?.[0] || 'content script'} must run in subframes`
    );
  }
});

test('subframe document preserves frame provenance', () => {
  const session = {
    documents: []
  };

  const document = ensureDocument(session, {
    documentId: 'document-child-1',
    url: 'https://child.example.test/frame',
    frameId: 7,
    firstSeen: 1000
  });

  assert.ok(document);
  assert.equal(document.documentId, 'document-child-1');
  assert.equal(document.frameId, 7);
  assert.equal(
    document.url,
    'https://child.example.test/frame'
  );
});

test('minimal event envelope preserves frameId', () => {
  const envelope = minimalEventEnvelope({
    eventId: 'evt-frame-1',
    sequence: 10,
    kind: 'network-request',
    sessionId: 'session-1',
    documentId: 'document-child-1',
    frameId: 7,
    wallTime: 1000,
    provenance: {
      integrity: 'page-observable'
    },
    data: {
      url: 'https://child.example.test/api',
      method: 'GET'
    }
  });

  assert.equal(envelope.frameId, 7);
});

test('DOM/network correlation rejects cross-frame candidates', () => {
  const interaction = {
    eventId: 'evt-dom-1',
    sequence: 10,
    kind: 'dom-event',
    sessionId: 'session-1',
    documentId: 'document-shared',
    frameId: 3,
    wallTime: 1000,
    provenance: {
      integrity: 'page-observable'
    },
    data: {
      isTrusted: true
    }
  };

  const request = {
    eventId: 'evt-net-1',
    sequence: 11,
    kind: 'network-request',
    sessionId: 'session-1',
    documentId: 'document-shared',
    frameId: 8,
    wallTime: 1100,
    provenance: {
      integrity: 'page-observable'
    },
    data: {
      url: 'https://example.test/api'
    }
  };

  assert.equal(
    buildDomNetworkCorrelation(interaction, request),
    null
  );
});

test('DOM/network correlation still accepts same-frame candidates', () => {
  const interaction = {
    eventId: 'evt-dom-2',
    sequence: 20,
    kind: 'dom-event',
    sessionId: 'session-1',
    documentId: 'document-child-2',
    frameId: 4,
    wallTime: 2000,
    provenance: {
      integrity: 'page-observable'
    },
    data: {
      isTrusted: true
    }
  };

  const request = {
    eventId: 'evt-net-2',
    sequence: 21,
    kind: 'network-request',
    sessionId: 'session-1',
    documentId: 'document-child-2',
    frameId: 4,
    wallTime: 2100,
    provenance: {
      integrity: 'page-observable'
    },
    data: {
      url: 'https://example.test/api'
    }
  };

  const correlation =
    buildDomNetworkCorrelation(interaction, request);

  assert.ok(correlation);
  assert.equal(correlation.fromEventId, 'evt-dom-2');
  assert.equal(correlation.toEventId, 'evt-net-2');
});

test('existing document can receive authoritative frame provenance', () => {
  const session = {
    documents: [
      {
        documentId: 'document-child-existing',
        url: '',
        firstSeen: 1000,
        frameId: 0
      }
    ]
  };

  const document = ensureDocument(session, {
    documentId: 'document-child-existing',
    url: 'https://child.example.test/frame',
    frameId: 9
  });

  assert.equal(document.frameId, 9);
  assert.equal(
    document.url,
    'https://child.example.test/frame'
  );
});

test('subframe committed navigation preserves top-level session authority', async () => {
  const utils = await import('../src/session-utils.js');

  assert.equal(
    typeof utils.applyCommittedNavigation,
    'function',
    'applyCommittedNavigation must exist'
  );

  const session = {
    documents: [],
    pageUrl: 'https://top.example.test/page',
    activeDocumentId: 'top-document'
  };

  const result = utils.applyCommittedNavigation(session, {
    documentId: 'child-document-2',
    url: 'https://child.example.test/frame',
    frameId: 12,
    parentFrameId: 0,
    parentDocumentId: 'top-document',
    frameType: 'sub_frame',
    documentLifecycle: 'active',
    transitionType: 'auto_subframe',
    firstSeen: 2000
  });

  assert.equal(result.isTopFrame, false);

  // A child frame must not become the canonical page.
  assert.equal(
    session.pageUrl,
    'https://top.example.test/page'
  );

  assert.equal(
    session.activeDocumentId,
    'top-document'
  );

  const child = session.documents.find(
    item => item.documentId === 'child-document-2'
  );

  assert.ok(child);
  assert.equal(child.frameId, 12);
  assert.equal(child.parentFrameId, 0);
  assert.equal(child.parentDocumentId, 'top-document');
  assert.equal(child.frameType, 'sub_frame');
  assert.equal(child.documentLifecycle, 'active');
});

test('top-frame committed navigation updates canonical session authority', async () => {
  const utils = await import('../src/session-utils.js');

  assert.equal(
    typeof utils.applyCommittedNavigation,
    'function'
  );

  const session = {
    documents: [],
    pageUrl: 'https://old.example.test/',
    activeDocumentId: 'old-document'
  };

  const result = utils.applyCommittedNavigation(session, {
    documentId: 'top-document-new',
    url: 'https://new.example.test/page',
    frameId: 0,
    parentFrameId: -1,
    frameType: 'outermost_frame',
    documentLifecycle: 'active',
    transitionType: 'link',
    firstSeen: 3000
  });

  assert.equal(result.isTopFrame, true);

  assert.equal(
    session.pageUrl,
    'https://new.example.test/page'
  );

  assert.equal(
    session.activeDocumentId,
    'top-document-new'
  );

  const document = session.documents.find(
    item => item.documentId === 'top-document-new'
  );

  assert.ok(document);
  assert.equal(document.frameId, 0);
});

test('cross-origin subframe navigation does not redefine source-fetch boundary', async () => {
  const utils = await import('../src/session-utils.js');
  const { classifySourceFetchPolicy } =
    await import('../src/source-policy.js');

  const session = {
    documents: [],
    pageUrl: 'https://top.example.test/page',
    activeDocumentId: 'top-document'
  };

  utils.applyCommittedNavigation(session, {
    documentId: 'cross-origin-child',
    url: 'https://foreign.example/frame',
    frameId: 21,
    parentFrameId: 0,
    parentDocumentId: 'top-document',
    frameType: 'sub_frame',
    documentLifecycle: 'active'
  });

  // Child navigation must leave the canonical first-party URL untouched.
  assert.equal(
    session.pageUrl,
    'https://top.example.test/page'
  );

  const policy = classifySourceFetchPolicy({
    pageUrl: session.pageUrl,
    sourceUrl: 'https://foreign.example/frame-script.js',
    allowThirdParty: false
  });

  assert.equal(policy.allowed, false);
});

test('background accepts committed navigations from subframes', () => {
  const background = fs.readFileSync(
    new URL('../src/background.js', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(
    background,
    /if\s*\(\s*details\.frameId\s*!==\s*0\s*\)\s*return\s*;/
  );

  assert.match(
    background,
    /applyCommittedNavigation\s*\(\s*session\s*,\s*\{/
  );

  assert.match(
    background,
    /frameId\s*:\s*details\.frameId/
  );

  assert.match(
    background,
    /parentFrameId\s*:\s*details\.parentFrameId/
  );

  assert.match(
    background,
    /parentDocumentId\s*:\s*details\.parentDocumentId/
  );
});

test('subframes cannot overwrite top-level session-owned page state', () => {
  const background = fs.readFileSync(
    new URL('../src/background.js', import.meta.url),
    'utf8'
  );

  assert.match(
    background,
    /canonical\.kind\s*===\s*['"]agent-status['"]\s*&&\s*canonical\.frameId\s*===\s*0/
  );

  assert.match(
    background,
    /canonical\.kind\s*===\s*['"]html-snapshot['"]\s*&&\s*canonical\.frameId\s*===\s*0/
  );

  assert.match(
    background,
    /canonical\.kind\s*===\s*['"]runtime-snapshot['"]\s*&&\s*canonical\.frameId\s*===\s*0/
  );

  assert.match(
    background,
    /canonical\.kind\s*===\s*['"]runtime-watch['"]\s*&&\s*canonical\.frameId\s*===\s*0/
  );
});
