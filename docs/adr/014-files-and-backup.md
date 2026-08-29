# ADR-014: Filesystem attachment store and two backup modes

Status: Accepted  
Date: 2026-08-29

## Decision

PostgreSQL stores attachment metadata, immutable object key, size, media type and checksum; bytes live in a managed Windows filesystem store. Nightly backup is online (`pg_dump` plus file-store copy, manifest and checksum) with no planned application stop. Upgrade backup is quiesced: block writes, stop Worker, put IIS in maintenance mode, back up and verify before upgrading.

## Consequences

Database size remains controlled and restore units are explicit. Database and file backups share a manifest so mismatched restore sets are detectable.

