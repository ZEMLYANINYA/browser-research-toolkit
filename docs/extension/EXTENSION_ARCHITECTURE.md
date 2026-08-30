# BRT Extension Architecture

## Purpose

The Browser Research Toolkit extension is a Manifest V3 research front end for the Browser Research Toolkit project. It
collects bounded evidence about what a browser page is doing and presents that evidence in a side-panel dashboard. The
architecture is designed around three properties:

1. **Local-first operation**: no BRT-operated remote backend or telemetry path.
2. **Redaction-first storage**: common credentials/session material are masked before retained evidence is written.
3. **Provenance-aware evidence**: page-observable, extension-controlled, and browser-controlled evidence are not treated as
   equivalent.

The extension is intentionally separate from the existing TypeScript core. The repository may evolve both components on
independent version lines.

## Top-level components

```text
+-----------------------------------------------------------------------+
|                           Captured page                               |
|                                                                       |
|  MAIN world: page-agent.js                                            |
|  - fetch/XHR observation                                              |
|  - WebSocket/EventSource observation                                  |
|  - DOM/navigation/runtime/performance/source sensors                  |
|  - redaction before page->extension transport                         |
+-------------------------------+---------------------------------------+
                                |
                                | window.postMessage
                                | integrity = page-observable
                                v
+-----------------------------------------------------------------------+
|  Isolated content script: content-bridge.js                           |
|  - event-kind allowlist                                               |
|  - required envelope checks                                           |
|  - serialized payload size bound                                      |
|  - source-url observation check                                       |
+-------------------------------+---------------------------------------+
                                |
                                | chrome.runtime.sendMessage
                                v
+-----------------------------------------------------------------------+
|  MV3 service worker: background.js                                    |
|                                                                       |
|  Session lifecycle        TaskRunner / RateLimiter                    |
|  Storage/backpressure     Source-fetch policy/indexing                 |
|  Correlation/inference    Anti-bot classification                     |
|  Runtime search           Diagnostics                                 |
|                                                                       |
|               + optional chrome.debugger / CDP                        |
+-------------------------------+---------------------------------------+
                                |
                                | chrome.runtime
                                v
+-----------------------------------------------------------------------+
|  Side panel: ui/panel.html + panel.js + dashboard-metrics.js          |
|  - overview / timeline / network / sources                            |
|  - correlation graph / diagnostics / anti-bot                         |
|  - task state / session dump / search                                 |
+-----------------------------------------------------------------------+
```

## Runtime files

### `manifest.json`

Defines the MV3 service worker, side panel, top-frame MAIN-world page agent, isolated content bridge, required permissions, and
repository homepage.

### `src/page-agent.js`

Runs in the page MAIN world. This is the only component that directly observes and wraps page JavaScript APIs.

Its responsibilities include:

- `fetch` request/response/body observation.
- XHR open/send/header observation.
- WebSocket and EventSource lifecycle/body observation.
- `sendBeacon` observation.
- SPA navigation observation.
- DOM interactions, mutation evidence, and protected-input handling.
- runtime snapshots and explicit watches.
- inline/external script discovery.
- performance observation.
- passive anti-bot DOM/timer signals when enabled.
- restoration of wrappers/listeners/observers when stopped.

All events emitted by this component carry:

- event kind;
- page-local sequence;
- extension-issued generation;
- extension-issued run ID;
- wall-clock time;
- performance timing metadata when available;
- document identity;
- bounded/redacted data.

### `src/content-bridge.js`

Runs in the isolated extension world. It is intentionally small. Its job is transport hardening, not analysis.

Before forwarding a page event it checks:

- known event kind;
- positive integer sequence;
- positive integer generation;
- bounded run ID;
- finite positive timestamp;
- overall serialized payload size;
- for `source-url`, that the URL corresponds to a script currently observed in `document.scripts`.

The bridge does **not** make MAIN-world evidence trusted. A page shares the MAIN world and can observe page-side messaging.
The service worker therefore records such evidence with `integrity: page-observable`.

### `src/protocol.js`

Defines run states, modes, the authoritative page-event kind list, run-ID generation, runtime-message validation, and page-event
envelope validation.

The check suite compares page-agent `emit(...)` kinds against this list to catch protocol drift during development.

### `src/background.js`

The service worker is the extension composition root.

Key responsibilities:

- session creation/loading/normalization;
- authoritative run lifecycle;
- generation and run-ID assignment;
- serialized persistent flushes;
- bounded evidence retention;
- source indexing;
- TaskRunner integration;
- CDP attach/detach and event capture;
- evidence canonicalization;
- network classification;
- candidate correlation;
- anti-bot state/analysis;
- diagnostics and runtime search;
- tab cleanup.

The service worker never treats `agent-status` as authority over whether the BRT run exists. `session.running` and `runState`
are extension-controlled. `agentActive` is diagnostic observation only.

### `src/source-policy.js`

Pure source-fetch policy used before any external-source network request.

Current rule:

```text
same hostname                           -> allow
other hostname + thirdPartySources=true -> allow
other hostname + default settings       -> block before fetch
invalid/unsupported URL                 -> block
```

A blocked third-party source is retained as metadata-only evidence. This preserves research context without silently creating
an extension-origin cross-site request.

### `src/task-runner.js` and `src/rate-limiter.js`

Background work is modeled as bounded tasks with cancellation, timeout, retry metadata, queue limits, and per-key rate limits.
Source indexing is currently the principal consumer.

Tasks are associated with a tab and run ID. Stopping a run cancels its outstanding tasks.

### `src/shared.js`

Shared limits and redaction/sanitization helpers. URL parsing fails closed: malformed page-controlled URLs are not echoed raw
into exports.

### `src/session-utils.js`

Storage accounting, bounded collection helpers, document normalization, mode/CDP state normalization, and deterministic
DOM/network correlation primitives.

### `src/antibot.js` and `src/antibot-analyzer.js`

Passive classification/analysis only. These modules identify and summarize challenge/anti-bot-related evidence already visible
through normal browser observation. They do not solve challenges, replay tokens, spoof browser identity, or bypass controls.

### `ui/*`

The side panel is a consumer of the service-worker session model. It does not own capture state.

## Session model

A new run receives both a monotonically scoped `generation` and a random `runId`.

```text
BRT_START
   |
   +--> fresh session
   +--> runId = new random id
   +--> generation = next generation for tab
   +--> extension runState = running
   +--> page agent START command
   +--> optional CDP attach
```

Page-originated events are accepted only if the active session is running and both the event generation and run ID match.
This rejects delayed events from prior runs and malformed page traffic. For page-observable events, Chrome's runtime sender
URL is canonicalized for session/source-policy decisions; URLs reported inside MAIN-world payloads remain evidence only.

`runId` is not a secret. It crosses a page-observable transport and therefore must not be treated as an authentication token.
Its purpose is run correlation and stale-event rejection.

## Provenance model

### Page-observable

Examples: MAIN-world fetch/XHR/DOM/runtime observations.

```json
{
  "collector": "main-world-page-agent",
  "transport": "window.postMessage→isolated-content-script",
  "integrity": "page-observable"
}
```

This is useful evidence, but a hostile page can influence its own JavaScript environment and observe the transport.

### Extension-controlled

Examples: CDP events and side-panel markers.

These are collected through extension APIs rather than page-originated messages and receive stronger provenance.

### Browser-controlled

Hard-navigation records from `chrome.webNavigation` are labeled browser-controlled.

## Capture modes and CDP state

The requested mode and effective mode are intentionally separate.

```text
requested LIGHT    -> effective LIGHT
requested STANDARD -> effective STANDARD
requested DEEP
     |
     +-- CDP attached     -> effective DEEP
     +-- attach fails     -> effective STANDARD + diagnostic
     +-- unavailable      -> effective STANDARD + diagnostic
```

The UI exposes requested mode, effective mode, and CDP state to avoid a false sense of Deep capture.

## Network and body retention

Page-agent response bodies are bounded before storage. Structured JSON is parsed and redacted by field name when possible;
plain text falls back to assignment/header redaction. Analytics-classified traffic can be metadata-only depending on capture
settings.

Large sessions are bounded by collection and approximate byte limits. Retention statistics are retained so an export can show
that evidence was evicted or suppressed.

## Source indexing sequence

```text
page observes <script src=...>
        |
        v
source-url event
        |
        v
isolated bridge verifies URL is observed in document.scripts
        |
        v
service worker schedules rate-limited source-index task
        |
        v
source-policy.js evaluates URL BEFORE fetch
        |
        +-- blocked -> metadata-only source + diagnostic
        |
        +-- allowed -> bounded fetch -> bounded read -> redaction -> hash/findings -> storage
```

## Correlation model

Correlation records are candidates, not claims of causation. DOM/network relationships require matching session/document
identity and temporal/sequence proximity. The UI permits manual labeling as `related` or `not-related`.

Evidence provenance should be considered when interpreting confidence.

## Storage lifecycle

The service worker keeps hot session state in memory and persists sessions in `chrome.storage.local` through a serialized flush
state. Multiple updates coalesce rather than running unbounded parallel writes.

Closing a tab clears in-memory state and tasks but intentionally does not silently delete the persisted research log.

## Extension boundaries

The public extension is not intended to contain active exploitation, bypass, stealth, fingerprint spoofing, credential capture,
CAPTCHA solving, token replay, or destructive automation. Those are architectural non-goals, not missing features.
