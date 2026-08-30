# Extension changelog

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
