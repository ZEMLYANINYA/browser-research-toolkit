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
