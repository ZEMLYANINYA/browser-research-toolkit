# BRT Extension Release Checklist

Use this checklist for the `extension-*` release line.

## Code and protocol

- [ ] `extensions/brt-extension/manifest.json` version matches the intended release.
- [ ] `extensions/brt-extension/package.json` version matches the manifest.
- [ ] `npm --prefix extensions/brt-extension run verify` passes.
- [ ] Every page-agent `emit()` kind is represented in `PAGE_EVENT_KINDS`.
- [ ] The isolated bridge allowlist matches the protocol list.
- [ ] New page-originated events include generation and run ID.
- [ ] `agent-status` remains observational rather than authoritative.
- [ ] No unbounded collection or queue was introduced.
- [ ] New background tasks are cancellable and timeout-bound.
- [ ] Parser Blueprint remains derived/on-demand and does not alter the persisted raw session schema.
- [ ] Parser Blueprint canonical inference remains deterministic across supported Node/browser environments.

## Privacy and data handling

- [ ] New URLs are passed through sanitization before retention/export.
- [ ] New body/structured data has an explicit redaction path.
- [ ] Protected form fields remain protected.
- [ ] Any new source/network action has a documented pre-request policy.
- [ ] Third-party source requests remain opt-in.
- [ ] No remote telemetry or remote code loading was added.
- [ ] Parser Blueprint exports contain schema/provenance metadata rather than raw request/form secret values.

## Permissions

- [ ] Review every manifest permission.
- [ ] Explain any newly added or repurposed permission in `extensions/brt-extension/README.md` and `docs/extension/SECURITY_MODEL.md`.
- [ ] Confirm `externally_connectable` is absent unless a future design explicitly requires and reviews it.
- [ ] Capture START requests only the specific current HTTP(S) research origin, never blanket runtime access to all origins.
- [ ] Capture-origin permission is requested directly from an explicit user gesture.
- [ ] Denied capture-origin permission fails closed before `BRT_START` is sent.
- [ ] Third-party source-host grants remain separate from capture-origin authority and are still explicit per-origin opt-ins.
- [ ] A new top-level origin is never auto-authorized from a navigation callback.

## Browser smoke test

- [ ] Load unpacked extension in a clean Chromium profile.
- [ ] Start/stop Light mode.
- [ ] Start/stop Standard mode.
- [ ] Start Deep mode and verify CDP state is correctly shown.
- [ ] Verify Deep attach failure falls back visibly rather than silently.
- [ ] Verify the Start gesture requests only the current research origin.
- [ ] Verify denied capture-origin permission does not start capture.
- [ ] Verify a same-origin hard navigation preserves the same running session and reinjects the page bridge/agent.
- [ ] Verify an unapproved cross-origin top-level navigation becomes `interrupted` with `capture-continuity-lost` rather than remaining falsely `running`.
- [ ] Verify network requests/responses appear after a same-origin hard navigation.
- [ ] Verify DOM evidence appears without protected input values.
- [ ] Verify source list shows first-party indexed sources.
- [ ] Verify third-party sources are metadata-only by default and no background source request is made.
- [ ] Verify session persists across side-panel close/reopen.
- [ ] Verify stopped/unstarted session duration does not fall back to Unix-epoch elapsed time.
- [ ] Verify the displayed extension version matches `manifest.json`.
- [ ] Verify export/import on a non-sensitive test session.
- [ ] Generate Parser Blueprint from a non-sensitive session and inspect the side-panel output.
- [ ] Export Parser Blueprint as JSON and Markdown.
- [ ] Advance the same session and confirm Blueprint export refreshes the stale derivation.
- [ ] Stop capture and verify patched APIs are restored.

## Long-session smoke test

- [ ] Run on a noisy SPA for at least 30 minutes.
- [ ] Include at least one real same-origin top-level document navigation when the target supports it.
- [ ] Confirm timeline/network/source counts remain bounded.
- [ ] Confirm storage stats and eviction counters move as expected.
- [ ] Confirm task queue does not grow without bound.
- [ ] Confirm stop cancels source-index tasks.

## Documentation

- [ ] `extensions/brt-extension/README.md` matches actual capabilities and release version.
- [ ] `extensions/brt-extension/CHANGELOG.md` contains the release notes.
- [ ] `docs/extension/EXTENSION_ARCHITECTURE.md` reflects new components/data flow.
- [ ] `docs/extension/SECURITY_MODEL.md` reflects new trust boundaries/permissions.
- [ ] Root README links to `extensions/brt-extension/`.

## Git

Recommended tag format:

```text
extension-v0.6.0
```

Before tagging:

```bash
git status
git diff --check
npm ci
npm run typecheck
npm run build
npm test
npm --prefix extensions/brt-extension run verify
npm run test:browser:all
```

Then push the release candidate, wait for both core and extension CI, repeat the real-site control smoke if needed, and only then create the extension tag/release.
