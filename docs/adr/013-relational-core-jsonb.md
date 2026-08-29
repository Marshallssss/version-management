# ADR-013: Relational core with constrained JSONB metadata

Status: Accepted  
Date: 2026-08-29

## Decision

Identity, ownership, component/version/baseline links, state, temporal periods and traceability are relational columns with foreign keys. JSONB is limited to custom metadata values, import payload snapshots, job payloads and idempotent result snapshots.

## Consequences

Core queries remain indexable and enforceable. JSONB schemas are versioned at their application boundaries and never replace required domain relationships.

