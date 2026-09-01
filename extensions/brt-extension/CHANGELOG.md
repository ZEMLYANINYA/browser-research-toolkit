# Extension changelog

## Unreleased

### Added

- Deterministic Parser Blueprint generation from retained session evidence.
- API-driven, document-driven, and mixed transport-model inference with evidence and confidence.
- Ordered parser workflow steps with endpoint-family and request-body-schema metadata.
- Structured classic-form submission observability and form-field stability modelling.
- Hidden/view-state/generated-field and state-carrier inference without copying raw field values.
- Separation of protection, analytics/telemetry, infrastructure/session-routing, and unknown signals.
- Evidence-backed parser implementation implications.
- Dedicated side-panel Blueprint view with on-demand generation plus JSON and Markdown export.
- Frame-aware MAIN-world capture for top-level pages and subframes.
- Browser-controlled frame/document provenance for committed subframe navigations.
- Per-document lightweight HTML/runtime snapshot observation metadata.
- Frame/document observations for deduplicated external sources.
- Tab-wide capture lifecycle command delivery with top-frame-only runtime watch commands.
- Reproducible local frame-aware browser fixture with cross-origin iframe navigation.

### Changed

- Parser Blueprint canonical ordering is locale-independent and treats missing numeric ordering metadata as missing rather than zero.
- Blueprint request-body analysis retains structural schema metadata rather than raw payload values.
- Raw session export remains separate from derived Parser Blueprint artifacts.
- External source deduplication now preserves observations from every document/frame without duplicating the fetched source body.
- Subframe navigation is retained in documents and timeline evidence without changing canonical top-level session ownership.
- First-party source-fetch authorization remains anchored to the top-level page even when a source is discovered inside a cross-origin iframe.

### Fixed

- Prevented arbitrary opaque/free-text `PxN` substrings from being treated as PerimeterX evidence while preserving contextual cookie/header/endpoint detection.
- Prevented subframe HTML/runtime snapshots from overwriting global top-level session state.
- Prevented subframe agent status from becoming authoritative over top-level session state.
- Prevented subframe navigation from mutating the top-level anti-bot lifecycle.
- Prevented known cross-frame DOM/network evidence from being correlated as same-frame candidates.

### Tests

- Added deterministic Parser Blueprint transport, workflow, forms, state-carrier, signal, Markdown, and side-panel integration coverage.
- Added end-to-end acceptance fixtures for API/XHR, classic form POST plus navigation, dynamic hidden/view-state fields, analytics plus protection, load-balancer affinity metadata, and canonical ordering.
- Added regression coverage that Parser Blueprint exports refresh stale same-session derivations.
- Added PerimeterX regressions for opaque `Px3` text and explicit cookie/header/URL evidence.
- Added frame-aware document and navigation ownership tests.
- Added cross-frame correlation regressions.
- Added source provenance and multi-frame deduplication tests.
- Added snapshot metadata and command-routing tests.
- Added anti-bot frame-ownership regression coverage.
- Verified top-frame + cross-origin iframe capture and iframe document replacement in Chrome.

## 0.4.0

First repository-ready release of the Manifest V3 Browser Research Toolkit extension.

### Added

- Side-panel research dashboard.
- Light / Standard / Deep capture modes.
- Optional CDP-assisted evidence collection.
- Provenance-aware evidence model.
- DOM/network candidate correlation.
- Passive anti-bot observability and diagnostics.
- Bounded source indexing, storage accounting, task runner, and rate limiting.
- Session import/export and persisted local sessions.
- Extension-specific verification suite and CI workflow support.

### Security and integrity hardening

- Added an authoritative page-event kind allowlist.
- Page events now require a positive sequence, generation, current run ID, and timestamp.
- Added bridge-side payload size bounding and protocol validation.
- Stale page events with the wrong generation or run ID are rejected by the service worker.
- `agent-status` is no longer authoritative over the service-worker run state.
- Page-reported URLs no longer define the canonical session URL or first-party source-fetch boundary; Chrome sender metadata does.
- Third-party external scripts are no longer fetched merely to discard their bodies.
- Third-party source fetching is blocked before network I/O unless explicitly opted in.
- Blocked third-party sources are retained as metadata-only evidence with a policy reason.
- Added a repository homepage to the extension manifest.

### Tests

- Page-event protocol validation.
- Protocol drift detection between page-agent emissions and declared event kinds.
- First-party/third-party source-fetch policy.
- Sensitive URL/body redaction regressions.
- DOM/network correlation session/document boundaries.
