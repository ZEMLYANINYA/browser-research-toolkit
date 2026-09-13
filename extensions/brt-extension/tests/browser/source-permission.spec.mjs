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

const childOriginPattern = 'http://127.0.0.2:8124/*';

async function getSession(brt, page) {
  const response = await brt.sendToActiveTab(page, {
    type: 'BRT_GET_SESSION'
  });

  return response?.session || null;
}

test('headed Chromium grants optional host permission and BRT applies it', async () => {
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
    fixtureHostPermissions: [
      'http://127.0.0.1/*'
    ],
    headless: false
  });

  try {
    const page = await brt.context.newPage();
    await page.goto(topServer.url + '/index.html');
    await expect(page.locator('#top-marker')).toHaveText('BRT TOP FRAME');

    const start = await brt.sendToActiveTab(page, {
      type: 'BRT_START',
      mode: 'standard',
      antibot: false,
      preserveSession: true
    });

    expect(start?.ok).toBe(true);

    await page.evaluate(() => {
      const script = document.createElement('script');
      script.src = 'http://127.0.0.2:8124/child-only.js';
      script.dataset.brtPermissionSmoke = 'true';
      document.head.append(script);
    });

    const refresh = await brt.sendToActiveTab(page, {
      type: 'BRT_REFRESH_SOURCES'
    });

    expect(refresh?.ok).toBe(true);
    await expect.poll(async () => {
      const session = await getSession(brt, page);

      return (session?.sources || []).some(source =>
        String(source?.url || '').includes('127.0.0.2:8124/child-only.js') &&
        source?.indexed === false &&
        source?.fetchPolicy?.decision === 'blocked' &&
        source?.fetchPolicy?.reason === 'third-party-disabled'
      );
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const permissionBefore = await brt.controlPage.evaluate(async pattern => {
      return chrome.permissions.contains({ origins: [pattern] });
    }, childOriginPattern);

    expect(permissionBefore).toBe(false);

    /*
     * The smoke harness opens panel.html as a normal extension tab,
     * not as Chrome's real side panel. Clicking the production
     * permission button here would make that extension tab active
     * before background activeTab() runs.
     *
     * Exercise the real Chrome user-gesture permission API first,
     * then return authority to the fixture tab and exercise BRT's
     * independently verified permission-application path below.
     */
    await brt.controlPage.evaluate(pattern => {
      const button = document.createElement('button');
      button.id = 'headed-permission-grant';
      button.textContent = 'Grant third-party source host';

      button.addEventListener('click', async () => {
        try {
          const granted = await chrome.permissions.request({
            origins: [pattern]
          });

          window.__headedPermissionGrant = {
            done: true,
            granted
          };
        } catch (error) {
          window.__headedPermissionGrant = {
            done: true,
            granted: false,
            error: String(error?.message || error)
          };
        }
      });

      document.body.append(button);
    }, childOriginPattern);

    await brt.controlPage.locator('#headed-permission-grant').click();

    await expect.poll(async () => {
      return brt.controlPage.evaluate(() =>
        window.__headedPermissionGrant?.done === true
      );
    }, {
      timeout: 15000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const grantResult = await brt.controlPage.evaluate(() =>
      window.__headedPermissionGrant
    );

    expect(grantResult?.granted).toBe(true);

    const permissionAfter = await brt.controlPage.evaluate(async pattern => {
      return chrome.permissions.contains({ origins: [pattern] });
    }, childOriginPattern);

    expect(permissionAfter).toBe(true);

    const applied = await brt.sendToActiveTab(page, {
      type: 'BRT_SET_SOURCE_HOST_PERMISSION',
      originPattern: childOriginPattern,
      granted: true
    });

    expect(applied?.ok).toBe(true);
    expect(applied?.granted).toBe(true);
    expect(applied?.originPattern).toBe(childOriginPattern);

    await expect.poll(async () => {
      const session = await getSession(brt, page);
      const hosts = session?.captureSettings?.thirdPartySourceHosts || [];

      const indexed = (session?.sources || []).some(source =>
        String(source?.url || '').includes('127.0.0.2:8124/child-only.js') &&
        source?.indexed === true &&
        source?.status === 200 &&
        Number(source?.bytesRead || 0) > 0 &&
        typeof source?.text === 'string' &&
        source.text.length > 0
      );

      return hosts.includes(childOriginPattern) &&
        session?.captureSettings?.thirdPartySources === true &&
        indexed;
    }, {
      timeout: 8000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const finalSession = await getSession(brt, page);

    expect(
      finalSession.diagnostics.some(item =>
        item?.kind === 'optional-host-permission-granted' &&
        item?.originPattern === childOriginPattern
      )
    ).toBe(true);

    expect(
      finalSession.diagnostics.some(item =>
        item?.kind === 'source-fetch-summary' &&
        item?.host === '127.0.0.2' &&
        item?.status === 200 &&
        Number(item?.count || 0) >= 1 &&
        Number(item?.totalBytes || 0) > 0 &&
        String(item?.lastUrl || '').includes('127.0.0.2:8124/child-only.js')
      )
    ).toBe(true);

    const staleBlocked = finalSession.sources.some(source =>
      String(source?.url || '').includes('127.0.0.2:8124/child-only.js') &&
      source?.fetchPolicy?.decision === 'blocked'
    );

    expect(staleBlocked).toBe(false);

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
