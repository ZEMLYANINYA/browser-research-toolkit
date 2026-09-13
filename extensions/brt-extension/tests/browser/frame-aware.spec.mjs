import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './local-server.mjs';
import { launchBrtExtension } from './extension-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const topRoot = resolve(
  here,
  '..', 'fixtures', 'frame-aware', 'top'
);

const childRoot = resolve(
  here,
  '..', 'fixtures', 'frame-aware', 'child'
);

async function getSession(brt, page) {
  const response = await brt.sendToActiveTab(page, {
    type: 'BRT_GET_SESSION'
  });

  return response?.session || null;
}

test('real Chromium preserves frame and document provenance across iframe navigation', async () => {
  const topServer = await startFixtureServer({
    root: topRoot,
    host: '127.0.0.1',
    port: 8123
  });

  const childServer = await startFixtureServer({
    root: childRoot,
    host: '127.0.0.2',
    port: 8124
  });

  const brt = await launchBrtExtension();

  try {
    const page = await brt.context.newPage();
    await page.goto(topServer.url + '/index.html');

    await expect(page.locator('#top-marker')).toHaveText('BRT TOP FRAME');

    const sameFrame = page.frameLocator('#same-origin-frame');
    await expect(sameFrame.locator('#same-fetch')).toBeVisible();

    const childFrame = page.frameLocator('#child-frame');
    await expect(childFrame.locator('#child-marker')).toHaveText('BRT CHILD FRAME');

    const start = await brt.sendToActiveTab(page, {
      type: 'BRT_START',
      mode: 'standard',
      antibot: false,
      preserveSession: true
    });

    expect(start?.ok).toBe(true);

    await expect.poll(async () => {
      const session = await getSession(brt, page);
      return session?.running === true && session?.agentActive === true;
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    await expect.poll(async () => {
      const session = await getSession(brt, page);
      const documents = session?.documents || [];

      const top = documents.find(item =>
        item?.frameId === 0 &&
        String(item?.url || '').includes('127.0.0.1:8123/index.html')
      );

      const same = documents.find(item =>
        String(item?.url || '').includes('127.0.0.1:8123/same-frame.html')
      );

      const child = documents.find(item =>
        String(item?.url || '').includes('127.0.0.2:8124/frame.html')
      );

      return Boolean(top && same && child);
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const initialSession = await getSession(brt, page);
    const initialDocuments = initialSession.documents || [];

    const topDocument = initialDocuments.find(item =>
      item?.frameId === 0 &&
      String(item?.url || '').includes('127.0.0.1:8123/index.html')
    );

    const sameDocument = initialDocuments.find(item =>
      String(item?.url || '').includes('127.0.0.1:8123/same-frame.html')
    );

    const childDocument = initialDocuments.find(item =>
      String(item?.url || '').includes('127.0.0.2:8124/frame.html')
    );

    expect(topDocument).toBeTruthy();
    expect(sameDocument).toBeTruthy();
    expect(childDocument).toBeTruthy();

    expect(topDocument.frameId).toBe(0);
    expect(sameDocument.frameId).not.toBe(0);
    expect(childDocument.frameId).not.toBe(0);
    expect(sameDocument.frameId).not.toBe(childDocument.frameId);

    expect(initialSession.activeDocumentId).toBe(topDocument.documentId);
    expect(initialSession.pageUrl).toContain('127.0.0.1:8123/index.html');

    const fetchPromise = page.waitForResponse(response =>
      response.url().includes('/frame-data.json')
    );

    await sameFrame.locator('#same-fetch').click();
    const fetchResponse = await fetchPromise;
    expect(fetchResponse.status()).toBe(200);

    await expect.poll(async () => {
      const session = await getSession(brt, page);

      return (session?.network || []).some(item =>
        item?.frameId === sameDocument.frameId &&
        item?.documentId === sameDocument.documentId &&
        String(item?.data?.url || '').includes('/frame-data.json')
      );
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    await expect.poll(async () => {
      const session = await getSession(brt, page);

      const shared = (session?.sources || []).find(source =>
        String(source?.url || '') === 'http://127.0.0.1:8123/shared.js'
      );

      if (!shared) return false;

      const frameIds = new Set(
        (shared.observations || []).map(item => item.frameId)
      );

      return frameIds.has(topDocument.frameId) &&
        frameIds.has(childDocument.frameId);
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    await childFrame.locator('#child-action').click();
    await expect(childFrame.locator('.child-generated')).toHaveCount(1);

    await childFrame.locator('#child-navigate').click();
    await expect(childFrame.locator('#child-marker-2')).toHaveText('BRT CHILD FRAME 2');

    await expect.poll(async () => {
      const session = await getSession(brt, page);

      return (session?.documents || []).some(item =>
        item?.frameId === childDocument.frameId &&
        item?.documentId !== childDocument.documentId &&
        String(item?.url || '').includes('127.0.0.2:8124/frame-2.html')
      );
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const navigatedSession = await getSession(brt, page);
    const replacementDocument = (navigatedSession.documents || []).find(item =>
      item?.frameId === childDocument.frameId &&
      item?.documentId !== childDocument.documentId &&
      String(item?.url || '').includes('127.0.0.2:8124/frame-2.html')
    );

    expect(replacementDocument).toBeTruthy();
    expect(replacementDocument.frameId).toBe(childDocument.frameId);
    expect(replacementDocument.documentId).not.toBe(childDocument.documentId);

    expect(navigatedSession.pageUrl).toContain('127.0.0.1:8123/index.html');
    expect(navigatedSession.activeDocumentId).toBe(topDocument.documentId);

    const stop = await brt.sendToActiveTab(page, {
      type: 'BRT_STOP'
    });

    expect(stop?.ok).toBe(true);
  } finally {
    await brt.close();
    await childServer.close();
    await topServer.close();
  }
});
