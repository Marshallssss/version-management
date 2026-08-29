# ADR-005: Immutable baseline revisions

Status: Accepted  
Date: 2026-08-29

## Decision

A baseline has a stable series identity and independent revision records. Released revision content is immutable; changed configuration creates a new revision. The same top software version may therefore map to multiple revisions over time.

## Consequences

Historical standard configuration stays reproducible. Metadata shown as current context may evolve, but baseline item identities and version references never mutate after release.

