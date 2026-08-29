# ADR-004: Version lifecycle three-axis model

Status: Accepted  
Date: 2026-08-29

## Decision

Version lifecycle is modeled as three orthogonal axes: Maturity (`Draft`, `Testing`, `Released`, `Maintenance`, `Deprecated`), Safety (`Clear`, `Blocked`) and time-scoped Recommendation Assignment. Maturity and Safety current values are stored on the version for fast reads; Recommendation remains a relational assignment. Every transition is append-audited.

Block does not change Maturity. Unblock only changes Safety from Blocked to Clear; Maturity remains unchanged.

## Consequences

Safety incidents do not destroy lifecycle context. State transitions require domain commands and permissions; direct arbitrary status edits are forbidden.
