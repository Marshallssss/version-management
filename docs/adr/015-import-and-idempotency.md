# ADR-015: Unified import pipeline and persistent idempotency

Status: Accepted  
Date: 2026-08-29

## Decision

Excel, CSV, directory, agent and API adapters normalize into one staged pipeline: Preview, Validate, Dry Run, Commit and Audit. Newly discovered versions start as Draft. Command idempotency is persisted in `idempotency_records` with unique `(scope, idempotency_key)`, request hash, processing status, result/reference and expiry. External facts additionally use a partial unique constraint on `(source_type, external_event_id)`.

## Consequences

Retries survive process restarts and source replays do not duplicate facts. Import Commit, batch Finalize, target assignment, baseline release and version Block/Unblock all require idempotency keys.
