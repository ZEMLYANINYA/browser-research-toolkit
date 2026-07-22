import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('the built IIFE bundle runs standalone in a page and exposes window.research', async () => {
  const bundleCode = readFileSync(new URL('../../dist/research-toolkit.bundle.js', import.meta.url), 'utf8');

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/bundle-check',
    runScripts: 'dangerously',
  });
  const { window } = dom;
  window.fetch = async () => ({
    headers: { get: () => null },
    status: 204,
    clone() {
      return this;
    },
    async text() {
      return '';
    },
  });

  const script = window.document.createElement('script');
  script.textContent = bundleCode;
  window.document.body.appendChild(script);

  assert.equal(typeof window.research, 'object', 'window.research should exist after the bundle runs');
  assert.equal(typeof window.research.getSummary, 'function');
  assert.equal(typeof window.research.exportData, 'function');
  assert.equal(typeof window.getResearchStats, 'function');

  const summary = window.research.getSummary();
  assert.equal(summary.status, 'active');

  window.research.cleanup();
});
