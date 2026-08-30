# BRT Extension Security and Trust Model

## Scope

This document describes the security properties of the public Browser Research Toolkit extension. BRT observes browser/page
behavior on pages the user is authorized to inspect. It is designed to collect useful evidence while minimizing accidental
secret retention and avoiding hidden active behavior.

## Security goals

BRT aims to:

- keep captured data local unless the user explicitly exports it;
- redact common credential/session material before retention;
- bound memory, storage, payload, source-download, queue, and task growth;
- distinguish page-originated evidence from extension/browser-controlled evidence;
- reject stale page events from prior runs;
- avoid extension-origin third-party source requests by default;
- restore page wrappers when capture stops;
- expose CDP attach failures rather than silently claiming Deep mode;
- avoid remote code loading and external extension messaging.

## Explicit non-goals

BRT does not claim to:

- make MAIN-world evidence cryptographically authentic;
- detect every secret or personal-data field;
- provide malware-grade isolation from a hostile page;
- be a DLP product;
- bypass bot defenses, CAPTCHA, authentication, authorization, or access controls;
- provide exploit automation or stealth/evasion functionality.

## Trust boundaries

### Boundary A: page MAIN world -> isolated bridge

The page agent runs in the same JavaScript world as the page. Its `window.postMessage` transport is visible to page JavaScript.
Therefore evidence crossing this boundary is explicitly labeled `page-observable`.

Mitigations in 0.4.0:

- fixed allowlist of accepted page-event kinds;
- required positive sequence and generation;
- required bounded run ID;
- required finite timestamp;
- bridge-side serialized payload cap;
- `source-url` must correspond to an actually observed script element;
- service-worker protocol validation repeats authoritative checks;
- active session generation and run ID must match;
- Chrome sender URL metadata, not a page-reported URL field, defines the canonical page URL for page-observable events;
- `agent-status` cannot authoritatively toggle service-worker run state.

Residual risk:

A sufficiently hostile page can observe the current page-side protocol and can influence its own MAIN-world environment.
`runId` and `generation` are correlation/staleness controls, not secrets. Page-observable evidence should never be represented as
browser-authenticated truth.

### Boundary B: isolated bridge -> service worker

The bridge uses extension runtime messaging. The service worker validates BRT messages and uses `sender.tab` context for page
events. The extension manifest does not expose `externally_connectable`.

### Boundary C: service worker -> remote web origin

The extension has broad HTTP(S) host permission because it operates on normal web pages and can index source evidence. Broad
permission does not mean every URL is fetched.

External-source fetch policy is evaluated **before network I/O**:

- same-hostname source: allowed;
- third-party source: blocked by default;
- third-party source with explicit setting: allowed;
- invalid/unsupported URL: blocked.

Blocked sources remain visible as metadata-only evidence with the policy reason.

Allowed fetches use:

- `credentials: omit`;
- a timeout;
- TaskRunner cancellation;
- per-host rate limiting;
- maximum download bytes;
- maximum retained characters;
- redaction before retained text is written.

## Redaction model

### URL redaction

Known sensitive query keys are replaced with `[REDACTED]`. Long query values are truncated. URL parsing failures fail closed
rather than storing the raw malformed input. Opaque fragments are not needed for endpoint identity and are redacted.

### Structured body redaction

When bounded text can be parsed as JSON, BRT walks the structure without invoking accessor properties and masks fields whose
names look credential/session-sensitive.

### Plain-text fallback

Authorization/cookie-like headers and common token/password/session assignments are masked using bounded regular-expression
rules.

### Protected inputs

The page sensor avoids retaining values or individual keystrokes from password/email/tel and selected autocomplete-sensitive
input types.

### Residual redaction risk

Heuristic redaction can miss secrets stored under innocuous names or encoded in application-specific formats. Researchers
should review exports before publication or sharing.

## Permissions review

| Permission | Security implication | Mitigation / reason |
| --- | --- | --- |
| `activeTab` | Access to current tab context | User-driven research workflow. |
| `scripting` | Can execute extension code in a page | Used only for the local research agent. No remote code loading. |
| `tabs` | Reads tab metadata | Used for session/tab lifecycle. |
| `sidePanel` | Adds UI surface | Dashboard only. |
| `storage` | Persists research evidence | Local extension storage; bounded by BRT retention logic. |
| `unlimitedStorage` | Raises browser quota | BRT still applies its own approximate byte and collection limits. |
| `webNavigation` | Observes navigation | Used for browser-controlled hard-navigation provenance. |
| `debugger` | Powerful CDP access | Used only by optional Deep mode; state/failures are visible in UI. |
| HTTP(S) host access | Broad origin access | Required for research coverage; source network requests are additionally constrained by policy. |

## Data handling

BRT has no project-operated telemetry backend. It does not intentionally transmit captured sessions to a BRT server.

Data paths are:

```text
captured page -> local extension state -> chrome.storage.local -> user-triggered export
```

A captured page naturally continues making its own normal network requests. BRT's source-indexing fetches are separate
extension-origin work and are governed by the source policy above.

## Availability and resource controls

Resource controls include:

- bounded timeline/network/source/runtime/anti-bot collections;
- approximate byte accounting;
- source body byte and character limits;
- bridge event payload bound;
- task timeout and cancellation;
- per-key rate limiting and queue bounds;
- serialized/coalesced persistence flushes;
- tab-removal cleanup;
- generation/run separation across capture runs.

These controls aim to convert pathological activity into dropped/evicted/diagnostic evidence rather than unbounded resource
use.

## CDP considerations

Deep mode uses the `chrome.debugger` API. This is intentionally a stronger privilege and may conflict with DevTools or other
debugger users. BRT records attach state as one of:

`disabled`, `attaching`, `attached`, `attach-failed`, `unavailable`, `detached`.

Requested Deep mode is not equivalent to effective Deep mode. If attachment fails, the effective mode falls back and the UI
shows the state.

## Security review checklist for new features

Before adding a new feature, answer:

1. Does it create a new network request that the page itself did not make?
2. Does it read or persist credentials, cookies, tokens, form values, or identifiers?
3. Does it broaden host/extension permissions?
4. Does it cross MAIN-world -> isolated-world trust boundaries?
5. Is the evidence provenance represented accurately?
6. Is the new collection bounded by count and/or bytes?
7. Can the work be cancelled when a run stops?
8. Does it invoke getters/accessors on page-controlled objects?
9. Does it load code from a remote origin?
10. Does it change the project from observation toward evasion, bypass, exploitation, replay, or destructive action?

If the last answer is yes, the feature does not belong in the public BRT extension.
