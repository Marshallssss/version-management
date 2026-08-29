# ADR-016: Observation integrity and installation-time provenance

Status: Accepted
Date: 2026-08-29

## Context

ADR-008 and ADR-009 establish rebuildable current configuration and explicit FULL/PARTIAL coverage. Before a Machine Agent or Directory Watcher is introduced, the implementation needs two non-negotiable guards: an incomplete observation cannot be used to infer absence, and an observation timestamp cannot replace an installation timestamp.

## Decision

A `FULL` INITIAL_SNAPSHOT or OBSERVATION can finalize as FULL only after the source has declared complete coverage and every row has a resolved machine/component identity and a successful terminal result. A failed, skipped, unresolved, paginated-incompletely, or interrupted row prevents FULL finalization. The operator must repair and retry, or explicitly choose PARTIAL. Only a validated FULL finalization can create `ABSENT` facts; `REMOVE` remains reserved for evidence of a physical removal.

The fact model records nullable `observed_at` independently from `effective_at` and `recorded_at`. The current projection adds nullable `last_observed_at` and `installation_source_deployment_item_id` alongside `state_effective_at`, `known_installed_at`, and `source_deployment_item_id`.

An Observation for the same installed Component+Version updates its observation and source-fact metadata without changing a known installation time. A different observed Version with no source-provided installation time starts an installation instance with `known_installed_at = null`. `REMOVE` and `ABSENT` end the installation instance.

## Consequences

Adapters must report completeness and terminal row outcomes before calling Finalize. Projection rebuild tests must preserve known installation time across same-version observations, expose Unknown for a newly observed version with no install evidence, and prove that invalid FULL input emits no `ABSENT` facts.
