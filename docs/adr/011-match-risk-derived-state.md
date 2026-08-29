# ADR-011: Match/risk separation and hybrid derived state

Status: Accepted  
Date: 2026-08-29

## Decision

Configuration Match and Configuration Risk are independent outputs. Drift and impact use authoritative relational joins; current fleet summaries may be materialized and refreshed after mutations or jobs, while detail views validate against live source data.

## Consequences

A matching blocked version remains `Matched` with `Critical` risk. Cached summaries improve read-heavy screens without becoming historical truth.

