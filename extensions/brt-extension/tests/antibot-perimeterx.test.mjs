import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAntiBotRecord,
  detectProtectionsFromCookies,
  detectProtectionsFromHeaders
} from '../src/antibot.js';

import {
  detectProtections
} from '../src/antibot-analyzer.js';

const PX = 'PerimeterX';

test('opaque text containing Px3 does not become a PerimeterX anti-bot signal', () => {
  const result = classifyAntiBotRecord({
    kind: 'network-body',
    data: {
      text: `
        eyJwYXlsb2FkIjoiQWxwaGEifQ==
        arbitrary opaque payload segment Px3
        7f4a9d2c8b11
      `
    }
  });

  assert.equal(result.isAntiBotSignal, false);
  assert.equal(result.categories.includes('perimeterx'), false);
  assert.equal(
    result.evidence.some(item => item.includes('perimeterx')),
    false
  );
});

test('opaque page/source text containing Px3 does not detect PerimeterX', () => {
  const session = {
    network: [],
    timeline: [],
    sources: [
      {
        type: 'inline-script',
        url: 'https://example.test/app.js',
        text: 'const opaque = "abcDEF123Px3qwerty987";'
      }
    ],
    html: `
      <html>
        <body>
          <div data-state="ZXhhbXBsZVB4M3N0YXRl">
            ordinary content Px3 ordinary content
          </div>
        </body>
      </html>
    `
  };

  assert.equal(
    detectProtections(session).includes(PX),
    false
  );
});

test('_px3 cookie remains explicit PerimeterX provider evidence', () => {
  const protections =
    detectProtectionsFromCookies('_px3=abc123');

  assert.ok(protections.includes(PX));

  const result = classifyAntiBotRecord({
    kind: 'network-response',
    data: {
      cookies: '_px3=abc123'
    }
  });

  assert.ok(result.categories.includes('perimeterx'));
  assert.ok(result.evidence.includes(`provider:${PX}`));
});

test('PerimeterX response header remains explicit provider evidence', () => {
  const protections =
    detectProtectionsFromHeaders({
      'perimeterx-request-id': 'req-123'
    });

  assert.ok(protections.includes(PX));

  const result = classifyAntiBotRecord({
    kind: 'network-response',
    data: {
      responseHeaders: {
        'perimeterx-request-id': 'req-123'
      }
    }
  });

  assert.ok(result.categories.includes('perimeterx'));
  assert.ok(result.evidence.includes(`provider:${PX}`));
});

test('px-captcha URL remains PerimeterX evidence', () => {
  const session = {
    network: [
      {
        kind: 'network-request',
        wallTime: 1000,
        data: {
          url: 'https://collector.example.test/px-captcha/api/v1/check'
        }
      }
    ],
    timeline: [],
    sources: [],
    html: ''
  };

  assert.ok(
    detectProtections(session).includes(PX)
  );
});

test('explicit PerimeterX challenge endpoint remains a strong signal', () => {
  const result = classifyAntiBotRecord({
    kind: 'network-request',
    data: {
      url: 'https://example.test/perimeterx/api/v1/challenge/start'
    }
  });

  assert.equal(result.isAntiBotSignal, true);
  assert.ok(result.categories.includes('perimeterx'));
  assert.ok(
    result.endpointMatches.includes('perimeterx-challenge')
  );
});
