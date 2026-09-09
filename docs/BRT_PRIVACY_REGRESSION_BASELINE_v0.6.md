# BRT v0.6 Step 2 - Privacy Regression Baseline

Status: implementation complete, pre-merge checkpoint

## Purpose

Step 2 establishes a golden privacy regression harness before the v0.6 Shared
Core refactor.

The harness freezes current redaction behavior so Step 3 can move security
primitives without silently changing privacy semantics.

## Golden contract

raw input
  -> current parse / normalization path
  -> current redaction path
  -> canonical expected output
  -> golden comparison

The harness intentionally records current behavior, including known weaknesses.
It does not redesign the sanitizer.

## Coverage

Implemented corpus covers:

- URL/query secret redaction
- case-insensitive sensitive query names
- multiple sensitive query parameters
- safe near-match preservation
- Authorization/API-key/session-like headers
- current Cookie-header behavior
- flat and nested structured objects
- arrays
- safe-value preservation
- auth-endpoint body redaction
- sensitive whole-string request-body redaction
- safe JSON request strings
- malformed JSON request strings
- current non-string request-body behavior
- form-urlencoded payloads
- GraphQL payloads
- HTML
- plain text
- Unicode
- percent-encoded inputs
- base64-like inputs
- oversized body truncation
- repeated sensitive structures
- repeated values under safe field names
- Google Maps place-details historical regression
- representative synthetic BRT-shaped payloads

## Known current weaknesses

These are intentionally frozen rather than corrected in Step 2:

1. `sanitizeHeaders` does not currently apply the cookie-pattern matcher.
2. Request-body sanitization does not parse JSON before redaction.
3. Sensitive request-body strings may be redacted as a whole.
4. Non-string request bodies are represented as `[Binary Data]`.
5. Structured object redaction is field-name based, not value based.
6. Percent-encoded and base64-like sensitive names or values are not decoded
   before detection.

Changing any of these behaviors requires an explicit implementation decision and
corresponding golden update.

## Historical regression protection

The corpus includes the Google Maps place-details regression that motivated
field-level structured redaction.

The expected behavior preserves non-sensitive sibling fields while redacting
the sensitive field instead of discarding the complete response object.

## Verification

Final local gate:

- Root tests: 67 / 67 passed
- Root failures: 0
- TypeScript typecheck: passed
- Build: passed
- Bundle size: 80.6 kb
- Extension syntax/protocol check: passed
- Extension tests: 127 / 127 passed
- Extension failures: 0
- `git diff --check`: clean
- Working tree before checkpoint documentation: clean

Known jsdom diagnostic output remains present in existing integration tests,
including unsupported navigation, synthetic XHR network errors, and missing
browser globals in specific fixtures. These diagnostics did not produce test
failures and are unchanged from the established baseline.

## Step 3 requirement

This privacy harness is now a mandatory gate for the Shared Core work.

Security/redaction primitives must not be moved or consolidated unless:

- the privacy golden suite remains green,
- behavioral changes are deliberate and reviewed,
- known weaknesses are not silently reclassified as fixed,
- destructive over-redaction and missed redaction remain detectable.

## Result

Step 2 implementation criteria are satisfied.

Merge and post-merge checkpoint/tag remain before the roadmap stage is marked
closed.
