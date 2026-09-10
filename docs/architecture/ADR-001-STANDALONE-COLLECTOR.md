# ADR-001: Keep the standalone collector as a thin composition layer

Status: Accepted
Release: v0.6.0
Step: Shared Core / collector decision

## Context

Browser Research Toolkit currently has two runtime surfaces:

- the reusable TypeScript Core in `src/`, which can run as a standalone browser bundle and exposes `ResearchCollector`;
- the Manifest V3 extension in `extensions/brt-extension/`.

The v0.6 Shared Core work requires one source of truth for primitives whose semantics are genuinely shared between these runtimes, while avoiding parallel security, evidence, and persistence architectures.

The standalone collector is not a second implementation inside `collector.ts` itself. `ResearchCollector` currently acts as a composition root: it constructs `CollectorContext`, response analysis, interceptors, monitors, and export behavior, then exposes the compatibility/public API used by `window.research`.

Shared work completed before this decision already moved common primitives such as:

- text truncation;
- URL sanitization engine;
- extension sensitive-field/query classifiers;
- extension sensitive-text redaction;
- bounded response reading;
- page-event envelope schema;
- shared extension capture limits.

Core-specific behavior still exists where semantics differ, including the Core sanitizer policy, request fingerprinting, in-memory bounded stores, and the extension's session-retention/backpressure model.

## Decision

Keep the standalone collector.

`ResearchCollector` remains the standalone composition root and compatibility/public API layer.

It may coordinate Core-specific interceptors, monitors, configuration, context, analysis, and export behavior, but it must not introduce a second implementation of a primitive when an applicable shared primitive already exists.

Shared Core owns only primitives whose semantics are demonstrably common across runtimes.

Surface-specific orchestration and policy remain local when their semantics differ.

## Storage boundary

The Core in-memory bounded stores and the extension retention system are intentionally not unified in v0.6 Step 3.

Core storage currently uses:

- `BoundedStore` for size-bounded Map-backed collections with optional TTL;
- `BoundedList` for fixed-capacity FIFO collections with dropped-item accounting.

The extension retention layer has different semantics:

- approximate byte accounting by retention bucket;
- tracked replacement and removal;
- explicit returned evictions;
- priority-aware timeline retention;
- global backpressure behavior;
- persistence responsibilities that will change again during the IndexedDB step.

These are not the same abstraction.

Creating a shared storage wrapper at this stage would either erase meaningful extension retention behavior or produce an overly generic abstraction with little architectural value.

Storage convergence is therefore deferred. The extension persistence model will be revisited in Step 4 when IndexedDB is introduced.

## Security and sanitization boundary

The Core `Sanitizer` is retained as a Core policy layer, not as a competing shared primitive.

It already consumes shared primitives where semantics match, including URL sanitization and text truncation.

Core structured sanitization keeps its existing behavior because its depth limits, array/key caps, marker strings, redaction accounting, and fallback behavior differ from the extension implementation.

No behavior-changing unification is performed as part of this ADR.

## Request identity boundary

Core request fingerprinting remains Core-specific.

The Core fingerprint includes method, origin, pathname, and sorted query parameter names while ignoring selected volatile query keys.

The extension `endpointFamily` instead normalizes dynamic path segments and intentionally ignores method, origin, and query shape.

These functions solve different problems and are not unified.

## Consequences

Positive:

- the standalone Core remains useful as a reusable module and standalone browser script;
- the existing `window.research` public surface remains available;
- Shared Core grows only where there is real semantic overlap;
- v0.6 avoids replacing working behavior with artificial abstractions;
- extension persistence work remains free to evolve toward IndexedDB without inheriting Core storage semantics.

Trade-offs:

- some surface-specific implementations continue to exist;
- "shared" does not mean "everything lives in one package";
- future contributors must distinguish duplicated code from intentionally different policy.

## Guardrails

Future changes should follow these rules:

1. If a primitive has identical semantics across Core and Extension, prefer `src/shared/`.
2. If behavior differs because of runtime or product policy, keep it local and document the difference.
3. Do not duplicate sanitization, schema validation, bounded-reading, or other security-sensitive primitives when an existing shared implementation applies.
4. Do not move caller-specific limits into shared code merely because the numeric values happen to match.
5. Do not introduce a universal fingerprint, storage, or retention abstraction unless multiple consumers have the same semantics and tests demonstrate that equivalence.
6. Any later attempt to remove the standalone collector requires a new ADR.

## Rejected alternative

Deprecating the standalone collector was considered and rejected for v0.6.

The collector already has a distinct supported role as a reusable TypeScript module and standalone browser bundle, while `collector.ts` itself is primarily composition and public API rather than a parallel implementation of extension architecture.

Removing it would reduce capability without resolving the actual duplication concerns addressed by Shared Core.
