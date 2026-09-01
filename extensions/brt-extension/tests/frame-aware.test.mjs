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

test('source frame context resolves iframe provenance without changing top-level page boundary', async () => {
  const utils = await import('../src/session-utils.js');

  assert.equal(
    typeof utils.resolveSourceFrameContext,
    'function',
    'resolveSourceFrameContext must exist'
  );

  const session = {
    pageUrl: 'https://top.example.test/page',
    documents: [
      {
        documentId: 'top-document',
        frameId: 0,
        url: 'https://top.example.test/page'
      },
      {
        documentId: 'child-source-document',
        frameId: 7,
        url: 'https://child.example.test/frame'
      }
    ]
  };

  const context = utils.resolveSourceFrameContext(session, {
    documentId: 'child-source-document',
    frameId: 7
  });

  assert.equal(context.documentId, 'child-source-document');
  assert.equal(context.frameId, 7);
  assert.equal(
    context.documentUrl,
    'https://child.example.test/frame'
  );
  assert.equal(context.isTopFrame, false);

  // Resolving provenance must never redefine the canonical
  // first-party boundary of the tab.
  assert.equal(
    session.pageUrl,
    'https://top.example.test/page'
  );
});

test('captured sources retain frame provenance while fetch policy stays top-level', () => {
  const background = fs.readFileSync(
    new URL('../src/background.js', import.meta.url),
    'utf8'
  );

  assert.match(
    background,
    /resolveSourceFrameContext/,
    'background must use resolveSourceFrameContext'
  );

  const inlineStart = background.indexOf(
    "} else if (canonical.kind === 'source-inline') {"
  );

  const inlineEnd = background.indexOf(
    "} else if (canonical.kind === 'source-url') {",
    inlineStart
  );

  assert.ok(inlineStart >= 0);
  assert.ok(inlineEnd > inlineStart);

  const inlineBlock = background.slice(
    inlineStart,
    inlineEnd
  );

  assert.match(
    inlineBlock,
    /resolveSourceFrameContext\s*\(\s*session\s*,\s*canonical\s*\)/
  );

  assert.match(
    inlineBlock,
    /documentId\s*:\s*sourceFrame\.documentId/
  );

  assert.match(
    inlineBlock,
    /frameId\s*:\s*sourceFrame\.frameId/
  );

  assert.match(
    inlineBlock,
    /documentUrl\s*:\s*sourceFrame\.documentUrl/
  );


  const externalStart = background.indexOf(
    'function indexExternalSource(tabId, payload) {'
  );

  const externalEnd = background.indexOf(
    'async function handlePageEvent',
    externalStart
  );

  assert.ok(externalStart >= 0);
  assert.ok(externalEnd > externalStart);

  const externalBlock = background.slice(
    externalStart,
    externalEnd
  );

  assert.match(
    externalBlock,
    /resolveSourceFrameContext\s*\(\s*session\s*,\s*payload\s*\)/
  );

  assert.match(
    externalBlock,
    /documentId\s*:\s*sourceFrame\.documentId/
  );

  assert.match(
    externalBlock,
    /frameId\s*:\s*sourceFrame\.frameId/
  );

  assert.match(
    externalBlock,
    /documentUrl\s*:\s*sourceFrame\.documentUrl/
  );

  // Frame provenance and fetch authorization are deliberately
  // different concepts. External source policy remains anchored
  // to the canonical top-level page.
  assert.match(
    externalBlock,
    /pageUrl\s*:\s*session\.pageUrl/
  );
});


test('same external source retains observations from multiple frames', async () => {
  const utils = await import('../src/session-utils.js');

  assert.equal(
    typeof utils.recordSourceObservation,
    'function',
    'recordSourceObservation must exist'
  );

  const source = {
    url: 'https://cdn.example.test/bundle.js'
  };

  utils.recordSourceObservation(
    source,
    {
      documentId: 'top-document',
      frameId: 0,
      documentUrl: 'https://app.example.test/page'
    },
    100
  );

  utils.recordSourceObservation(
    source,
    {
      documentId: 'child-document',
      frameId: 7,
      documentUrl: 'https://child.example.test/frame'
    },
    200
  );

  // Re-observing the same source from the same document/frame
  // updates that observation instead of creating a duplicate.
  utils.recordSourceObservation(
    source,
    {
      documentId: 'child-document',
      frameId: 7,
      documentUrl: 'https://child.example.test/frame'
    },
    300
  );

  assert.equal(source.observations.length, 2);

  assert.deepEqual(
    source.observations[0],
    {
      documentId: 'top-document',
      frameId: 0,
      documentUrl: 'https://app.example.test/page',
      firstObservedAt: 100,
      lastObservedAt: 100,
      count: 1
    }
  );

  assert.deepEqual(
    source.observations[1],
    {
      documentId: 'child-document',
      frameId: 7,
      documentUrl: 'https://child.example.test/frame',
      firstObservedAt: 200,
      lastObservedAt: 300,
      count: 2
    }
  );

  assert.equal(source.firstObservedAt, 100);
  assert.equal(source.lastObservedAt, 300);
});


test('external source dedupe preserves observations across frames', () => {
  const background = fs.readFileSync(
    new URL('../src/background.js', import.meta.url),
    'utf8'
  );

  assert.match(
    background,
    /recordSourceObservation/,
    'background must record source observations'
  );

  assert.match(
    background,
    /pendingSourceObservations/,
    'pending source fetches must retain observations'
  );

  const indexStart = background.indexOf(
    'function indexExternalSource(tabId, payload) {'
  );

  const indexEnd = background.indexOf(
    'async function collectExternalSource',
    indexStart
  );

  assert.ok(indexStart >= 0);
  assert.ok(indexEnd > indexStart);

  const indexBlock = background.slice(
    indexStart,
    indexEnd
  );

  assert.match(
    indexBlock,
    /resolveSourceFrameContext\s*\(\s*session\s*,\s*payload\s*\)/
  );

  assert.match(
    indexBlock,
    /existingSource/
  );

  assert.match(
    indexBlock,
    /recordSourceObservation\s*\(\s*existingSource\s*,\s*sourceFrame/
  );

  assert.match(
    indexBlock,
    /pendingSourceObservations/
  );


  const collectStart = indexEnd;

  const collectEnd = background.indexOf(
    'async function handlePageEvent',
    collectStart
  );

  assert.ok(collectEnd > collectStart);

  const collectBlock = background.slice(
    collectStart,
    collectEnd
  );

  assert.match(
    collectBlock,
    /pendingSourceObservations/
  );

  assert.match(
    collectBlock,
    /recordSourceObservation/
  );

  // Fetch authorization must still remain anchored to the
  // canonical top-level page, regardless of observing frame.
  assert.match(
    collectBlock,
    /pageUrl\s*:\s*session\.pageUrl/
  );
});


test('frame command routing keeps capture tab-wide and watches top-frame only', async () => {
  const utils = await import('../src/session-utils.js');

  assert.equal(
    typeof utils.commandTargetOptions,
    'function',
    'commandTargetOptions must exist'
  );

  assert.equal(
    utils.commandTargetOptions('START'),
    undefined
  );

  assert.equal(
    utils.commandTargetOptions('STOP'),
    undefined
  );

  assert.equal(
    utils.commandTargetOptions('REFRESH_SOURCES'),
    undefined
  );

  assert.deepEqual(
    utils.commandTargetOptions('WATCH_ADD'),
    { frameId: 0 }
  );

  assert.deepEqual(
    utils.commandTargetOptions('WATCH_SNAPSHOT'),
    { frameId: 0 }
  );

  assert.equal(
    utils.commandTargetOptions('UNKNOWN_COMMAND'),
    undefined
  );
});


test('background applies frame command routing to tabs.sendMessage', () => {
  const background = fs.readFileSync(
    new URL('../src/background.js', import.meta.url),
    'utf8'
  );

  assert.match(
    background,
    /commandTargetOptions/,
    'background must use commandTargetOptions'
  );

  const start = background.indexOf(
    'async function sendCommand('
  );

  assert.ok(start >= 0);

  const end = background.indexOf(
    '\n}',
    start
  );

  assert.ok(end > start);

  const block = background.slice(
    start,
    end + 2
  );

  assert.match(
    block,
    /const\s+targetOptions\s*=\s*commandTargetOptions\s*\(\s*command\s*\)/
  );

  assert.match(
    block,
    /chrome\.tabs\.sendMessage\s*\(\s*tabId\s*,[\s\S]*targetOptions\s*\)/
  );
});
