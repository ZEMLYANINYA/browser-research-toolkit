import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAntiBotRecord,
  detectChallengePage,
  detectProtectionsFromCookies
} from '../src/antibot.js';

import {
  detectProtections
} from '../src/antibot-analyzer.js';

const F5 = 'F5 BIG-IP / Advanced WAF';

test('F5 cookies are recognized as provider evidence', () => {
  const samples = [
    'TSPD_101=abc123',
    'TS01234567=abc123',
    'BIGipServerpool_app=rd1o00000000000000000000ffff0a000001o80'
  ];

  for (const cookie of samples) {
    const protections = detectProtectionsFromCookies(cookie);

    assert.ok(
      protections.includes(F5),
      `expected F5 evidence for cookie: ${cookie}`
    );
  }
});

test('BIGipServer cookie alone is infrastructure evidence, not a strong anti-bot signal', () => {
  const result = classifyAntiBotRecord({
    kind: 'network-response',
    data: {
      cookies: 'BIGipServerpool_app=rd1o00000000000000000000ffff0a000001o80'
    }
  });

  assert.equal(result.isAntiBotSignal, false);
  assert.ok(result.evidence.includes(`provider:${F5}`));
});

test('/TSPD endpoint is strong F5 challenge evidence', () => {
  const result = classifyAntiBotRecord({
    kind: 'network-request',
    data: {
      url: 'https://example.test/TSPD/?type=21'
    }
  });

  assert.equal(result.isAntiBotSignal, true);
  assert.ok(result.categories.includes('f5'));
  assert.ok(result.categories.includes('challenge'));
  assert.ok(result.endpointMatches.includes('f5-tspd'));
});

test('F5 reject page with support ID is detected as a challenge page', () => {
  const html = `
    <html>
      <body>
        The requested URL was rejected.
        Please consult with your administrator.
        Your support ID is: 1234567890123456789
      </body>
    </html>
  `;

  assert.equal(detectChallengePage(html), true);
});

test('F5 reject page contributes provider detection', () => {
  const session = {
    network: [],
    timeline: [],
    sources: [],
    html: `
      The requested URL was rejected.
      Your support ID is: 1234567890123456789
    `
  };

  assert.ok(detectProtections(session).includes(F5));
});

test('ordinary page does not produce F5 evidence', () => {
  const session = {
    network: [],
    timeline: [],
    sources: [],
    html: '<html><body>Product catalogue</body></html>'
  };

  assert.equal(detectChallengePage(session.html), false);
  assert.equal(detectProtections(session).includes(F5), false);
});
test('F5 reject page in network body is classified as strong provider evidence', () => {
  const result = classifyAntiBotRecord({
    kind: 'network-body',
    data: {
      text: `
        <html>
          <body>
            The requested URL was rejected.
            Please consult with your administrator.
            Your support ID is: 1234567890123456789
          </body>
        </html>
      `
    }
  });

  assert.equal(result.isAntiBotSignal, true);
  assert.ok(result.categories.includes('f5'));
  assert.ok(result.categories.includes('challenge'));
  assert.ok(result.evidence.includes('matched:f5-reject-page'));
});

test('F5 reject page from network body contributes provider detection without session.html', () => {
  const session = {
    network: [
      {
        kind: 'network-body',
        data: {
          text: `
            The requested URL was rejected.
            Your support ID is: 1234567890123456789
          `
        }
      }
    ],
    timeline: [],
    sources: [],
    html: ''
  };

  assert.ok(detectProtections(session).includes(F5));
});

test('F5 reject detection allows long text between rejection and support ID phrases', () => {
  const body = `
    The requested URL was rejected.
    ${'x'.repeat(7000)}
    Your support ID is: 1234567890123456789
  `;

  assert.equal(detectChallengePage(body), true);

  const session = {
    network: [],
    timeline: [],
    sources: [],
    html: body
  };

  assert.ok(detectProtections(session).includes(F5));
});

test('F5 reject detection requires both characteristic phrases', () => {
  assert.equal(
    detectChallengePage('The requested URL was rejected.'),
    false
  );

  assert.equal(
    detectChallengePage('Your support ID is: 123456789'),
    false
  );
});


test('F5 reject detection is independent of phrase order', () => {
  const body = `
    Your support ID is: 1234567890123456789
    Some explanatory text.
    The requested URL was rejected.
  `;

  assert.equal(detectChallengePage(body), true);

  const result = classifyAntiBotRecord({
    kind: 'network-body',
    data: { text: body }
  });

  assert.equal(result.isAntiBotSignal, true);
  assert.ok(result.categories.includes('f5'));
  assert.ok(result.categories.includes('challenge'));
});
