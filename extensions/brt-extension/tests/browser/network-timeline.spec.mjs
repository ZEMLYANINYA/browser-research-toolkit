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

async function getSession(brt, page) {
  const response = await brt.sendToActiveTab(page, {
    type: 'BRT_GET_SESSION'
  });

  return response?.session || null;
}

test('real Chromium correlates a trusted click with its fetch request', async () => {
  const server = await startFixtureServer({ root: fixtureRoot });
  const brt = await launchBrtExtension();

  try {
    const page = await brt.context.newPage();
    await page.goto(server.url + '/index.html');
    await expect(page.locator('#ping')).toBeVisible();

    const start = await brt.sendToActiveTab(page, {
      type: 'BRT_START',
      mode: 'standard',
      antibot: false,
      preserveSession: true
    });

    expect(start?.ok).toBe(true);

    await expect.poll(async () => {
      const session = await getSession(brt, page);

      return session?.running === true &&
        session?.agentActive === true;
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
      const session = await getSession(brt, page);
      const timeline = session?.timeline || [];
      const network = session?.network || [];

      const interaction = timeline.find(item =>
        item?.kind === 'dom-event' &&
        item?.data?.type === 'click' &&
        item?.data?.target?.selectorHint === 'button#ping' &&
        item?.data?.isTrusted === true
      );

      const request = network.find(item =>
        item?.kind === 'network-request' &&
        item?.data?.transport === 'fetch' &&
        String(item?.data?.url || '').includes('/data.json')
      );

      if (!interaction || !request) return false;

      return (session?.correlations || []).some(item =>
        item?.fromEventId === interaction.eventId &&
        item?.toEventId === request.eventId
      );
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const session = await getSession(brt, page);

    const interaction = session.timeline.find(item =>
      item?.kind === 'dom-event' &&
      item?.data?.type === 'click' &&
      item?.data?.target?.selectorHint === 'button#ping' &&
      item?.data?.isTrusted === true
    );

    const request = session.network.find(item =>
      item?.kind === 'network-request' &&
      item?.data?.transport === 'fetch' &&
      String(item?.data?.url || '').includes('/data.json')
    );

    expect(interaction).toBeTruthy();
    expect(request).toBeTruthy();

    expect(interaction.sessionId).toBe(request.sessionId);
    expect(interaction.documentId).toBe(request.documentId);
    expect(interaction.frameId).toBe(request.frameId);
    expect(interaction.frameId).toBe(0);

    expect(request.data.method).toBe('GET');
    expect(request.data.transport).toBe('fetch');
    expect(request.data.firstParty).toBe(true);
    expect(request.data.url).toContain('/data.json');

    const timelineRequest = session.timeline.find(item =>
      item?.eventId === request.eventId
    );

    expect(timelineRequest).toBeTruthy();
    expect(interaction.label).toBe('click button#ping');
    expect(timelineRequest.label).toContain('fetch GET');
    expect(timelineRequest.label).toContain('/data.json');

    const relationship = session.correlations.find(item =>
      item?.fromEventId === interaction.eventId &&
      item?.toEventId === request.eventId
    );

    expect(relationship).toBeTruthy();
    expect(relationship.ruleId).toBe('dom-to-network-proximity-v2');
    expect(relationship.ruleVersion).toBe('2');
    expect(relationship.status).toBe('candidate');
    expect(relationship.manualStatus).toBe('unreviewed');

    expect(relationship.fromSequence).toBe(interaction.sequence);
    expect(relationship.toSequence).toBe(request.sequence);

    expect(relationship.evidence).toContain('same session');
    expect(relationship.evidence).toContain('same document');
    expect(relationship.evidence).toContain('same frame');
    expect(relationship.evidence).toContain('event reported isTrusted=true');

    expect(relationship.metrics.sequenceGap).toBeGreaterThanOrEqual(0);
    expect(relationship.metrics.sequenceGap).toBeLessThanOrEqual(8);
    expect(relationship.metrics.wallTimeDeltaMs).toBeGreaterThanOrEqual(0);
    expect(relationship.metrics.wallTimeDeltaMs).toBeLessThanOrEqual(1500);

    const stop = await brt.sendToActiveTab(page, {
      type: 'BRT_STOP'
    });

    expect(stop?.ok).toBe(true);
  } finally {
    await brt.close();
    await server.close();
  }
});
