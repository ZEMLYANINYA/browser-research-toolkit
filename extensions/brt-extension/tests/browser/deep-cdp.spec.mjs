import { test, expect } from '@playwright/test';
import { launchBrtExtension } from './extension-fixture.mjs';
import { startDeepCdpServer } from './deep-cdp-server.mjs';

function cdpEvents(session, method) {
  return (session?.timeline || []).filter(item =>
    item?.kind === 'cdp-event' &&
    item?.data?.method === method
  );
}

async function getSession(brt, page) {
  const response = await brt.sendToActiveTab(page, {
    type: 'BRT_GET_SESSION'
  });

  return response?.session || null;
}

test('real Chromium preserves structured Deep CDP WebSocket evidence', async () => {
  const server = await startDeepCdpServer();
  const brt = await launchBrtExtension();

  try {
    const page = await brt.context.newPage();
    await page.goto(server.url + '/');

    await expect(page.locator('h1')).toHaveText('BRT deep CDP fixture');

    const start = await brt.sendToActiveTab(page, {
      type: 'BRT_START',
      mode: 'deep',
      antibot: false,
      preserveSession: true
    });

    expect(start?.ok).toBe(true);

    await expect.poll(async () => {
      const session = await getSession(brt, page);
      return session?.running === true &&
        session?.agentActive === true &&
        session?.cdpState === 'attached';
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    await page.evaluate(wsUrl => {
      window.__BRT_WS_URL__ = wsUrl;
    }, server.wsUrl);

    await page.evaluate(src => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('deep-script-load-failed'));
      document.head.appendChild(script);
    }), server.url + '/deep.js');

    const echoed = await page.evaluate(() => window.runDeepFixture());
    expect(echoed).toBe('echo:hello-brt');


    await expect.poll(async () => {
      const session = await getSession(brt, page);

      return cdpEvents(session, 'Debugger.scriptParsed').some(item =>
        String(item?.data?.script?.url || '').includes('/deep.js')
      );
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    await expect.poll(async () => {
      const session = await getSession(brt, page);

      const created = cdpEvents(session, 'Network.webSocketCreated')[0];
      const sent = cdpEvents(session, 'Network.webSocketFrameSent')[0];
      const received = cdpEvents(session, 'Network.webSocketFrameReceived')[0];

      return Boolean(
        created?.data?.websocket &&
        String(created.data.websocket.url || '').includes('/socket') &&
        sent?.data?.websocket &&
        sent.data.websocket.opcode === 1 &&
        sent.data.websocket.payloadLength === 9 &&
        received?.data?.websocket &&
        received.data.websocket.opcode === 1 &&
        received.data.websocket.payloadLength === 14
      );
    }, {
      timeout: 5000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const stop = await brt.sendToActiveTab(page, {
      type: 'BRT_STOP'
    });

    expect(stop?.ok).toBe(true);
  } finally {
    await brt.close();
    await server.close();
  }
});
