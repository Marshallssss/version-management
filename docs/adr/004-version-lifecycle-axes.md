# ADR-004: Version lifecycle three-axis model

Status: Accepted  
Date: 2026-08-29

## Decision

Version lifecycle is modeled as three orthogonal axes: Maturity (`Draft`, `Testing`, `Released`, `Maintenance`, `Deprecated`), Safety (`Clear`, `Blocked`) and time-scoped Recommendation Assignment. Maturity and Safety current values are stored on the version for fast reads; Recommendation remains a relational assignment. Every transition is append-audited.

Block does not change Maturity. Unblock only changes Safety from Blocked to Clear; Maturity remains unchanged.

As of 2026-09-14, every non-deprecated maturity (`Draft`, `Testing`, `Released`, `Maintenance`) may transition directly to `Deprecated`, with the existing senior project permission, reason, audit and idempotency requirements. Defective versions need not be released before they can be retired. Deprecation revokes any active recommendation, but does not change Safety, frozen baseline snapshots or machine configuration facts. A deprecated version is already retired; a repeated request with the same idempotency key replays the result without adding another transition. This change does not enable transitions out of `Deprecated`.

## Consequences

Safety incidents do not destroy lifecycle context. State transitions require domain commands and permissions; direct arbitrary status edits are forbidden.
