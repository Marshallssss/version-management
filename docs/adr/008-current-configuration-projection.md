# ADR-008: Append facts plus explicit current configuration projection

Status: Accepted  
Date: 2026-08-29

## Decision

Deployment items are immutable facts. `machine_current_configurations` is a transactionally maintained, rebuildable projection. It stores `state_effective_at`, nullable `known_installed_at`, and `source_deployment_item_id`.

## Consequences

Current reads are fast without losing history. Observations never fabricate installation time; UI displays Unknown when it is not known and separately shows Last Observed/State Effective time.

