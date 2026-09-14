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

test('real Chromium captures only inside an explicit BRT run', async () => {
  const server = await startFixtureServer({ root: fixtureRoot });
  const brt = await launchBrtExtension();

  try {
    const page = await brt.context.newPage();
    await page.goto(server.url + '/index.html');
    await expect(page.locator('h1')).toHaveText('BRT permission smoke');

    const before = await brt.sendToActiveTab(page, {
      type: 'BRT_GET_SESSION'
    });

    expect(before).toHaveProperty('session');
    expect(before.session?.running === true).toBe(false);

    const start = await brt.sendToActiveTab(page, {
      type: 'BRT_START',
      mode: 'standard',
      antibot: false,
      preserveSession: true
    });

    expect(start?.ok).toBe(true);
    expect(Number.isInteger(start?.tabId)).toBe(true);

    await expect.poll(async () => {
      const response = await brt.sendToActiveTab(page, {
        type: 'BRT_GET_SESSION'
      });

      return response?.session?.running === true &&
        response?.session?.agentActive === true;
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    await page.bringToFront();

    const responsePromise = page.waitForResponse(response =>
      response.url().includes('/data.json')
    );

    await page.locator('#ping').click();
    const fixtureResponse = await responsePromise;

    expect(fixtureResponse.status()).toBe(200);

    await expect.poll(async () => {
      const response = await brt.sendToActiveTab(page, {
        type: 'BRT_GET_SESSION'
      });

      const session = response?.session;
      if (!session?.running) return false;

      return Array.isArray(session.network) &&
        session.network.some(item =>
          String(item?.data?.url || '').includes('/data.json')
        );
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const stop = await brt.sendToActiveTab(page, {
      type: 'BRT_STOP'
    });

    expect(stop?.ok).toBe(true);

    const stopped = await brt.sendToActiveTab(page, {
      type: 'BRT_GET_SESSION'
    });

    expect(stopped?.session?.running).toBe(false);
    expect(stopped?.session?.runState).toBe('stopped');
  } finally {
    await brt.close();
    await server.close();
  }
});

test('capture host permission preserves same-host hard navigation and cross-host navigation still fails closed', async () => {
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

  const brt = await launchBrtExtension({
    fixtureHostPermissions: [],
    headless: false
  });

  try {
    const page = await brt.context.newPage();
    await page.goto(topServer.url + '/index.html');
    await expect(page.locator('#top-marker')).toHaveText('BRT TOP FRAME');

    const hostPattern = 'http://127.0.0.1/*';

    const permissionBefore = await brt.controlPage.evaluate(
      async pattern => chrome.permissions.contains({ origins: [pattern] }),
      hostPattern
    );

    expect(permissionBefore).toBe(false);

    await brt.controlPage.evaluate(pattern => {
      const button = document.createElement('button');
      button.id = 'capture-host-permission-grant';
      button.textContent = 'Grant capture host';

      button.addEventListener('click', async () => {
        try {
          const granted = await chrome.permissions.request({
            origins: [pattern]
          });

          window.__captureHostGrant = {
            done: true,
            granted
          };
        } catch (error) {
          window.__captureHostGrant = {
            done: true,
            granted: false,
            error: String(error?.message || error)
          };
        }
      });

      document.body.append(button);
    }, hostPattern);

    await brt.controlPage.locator('#capture-host-permission-grant').click();

    await expect.poll(async () => {
      return brt.controlPage.evaluate(() =>
        window.__captureHostGrant?.done === true
      );
    }, {
      timeout: 15000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const grant = await brt.controlPage.evaluate(() =>
      window.__captureHostGrant
    );

    expect(grant?.granted).toBe(true);

    const permissionAfter = await brt.controlPage.evaluate(
      async pattern => chrome.permissions.contains({ origins: [pattern] }),
      hostPattern
    );

    expect(permissionAfter).toBe(true);

    await page.bringToFront();

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

    const initialSession = await getSession(brt, page);
    const sessionId = initialSession?.sessionId;

    expect(sessionId).toBeTruthy();

    await page.goto(topServer.url + '/same-frame.html');
    await expect(page.locator('h2')).toHaveText('BRT SAME ORIGIN FRAME');

    await expect.poll(async () => {
      const session = await getSession(brt, page);

      return session?.sessionId === sessionId &&
        session?.running === true &&
        session?.agentActive === true &&
        String(session?.pageUrl || '').includes('/same-frame.html');
    }, {
      timeout: 8000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const afterSameHost = await getSession(brt, page);

    expect(
      afterSameHost?.diagnostics?.some(item =>
        item?.kind === 'capture-continuity-lost'
      )
    ).toBe(false);

    const fetchPromise = page.waitForResponse(response =>
      response.url().includes('/frame-data.json')
    );

    await page.locator('#same-fetch').click();
    expect((await fetchPromise).status()).toBe(200);

    await expect.poll(async () => {
      const session = await getSession(brt, page);

      return session?.network?.some(item =>
        item?.kind === 'network-request' &&
        String(item?.data?.url || '').includes('/frame-data.json')
      );
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    await page.goto(childServer.url + '/frame.html');
    await expect(page.locator('#child-marker')).toHaveText('BRT CHILD FRAME');

    await expect.poll(async () => {
      const session = await getSession(brt, page);

      return session?.sessionId === sessionId &&
        session?.running === false &&
        session?.runState === 'interrupted' &&
        session?.diagnostics?.some(item =>
          item?.kind === 'capture-continuity-lost' &&
          item?.reason === 'top-frame-injection-unavailable' &&
          String(item?.url || '').includes('127.0.0.2:8124')
        );
    }, {
      timeout: 8000,
      intervals: [100, 200, 500]
    }).toBe(true);
  } finally {
    await brt.close();
    await childServer.close();
    await topServer.close();
  }
});
