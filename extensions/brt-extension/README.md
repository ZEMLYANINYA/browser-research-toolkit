# Browser Research Toolkit Extension

Browser Research Toolkit Extension is the Manifest V3 browser-extension front end for the Browser Research Toolkit project.
It is a local-first, redaction-first research instrument for observing how a page behaves in the browser: network activity,
DOM interactions, navigation, runtime state, source evidence, performance signals, WebSocket/SSE activity, and optional
Chrome DevTools Protocol evidence in Deep mode.

This extension is intentionally an **observability tool**. It is not an exploit framework, an anti-detection system, a
fingerprint spoofer, or an access-control bypass tool.

## Version

Extension release line: **0.4.0**

The extension uses its own version line independently from the TypeScript core package in the repository. Git tags should
therefore use names such as `extension-v0.4.0` rather than a bare `v0.4.0`.

## Main capabilities

- Manifest V3 side-panel interface.
- Light, Standard, and Deep capture modes.
- `fetch` and `XMLHttpRequest` observation.
- WebSocket and EventSource lifecycle/body observation.
- DOM interaction and mutation evidence.
- Frame-aware capture across top-level pages and subframes.
- SPA and hard-navigation evidence.
- Performance summaries and Deep-mode detail.
- Runtime snapshots and explicit watched globals.
- First-party source indexing with bounded retention.
- Metadata-only third-party source evidence by default.
- Optional Chrome DevTools Protocol capture in Deep mode.
- Candidate DOM-to-network correlation with provenance-aware confidence.
- Passive anti-bot signal classification and diagnostics.
- Local session persistence, import/export, bounded storage, and backpressure.
- Default-on redaction for common credential and session fields.

## Install for local development

1. Open `chrome://extensions` in Chrome or Chromium.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `extensions/brt-extension/` directory.
5. Pin Browser Research Toolkit if desired.
6. Open a normal `http://` or `https://` page and click the extension action to open the side panel.

No build step is required for the runtime extension. The source files in this directory are the files Chrome loads.

## Capture modes

### Light

Designed for lower overhead.

- Network metadata is captured.
- DOM and navigation evidence is retained.
- Response bodies, source indexing, mutation detail, and performance capture are reduced or disabled.
- CDP is not attached.

### Standard

The default research mode.

- Page-level network observation.
- Bounded response-body previews.
- DOM events and aggregated mutations.
- Performance summaries.
- Runtime/source evidence.
- WebSocket and SSE observation.
- No debugger attachment.

### Deep

Adds browser-controlled evidence through `chrome.debugger` / Chrome DevTools Protocol.

Deep mode requests CDP attachment and enables the Network, Debugger, Runtime, and Page domains. If attachment fails or is
unavailable, BRT records the failure and falls back to Standard behavior rather than pretending Deep capture is active.

## Data flow

```text
Page MAIN world
(top frame + subframes)
    |
    | page-observable window.postMessage
    v
Isolated content bridge
    |
    | chrome.runtime messaging
    v
MV3 service worker
    |\
    | +-- bounded session storage
    | +-- task runner / rate limiter
    | +-- source policy / indexing
    | +-- correlation / diagnostics
    |
    +---- optional chrome.debugger (Deep mode)
    |
    v
Side panel
```

The MAIN-world transport is deliberately labeled **page-observable** in stored provenance. Evidence collected through
`chrome.debugger` is labeled **extension-controlled**, and hard-navigation evidence from `chrome.webNavigation` is labeled
**browser-controlled**. BRT does not pretend these sources have the same integrity.

See [`../../docs/extension/EXTENSION_ARCHITECTURE.md`](../../docs/extension/EXTENSION_ARCHITECTURE.md) and
[`../../docs/extension/SECURITY_MODEL.md`](../../docs/extension/SECURITY_MODEL.md) for the full model.

## Source indexing policy

Version 0.4.0 uses a fail-closed external-source policy:

- A script on the **same hostname** as the captured page may be fetched and indexed.
- A script on another hostname is **not fetched by default**.
- A blocked third-party script is retained as metadata-only source evidence with a policy reason.
- Third-party source fetching requires the explicit `thirdPartySources` opt-in in capture settings.
- Unsupported schemes and invalid source/page URLs are rejected.
- Source downloads are timeout-bound, rate-limited, byte-bounded, character-bounded, and redacted before storage.
- Source records retain document/frame observations even when the same external URL is deduplicated across multiple frames.
- First-party source-fetch policy remains anchored to the canonical top-level page URL; an iframe URL does not redefine that boundary.

This is intentionally stricter than merely fetching a third-party script and discarding its body afterward.

## Page-event integrity hardening

Events that cross from the MAIN world into the extension must now include a valid event kind, positive sequence number,
positive generation, current run ID, and timestamp. The isolated bridge applies an allowlist and a bounded serialized-size
check before forwarding. The service worker performs the authoritative validation again and rejects stale events whose
`generation` or `runId` does not match the active session. For page-observable events, Chrome-provided sender URL metadata is
used as the canonical page URL; a page-reported URL cannot redefine the first-party source-fetch boundary.

Frame identity follows the same rule. MAIN-world code does not authoritatively choose its Chrome frame ID. The service worker
uses Chrome sender/navigation metadata to canonicalize frame and document provenance. Subframe observations are retained, but
they cannot replace top-level session ownership such as `pageUrl`, `activeDocumentId`, global HTML/runtime snapshots, or
the top-level anti-bot lifecycle.

`agent-status` is observational only. A page-originated status event cannot authoritatively start or stop the service-worker
session. The extension-owned run state remains authoritative.

This reduces accidental/stale injection and limits the damage from malformed page messages, but it does **not** make
MAIN-world evidence cryptographically trustworthy. A hostile page shares the MAIN world and can observe the page-side
transport. That residual limitation is documented rather than hidden.

## Redaction and privacy

BRT is redaction-first, not redaction-perfect.

The extension masks common sensitive query parameters, credential/session fields, authorization/cookie-like text, and
structured JSON fields with sensitive names. It also avoids collecting raw values from protected input classes such as
password/email/tel/one-time-code fields.

Important limitations remain:

- A secret stored under an innocuous field name may not be detected.
- Page-visible DOM text can itself contain personal data.
- Response bodies can contain data whose sensitivity cannot be inferred from field names.
- Exported sessions should still be reviewed before sharing publicly.

No remote telemetry or BRT-operated backend is used by this extension. Session data is stored locally through extension
storage and exported only on user action.

## Permissions

The extension currently requests:

| Permission | Why it is used |
| --- | --- |
| `activeTab` | Work with the current research tab. |
| `scripting` | Inject/ensure the MAIN-world research agent. |
| `sidePanel` | Provide the research dashboard. |
| `tabs` | Resolve the active tab and lifecycle. |
| `storage` | Persist local sessions. |
| `unlimitedStorage` | Allow larger bounded research sessions without a small extension quota becoming the primary limit. |
| `webNavigation` | Record browser-controlled hard-navigation provenance. |
| `debugger` | Optional CDP-assisted Deep mode. |
| `http://*/*`, `https://*/*` | Instrument normal web pages and, subject to BRT policy, collect source evidence. |

`debugger` is powerful and intentionally visible to the user. Deep mode is optional; Light and Standard modes do not require
an active debugger attachment.

## Retention and backpressure

Collections are bounded. BRT tracks approximate storage usage, evicts retained evidence according to limits, records
retention statistics, serializes session flushes, rate-limits background source work, and cancels per-run tasks when a run is
stopped or a tab is closed.

The goal is to fail visibly and boundedly rather than convert a long research session into an unbounded RAM/storage queue.

## Verification

The extension has no runtime npm dependencies. Node is used only for repository checks.

```bash
cd extensions/brt-extension
npm run verify
```

`npm run verify` performs:

- JavaScript syntax checks for `src/` and `ui/`.
- Manifest structure checks.
- Content-script/service-worker/side-panel file existence checks.
- Page-event protocol drift detection.
- Unit tests for protocol validation.
- Source-fetch policy tests.
- Redaction regression tests.
- DOM/network correlation boundary tests.
- Frame-aware document, source, navigation, snapshot-ownership, and anti-bot lifecycle regression tests.
- Reproducible local top-frame/cross-origin-iframe browser fixture under `tests/fixtures/frame-aware/`.

## Known limitations

- MAIN-world instrumentation runs in top-level pages and eligible subframes; frame identity remains provenance-sensitive and is canonicalized from Chrome-controlled sender/navigation metadata.
- Deep mode adds CDP evidence but does not make every iframe/page-world event equivalent to a browser-controlled event.
- The MAIN-world transport is page-observable and must be treated as lower-integrity evidence.
- First-party source classification currently means **same hostname**, not registrable-domain ownership.
- Redaction is heuristic and should not be treated as a DLP system.
- The extension is designed for Chromium-family Manifest V3 behavior and has not been generalized to every browser engine.

## Project scope

Appropriate uses include:

- Frontend/API research on pages you are authorized to inspect.
- Understanding request sequences and SPA behavior.
- Debugging network/DOM relationships.
- Studying browser execution and telemetry patterns.
- Recording passive anti-bot/challenge observations without bypassing them.
- Producing bounded evidence for reproducible browser research.

Out of scope for this public extension:

- Exploit automation.
- Credential interception.
- CAPTCHA solving or replay.
- Fingerprint spoofing or stealth/evasion features.
- Access-control bypass.
- Token replay.
- Destructive automation.

## Repository layout

In the main repository the recommended layout is:

```text
browser-research-toolkit/
├── src/                    # existing TypeScript core
├── tests/                  # existing core tests
├── extensions/
│   └── brt-extension/       # this Manifest V3 extension
├── docs/
│   └── extension/
│       ├── EXTENSION_ARCHITECTURE.md
│       ├── SECURITY_MODEL.md
│       └── EXTENSION_RELEASE_CHECKLIST.md
└── .github/workflows/
    ├── ci.yml
    └── extension-ci.yml
```

The extension complements the existing TypeScript core; it does not replace it.

## License

MIT, following the parent repository.
