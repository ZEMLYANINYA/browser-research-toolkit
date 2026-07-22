import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollectorContext } from '../../dist/context.js';
import { mergeConfig } from '../../dist/config.js';

test('websockets store stays bounded even with many unique connections (regression: was an uncapped Map)', () => {
  const ctx = new CollectorContext(mergeConfig({ maxWebSockets: 10 }));

  for (let i = 0; i < 500; i++) {
    ctx.websockets.set(`ws_${i}`, {
      id: `ws_${i}`,
      type: 'websocket',
      url: `wss://example.test/socket/${i}`,
      timestamp: Date.now(),
      messages: [],
      state: 'open',
    });
  }

  assert.equal(ctx.websockets.size, 10, 'websockets store should never exceed maxWebSockets');
});

test('performanceData stays bounded even with many unique tile-like URLs (regression: this is what blew up on Google Maps)', () => {
  const ctx = new CollectorContext(mergeConfig({ maxPerformanceEntries: 20 }));

  // Simulate panning/zooming a tile-based map: thousands of unique URLs, all
  // matching the default "map"/"tile" keywords, all previously kept forever.
  for (let i = 0; i < 5000; i++) {
    const url = `https://maps.example.test/vt/tile?x=${i}&y=${i}&z=14`;
    ctx.performanceData.set(url, {
      name: url,
      duration: 12.3,
      timestamp: Date.now(),
    });
  }

  assert.equal(ctx.performanceData.size, 20, 'performanceData should never exceed maxPerformanceEntries');
});
