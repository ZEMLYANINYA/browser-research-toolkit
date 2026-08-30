# BRT Extension Release Checklist

Use this checklist for the `extension-*` release line.

## Code and protocol

- [ ] `extension/manifest.json` version matches the intended release.
- [ ] `extension/package.json` version matches the manifest.
- [ ] `npm run verify` passes from `extension/`.
- [ ] Every page-agent `emit()` kind is represented in `PAGE_EVENT_KINDS`.
- [ ] The isolated bridge allowlist matches the protocol list.
- [ ] New page-originated events include generation and run ID.
- [ ] `agent-status` remains observational rather than authoritative.
- [ ] No unbounded collection or queue was introduced.
- [ ] New background tasks are cancellable and timeout-bound.

## Privacy and data handling

- [ ] New URLs are passed through sanitization before retention/export.
- [ ] New body/structured data has an explicit redaction path.
- [ ] Protected form fields remain protected.
- [ ] Any new source/network action has a documented pre-request policy.
- [ ] Third-party source requests remain opt-in.
- [ ] No remote telemetry or remote code loading was added.

## Permissions

- [ ] Review every manifest permission.
- [ ] Explain any newly added permission in `extension/README.md` and `docs/SECURITY_MODEL.md`.
- [ ] Confirm `externally_connectable` is absent unless a future design explicitly requires and reviews it.

## Browser smoke test

- [ ] Load unpacked extension in a clean Chromium profile.
- [ ] Start/stop Light mode.
- [ ] Start/stop Standard mode.
- [ ] Start Deep mode and verify CDP state is correctly shown.
- [ ] Verify Deep attach failure falls back visibly rather than silently.
- [ ] Verify network requests/responses appear.
- [ ] Verify DOM evidence appears without protected input values.
- [ ] Verify source list shows first-party indexed sources.
- [ ] Verify third-party sources are metadata-only by default and no background source request is made.
- [ ] Verify session persists across side-panel close/reopen.
- [ ] Verify export/import on a non-sensitive test session.
- [ ] Stop capture and verify patched APIs are restored.

## Long-session smoke test

- [ ] Run on a noisy SPA for at least 30 minutes.
- [ ] Confirm timeline/network/source counts remain bounded.
- [ ] Confirm storage stats and eviction counters move as expected.
- [ ] Confirm task queue does not grow without bound.
- [ ] Confirm stop cancels source-index tasks.

## Documentation

- [ ] `extension/README.md` matches actual capabilities.
- [ ] `extension/CHANGELOG.md` contains the release notes.
- [ ] `docs/EXTENSION_ARCHITECTURE.md` reflects new components/data flow.
- [ ] `docs/SECURITY_MODEL.md` reflects new trust boundaries/permissions.
- [ ] Root README links to `extension/`.

## Git

Recommended tag format:

```text
extension-v0.4.0
```

Recommended commit message for the first public extension release:

```text
feat(extension): add BRT MV3 research extension v0.4.0
```

Before tagging:

```bash
git status
git diff --check
git diff --stat
npm ci
npm run typecheck
npm run build
npm test
(cd extension && npm run verify)
```

Then commit, push, wait for both core and extension CI, and only then create the extension tag/release.
