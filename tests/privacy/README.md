# BRT Privacy Regression Harness

Status: v0.6 Step 2 implementation complete

## Purpose

Freeze the current privacy/redaction behavior before security primitives are
moved into the v0.6 Shared Core.

This harness is regression protection, not a sanitizer redesign.

## Contract

raw input
  -> current parser / normalization path
  -> current redaction path
  -> canonical expected output
  -> golden comparison

## Coverage

The corpus currently covers:

- URL/query secret redaction
- Authorization/API-key/session-like headers
- current Cookie-header behavior
- flat and nested JSON objects
- arrays
- malformed JSON request bodies
- form-urlencoded bodies
- GraphQL payloads
- HTML and plain text
- Unicode
- percent-encoded and base64-like input
- oversized body truncation
- duplicate/repeated sensitive structures
- Google Maps place-details historical regression
- representative BRT-shaped payloads

## Known current weaknesses

These are intentionally recorded rather than silently fixed in Step 2:

- `sanitizeHeaders` currently does not apply the cookie-pattern matcher.
- request-body sanitization does not parse JSON before redaction.
- sensitive request-body strings may be redacted as a whole.
- non-string request bodies are represented as `[Binary Data]`.
- structured object redaction is field-name based, not value based.
- percent-encoded and base64-like sensitive names/values are not decoded first.

A future behavior change must update the implementation and the corresponding
golden expectation deliberately.

## Rules

1. Production sanitizer behavior must not be changed merely to make a fixture pass.
2. Secrets in fixtures are synthetic only.
3. Expected outputs are reviewed and committed.
4. Malformed inputs must not cause invented structure.
5. Destructive over-redaction is a regression just like missed redaction.
6. Canonicalization may remove irrelevant formatting differences only.
7. Historical regressions remain permanently represented.
8. Step 2 must remain green during Step 3 Shared Core work.
9. Golden updates must be explicit and reviewable.
10. Evidence loss or privacy weakening must never be hidden behind fixture rewrites.
