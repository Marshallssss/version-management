# ADR-006: Separate standard, target and actual configuration

Status: Accepted  
Date: 2026-08-29

## Decision

Project Standard, Machine Target and Machine Actual are separate concepts and storage paths. Drift compares Actual with the Machine Target effective at the comparison time, not automatically with the latest Project Standard.

## Consequences

Deliberately pinned, canary or hardware-constrained machines are not false positives. Each state remains independently traceable.

