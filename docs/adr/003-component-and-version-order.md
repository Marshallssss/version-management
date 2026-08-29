# ADR-003: Software component boundary and explicit version sequence

Status: Accepted  
Date: 2026-08-29

## Decision

Core V1 keeps `SoftwareComponent` as the domain name while its relational shape permits future configuration-item categories. `version_number` is an opaque identifier. `component_versions.sequence_no` explicitly orders versions within one component and is never inferred from the version string.

## Consequences

Selectors sort by `sequence_no`, then release date. Recommendation and upgrade logic may use sequence plus policy, but never lexical version comparison. Project Clone does not copy versions, so sequence numbers are not inherited across projects.

