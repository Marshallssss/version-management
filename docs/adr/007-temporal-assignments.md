# ADR-007: Temporal assignments with PostgreSQL exclusion constraints

Status: Accepted  
Date: 2026-08-29

## Decision

Machine Target and Project Standard are append-oriented assignment histories with `[valid_from, valid_to)` periods. PostgreSQL `btree_gist` GiST exclusion constraints prevent periods for the same owner from overlapping. A partial unique index permits only one open assignment, and a check requires `valid_to` to be null or greater than `valid_from`.

## Consequences

The history table is authoritative; no mutable pointer is required in the owner table. Reads use the indexed open row and remain constant-time for current assignments.

