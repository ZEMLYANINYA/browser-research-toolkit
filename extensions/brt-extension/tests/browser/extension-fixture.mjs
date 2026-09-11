import { chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceExtensionPath = resolve(here, '..', '..');

async function stageExtension({ fixtureHostPermissions = true } = {}) {
  const stagedPath = await mkdtemp(join(tmpdir(), 'brt-extension-smoke-'));

  await cp(sourceExtensionPath, stagedPath, {
    recursive: true
  });

  const manifestPath = join(stagedPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  const fixtureHosts = fixtureHostPermissions === true
    ? [
        'http://127.0.0.1/*',
        'http://127.0.0.2/*'
      ]
    : Array.isArray(fixtureHostPermissions)
      ? fixtureHostPermissions
      : [];

  if (fixtureHosts.length) {
    manifest.host_permissions = fixtureHosts;
  }

  await writeFile(
    manifestPath,
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );

  return stagedPath;
}

export async function launchBrtExtension(options = {}) {
  const extensionPath = await stageExtension(options);

  let context;

  try {
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: options.headless !== false,
      args: [
        '--disable-extensions-except=' + extensionPath,
        '--load-extension=' + extensionPath
      ]
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');

    const workerUrl = new URL(worker.url());
    const extensionId = workerUrl.hostname;

    const controlPage = await context.newPage();
    await controlPage.goto('chrome-extension://' + extensionId + '/ui/panel.html');

    async function sendToActiveTab(fixturePage, message) {
      await fixturePage.bringToFront();

      return controlPage.evaluate(async payload => {
        return chrome.runtime.sendMessage(payload);
      }, message);
    }

    async function close() {
      try {
        await context.close();
      } finally {
        await rm(extensionPath, { recursive: true, force: true });
      }
    }

    return {
      context,
      worker,
      extensionId,
      controlPage,
      sendToActiveTab,
      close
    };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    await rm(extensionPath, { recursive: true, force: true });
    throw error;
  }
}
