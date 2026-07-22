# Browser Research Toolkit

[![CI](https://github.com/ZEMLYANINYA/browser-research-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZEMLYANINYA/browser-research-toolkit/actions/workflows/ci.yml)

A redaction-first network & DOM instrumentation collector for the browser.
Wraps `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, and `EventSource`,
plus DOM/storage/performance/navigation observers, and gives you a small
console API to inspect what a page is actually doing under the hood.

Originally a single 1300-line script (`v3.0`, JS). This is a full rewrite:
strict TypeScript, one responsibility per module, no global monkey-patching
left un-restorable.

## Why this exists

Started as a one-off script to answer "what API is this page actually
calling" during frontend research. It kept growing feature by feature until
it was a 1300-line IIFE where every concern — network capture, redaction,
storage, DOM mutations, export — lived in one class. Good enough to run,
bad to extend or test. This rewrite is that refactor: same behavior, but
each concern is now its own module with an explicit interface.

## Architecture

```
src/
  types.ts                        shared interfaces
  config.ts                       defaults + sensitive-data patterns
  context.ts                      shared state/services, built once, injected everywhere
  sanitize/sanitizer.ts           all redaction logic in one place
  storage/bounded-store.ts        generic FIFO+TTL store (replaces duplicated rotation code)
  logging/logger.ts               console output + error history
  interceptors/                   fetch, XHR, WebSocket, beacon, EventSource, dynamic DOM resources
  monitors/                       DOM events, errors, storage/cookies, performance, global objects,
                                   mutations, SPA navigation (pushState/replaceState/popstate/hashchange)
  analysis/response-analyzer.ts   parse-then-redact response handling, endpoint registration + dedup
  analysis/request-fingerprint.ts normalized request identity for de-duplication
  export/exporter.ts              JSON export as downloadable file
  collector.ts                    composition root — wires everything, public API
  index.ts                        entry point (window.research + helpers)
```

Each interceptor/monitor implements a small interface (`install()` /
`restore()` or `teardown()`) and depends only on `CollectorContext` — not on
each other or on the composition root. That's what makes it possible to
add a new interceptor without touching anything else.

## What changed from the original script

- **Redaction stays default-on.** API keys, tokens, passwords, auth
  headers, and cookie-like values are masked before anything is stored —
  not an opt-in flag.
- **Parse-then-redact for JSON, not redact-then-maybe-parse.** A structured
  response is parsed first and redacted *by field* (a key named `phone` or
  `token` gets masked, sibling fields survive); the old whole-body check —
  block everything if any sensitive word appears *anywhere* in the raw
  text — now only runs as a fallback when there's no JSON structure to work
  with at all. Confirmed on a real capture: the old order was blacking out
  entire Google Maps place-detail responses (the single most useful
  endpoint in the session) purely because "phone" appeared somewhere in the
  body.
- **Request de-duplication.** Repeated calls to the same endpoint (same
  method + path + parameter *names*, ignoring cache-busting/session
  params) collapse into one entry with a `duplicateCount`, instead of each
  call eating a slot in the (capped) endpoints store.
- **Configurable noise filtering (`excludeRules`).** Regexes tested against
  the full URL; a match is counted in aggregate instead of taking an
  endpoint slot. Empty by default — site-specific patterns (e.g. a
  telemetry endpoint) are something you supply via `window.RESEARCH_CONFIG`
  for the site you're on, not baked into the published defaults.
- **`google`/`gm`/maps-specific defaults are gone.** Endpoint keywords and
  watched global objects are plain config (`keywords`, `globalObjectNames`),
  not hardcoded to one site.
- **SPA navigation tracking.** `pushState`/`replaceState`/`popstate`/
  `hashchange` are all recorded — `beforeunload` never fires on an in-app
  navigation, so nothing else here would otherwise notice one happened.
- **Input-field protection.** Password/email/tel fields and
  `autocomplete=one-time-code|current-password|new-password` never have
  their value *or* individual keystrokes recorded, regardless of content —
  the old check only inspected the accumulated value string, which still
  let every keypress into a password field through.
- **Beacon/EventSource/dynamic-resource/mutation discoveries are now
  actually stored**, not just printed to the console — they used to be
  console-only, meaning `exportData()` silently omitted them.
- **EventSource messages are captured at all.** The old version only
  logged the connection being opened; incoming server-sent events were
  never listened for.
- **Duplicated rotation logic (`rotateEndpoints`, `rotateJsonResponses`)
  collapsed into one generic `BoundedStore`**, with a `prune()` you can
  call before a read instead of only rotating on insert.
- **All patched globals are restorable, and stay restored.** `cleanup()`
  puts back the original `fetch`, `XMLHttpRequest` (including
  `setRequestHeader`, which the original didn't intercept at all),
  `WebSocket`, `sendBeacon`, `EventSource`, `Storage.prototype.setItem`,
  `Element.prototype` methods, and `history.pushState`/`replaceState` —
  and cancels the delayed performance-history scan so nothing fires after
  cleanup has already run.

## Usage

```bash
npm install
npm run build
```

`dist/research-toolkit.bundle.js` is a single IIFE — paste it into DevTools
console, or load it as a content script. `dist/index.js` is the ESM build
if you want to import `ResearchCollector` directly.

```js
window.RESEARCH_CONFIG = {
  logLevel: 'debug',
  keywords: ['api', 'graphql'],
  excludeRules: [/\/log204/i, /\/gen_204/i], // site-specific noise, not shipped as a default
};
// then load the bundle
research.getSummary();       // includes a `noise` section: how much was filtered, and by which rule
research.getExcludedStats(); // same noise stats on their own
research.exportData();
research.cleanup();          // restores every patched global, cancels pending timers
```

## Testing

```bash
npm install
npm run build
npm test
```

16 tests across three layers:
- **Unit** (`tests/unit/`) — `Sanitizer`, `BoundedStore`/`BoundedList`, and the unbounded-collection
  regression tests, all in isolation, no DOM.
- **Integration** (`tests/integration/`) — `ResearchCollector` wired up against a `jsdom` page with a
  mocked `fetch`: dedup, `excludeRules`, parse-then-redact behavior, and SPA navigation in one scenario;
  a separate file targeting the specific fixes (input-field protection, `setRequestHeader` capture,
  `fetch(new Request(...))`); and one that loads the actual built `dist/research-toolkit.bundle.js` into
  a page and checks `window.research` comes up correctly.

To check it against a real page instead of the test suite: `npm run build`, open any site's DevTools
console, paste the contents of `dist/research-toolkit.bundle.js`, then run `research.getSummary()`
while browsing — endpoints and JSON responses should populate as the page makes requests.

## Known limitations

- **Redaction is name-based, not content-based.** JSON is now redacted *by field name* rather than
  wholesale (see above) — but a secret sitting in a *value* under an innocuous key name (e.g.
  `{"data": "<raw token that doesn't contain the word token>"}`) still isn't caught by either the
  field-name check or the plain-text fallback. Don't rely on this as a complete secret-detection tool —
  it catches obviously-named fields, not arbitrary embedded secrets.
- **Bugs fixed during the rewrite** (found via testing — real capture against Google Maps in several
  cases — all existed in the original 1300-line script too):
  - `console.error` patch called back into its own logging method, which itself called `console.error` —
    infinite recursion the moment any error fired after the collector attached. Fixed by capturing the
    real `console.error` once at startup.
  - Query-param redaction (`?apiKey=...`) was case-sensitive against a lowercase list — `apiKey`/`API_KEY`
    slipped through, only exact-case `apikey` was caught.
  - `websockets` and `performanceData` were plain `Map`s with no eviction. On a tile-based SPA,
    `performanceData` (keyed by resource URL) grew by one entry per unique tile URL ever loaded — forever,
    for the life of the tab, until the page became unresponsive. Both now go through the same
    `BoundedStore` everything else does.
  - `analyzeXhrResponse` returned early on a sensitive-looking body *before* the line that registered the
    URL as an endpoint — a request whose response merely looked sensitive was silently missing from
    `getEndpoints()` even though the URL itself was fine to record.
  - The exporter hard-truncated to the last 100 network requests / 20 events per type, *on top of* the
    caps already enforced upstream — a session with hundreds of requests in memory only ever exported a
    fraction of them.
  - `xhr.setRequestHeader()` was never intercepted, so XHR request headers were invisible to the
    collector entirely (fetch's `options.headers` worked fine — XHR's equivalent didn't exist).
  - `fetch(new Request(url, opts))` — the single-argument form — lost the method and headers, since the
    interceptor only ever read the second argument.
  - A `setTimeout` scheduled in `init()` to scan pre-existing performance entries wasn't cancelled by
    `cleanup()` — it could still fire against torn-down state after cleanup had already "restored
    everything."
  - Storage item size was computed with `.length` (UTF-16 code units), not actual byte size — now uses
    `new Blob([value]).size`.
  - Bare `navigator.*` references (in the beacon interceptor, the exporter's `userAgent` field, and the
    auto-export-on-unload path) crashed under Node 20 — Node didn't have a global `navigator` at all before
    v21, so it's simply absent on the 20.x line. Always safe in a real browser; this is the first bug the
    CI matrix itself caught (Node 22.x passed, 20.x didn't) rather than local testing.

## Lessons learned

The original script worked, but every new capability meant scrolling
through one file to find the right spot. This version cost more time
up front (interfaces, dependency wiring) and pays it back the moment you
want to add or test a single interceptor in isolation — and in practice,
during this rewrite: every non-obvious bug above was caught by a test
before it was caught by a real browser session.

## AI-assisted development

This project was developed using AI-assisted development. Architecture,
research, validation, debugging, testing, technical decisions and iterative
redesign were performed by the project author. AI was used as an
engineering assistant rather than a replacement for software design.

## Disclaimer

For frontend/API research on pages you're authorized to inspect. It's a
passive observability tool — it does not evade bot detection, spoof
fingerprints, or bypass access controls.

## License

MIT
