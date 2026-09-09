# BRT Privacy Regression Harness

Status: v0.6 Step 2

Purpose:

Freeze the current privacy/redaction behavior before shared security
primitives are moved into the v0.6 Shared Core.

The harness is regression protection, not a sanitizer redesign.

Contract:

raw fixture
  -> current parser / normalizer path
  -> current redaction path
  -> canonical output
  -> golden comparison

Rules:

1. Production sanitizer behavior must not be changed merely to make a fixture pass.
2. Current weaknesses are recorded explicitly instead of silently corrected.
3. Secrets in fixtures are synthetic only.
4. Expected outputs are reviewed and committed.
5. Malformed inputs must not cause the harness to invent structure.
6. Destructive redaction is a regression just like missed redaction.
7. Ordering and formatting differences are canonicalized only when semantically irrelevant.
8. Representative historical regressions belong under fixtures/regressions.
9. Step 2 must be green before Step 3 moves sanitizer/security primitives.
10. New privacy behavior requires an explicit later decision, not an accidental golden update.

Initial corpus:

- URL/query secrets
- Authorization and API-key headers
- cookies
- JSON objects
- nested JSON
- arrays
- malformed JSON
- form-urlencoded bodies
- GraphQL payloads
- HTML
- plain text
- oversized payloads
- Unicode
- percent/base64-like encoded values
- duplicate keys/values
- Google Maps/place-details style regressions
- representative prior BRT payload shapes
