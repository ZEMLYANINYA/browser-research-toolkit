# BRT v0.6 Pre-Architecture Baseline

## Status

This checkpoint records the last verified `v0.5.x` state before the
`v0.6.0 - Architecture & Persistence` roadmap begins.

Baseline commit:

`c96bd3a1a92f09da51a305a51d753cd1e1252800`

Commit subject:

`fix(core): preserve XMLHttpRequest constructor compatibility (#12)`

## Verification

### Core

- `npm ci` - PASS
- `npm test` - 33/33 PASS
- `npm run typecheck` - PASS
- `npm run build` - PASS
- production bundle generated successfully

### Extension

- structural verification - PASS
- extension tests - 99/99 PASS
- manifest/page-event protocol verification - PASS

## Dependency audit

`npm audit` reports one Moderate finding:

- package: `esbuild <=0.24.2`
- advisory: `GHSA-67mh-4wv8-2f99`
- affected feature: esbuild development server
- current BRT usage: local build/bundling
- remediation offered by npm requires a breaking upgrade to `esbuild@0.28.2`

No forced dependency upgrade was performed during baseline creation.

## Extension architecture snapshot

Manifest version:

`3`

Extension version:

`0.5.0`

### Injection

Two manifest-declared content scripts are injected on:

- `http://*/*`
- `https://*/*`

Current behavior:

- `page-agent.js`
  - `document_start`
  - `MAIN` world
  - `all_frames: true`

- `content-bridge.js`
  - `document_start`
  - isolated extension world
  - `all_frames: true`

Therefore page instrumentation is present before an explicit research START.

The background also contains imperative injection through:

`chrome.scripting.executeScript()`

This currently coexists with manifest-declared injection.

### Permissions

Mandatory permissions include:

- `activeTab`
- `scripting`
- `sidePanel`
- `tabs`
- `storage`
- `unlimitedStorage`
- `webNavigation`
- `debugger`

Mandatory host permissions:

- `http://*/*`
- `https://*/*`

No `optional_host_permissions` baseline was present.

### Persistence

Session state is loaded from:

`chrome.storage.local`

Current flush behavior rewrites the complete per-tab session object:

`chrome.storage.local.set({ [key]: session })`

Existing protections include:

- dirty/in-flight flush tracking
- delayed flush scheduling
- bounded retention/backpressure
- storage write diagnostics

IndexedDB is not the primary persistence layer in this baseline.

### Page-visible surface

The MAIN-world agent uses:

`__BRT_LAB_AGENT_V01__`

as a property on `window`.

The transport channel includes:

`__BRT_LAB_V01__`

These are part of the observable pre-v0.6 page surface.

## Representative Standard session

Raw local artifact:

`artifacts/baseline-v0.6-prearchitecture/brt-baseline-c96bd3a-standard.json`

File size:

`4,831,481 bytes`

SHA-256:

`60974E642D35EA6A4EAA1FCC9B0A8778FCEF254AC379EABCADD827C656312552`

Session characteristics:

- schema version: 4
- requested mode: Standard
- effective mode: Standard
- CDP: disabled
- final run state: stopped
- final agent state: inactive
- sequence reached: 2175
- representative real-browser navigation and interaction workload
- multiple top-level documents and subframes
- XHR/fetch/beacon evidence
- DOM/network correlations
- source collection
- diagnostics
- redaction/truncation behavior
- explicit source-retention diagnostics

Observed session counts:

- documents: 49
- timeline records: 1539
- network records: 587
- retained sources: 120
- correlations: 26
- inferences: 14
- requests: 262
- responses: 242
- bodies: 87
- DOM events: 71
- navigation events: 48
- recorded errors: 0
- timeline evictions: 0
- timeline drops: 0
- network evictions: 0

Source retention did evict records under configured bounds and emitted
explicit diagnostics. Evidence loss was therefore visible rather than silent.

## Step 0 conclusion

The pre-architecture baseline is reproducible and sufficiently characterized
for comparison against later v0.6 architectural changes.

Step 1 may begin only after this checkpoint is committed and tagged.
