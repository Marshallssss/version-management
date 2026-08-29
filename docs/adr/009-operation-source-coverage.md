# ADR-009: Deployment operation, source and coverage semantics

Status: Accepted  
Date: 2026-08-29

## Decision

Every batch records `operation_type`, `source_type` and `coverage_mode`. INSTALL/UPGRADE default to PARTIAL. INITIAL_SNAPSHOT and OBSERVATION require explicit FULL or PARTIAL. FULL means the fact covers the complete machine configuration and missing current components are represented by explicit ABSENT/REMOVE items; PARTIAL changes only listed components.

`related_batch_id` and `relation_type` connect future rollback and correction batches without rewriting history.

## Consequences

Imported or agent-observed state is not misrepresented as physical deployment. Import preview must show and require confirmation of coverage semantics.

