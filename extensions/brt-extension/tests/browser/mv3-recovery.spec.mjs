import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './local-server.mjs';
import { launchBrtExtension } from './extension-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(
  here,
  '..', '..', '..', '..',
  'artifacts', 'permission-smoke'
);

function dataRequests(session) {
  return (session?.network || []).filter(item =>
    item?.kind === 'network-request' &&
    String(item?.data?.url || '').includes('/data.json')
  );
}

async function getSession(brt, page) {
  const response = await brt.sendToActiveTab(page, {
    type: 'BRT_GET_SESSION'
  });

  return response?.session || null;
}

async function exportSession(brt, page) {
  const response = await brt.sendToActiveTab(page, {
    type: 'BRT_EXPORT_SESSION'
  });

  expect(response?.ok).toBe(true);
  return response?.session || null;
}

async function fetchFromFixture(page) {
  await page.bringToFront();

  const responsePromise = page.waitForResponse(response =>
    response.url().includes('/data.json')
  );

  await page.locator('#ping').click();
  const response = await responsePromise;

  expect(response.status()).toBe(200);
}

async function findBrtWorkerTarget(cdp, brt) {
  const result = await cdp.send('Target.getTargets');

  return result.targetInfos.find(target =>
    target.type === 'service_worker' &&
    target.url ===
      'chrome-extension://' + brt.extensionId + '/src/background.js'
  ) || null;
}

test('real Chromium recovers a durable session after MV3 worker restart', async () => {
  const server = await startFixtureServer({ root: fixtureRoot });
  const brt = await launchBrtExtension();
  let cdp = null;

  try {
    const page = await brt.context.newPage();
    await page.goto(server.url + '/index.html');
    await expect(page.locator('h1')).toHaveText('BRT permission smoke');

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

    await fetchFromFixture(page);

    await expect.poll(async () => {
      const session = await getSession(brt, page);
      return dataRequests(session).length >= 1;
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const durableBefore = await exportSession(brt, page);

    expect(durableBefore?.running).toBe(true);
    expect(dataRequests(durableBefore).length).toBeGreaterThanOrEqual(1);

    const sessionId = durableBefore.sessionId;
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);

    const browser = brt.context.browser();
    expect(browser).toBeTruthy();

    cdp = await browser.newBrowserCDPSession();

    const oldTarget = await findBrtWorkerTarget(cdp, brt);
    expect(oldTarget).toBeTruthy();

    const closeResult = await cdp.send('Target.closeTarget', {
      targetId: oldTarget.targetId
    });

    expect(closeResult?.success).toBe(true);

    await expect.poll(async () => {
      return (await findBrtWorkerTarget(cdp, brt)) === null;
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const recovered = await getSession(brt, page);

    expect(recovered?.sessionId).toBe(sessionId);
    expect(recovered?.running).toBe(true);
    expect(dataRequests(recovered).length).toBeGreaterThanOrEqual(1);

    expect(
      recovered.diagnostics.some(item =>
        item?.kind === 'indexeddb-session-recovered' &&
        item?.sessionId === sessionId
      )
    ).toBe(true);

    const workerAfterWake = await findBrtWorkerTarget(cdp, brt);
    expect(workerAfterWake).toBeTruthy();

    await fetchFromFixture(page);

    await expect.poll(async () => {
      const session = await getSession(brt, page);
      return session?.sessionId === sessionId &&
        dataRequests(session).length >= 2;
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const stop = await brt.sendToActiveTab(page, {
      type: 'BRT_STOP'
    });

    expect(stop?.ok).toBe(true);

    const durableAfter = await exportSession(brt, page);

    expect(durableAfter?.sessionId).toBe(sessionId);
    expect(durableAfter?.running).toBe(false);
    expect(durableAfter?.runState).toBe('stopped');
    expect(dataRequests(durableAfter).length).toBeGreaterThanOrEqual(2);

    expect(
      durableAfter.diagnostics.some(item =>
        item?.kind === 'indexeddb-session-recovered' &&
        item?.sessionId === sessionId
      )
    ).toBe(true);
  } finally {
    if (cdp) await cdp.detach().catch(() => {});
    await brt.close();
    await server.close();
  }
});
