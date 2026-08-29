# ADR-002: Modular monolith and one PostgreSQL database

Status: Accepted  
Date: 2026-08-29

## Decision

Core V1 is a modular monolith with explicit module boundaries and one PostgreSQL database. Modules communicate through application contracts, not network services.

## Consequences

Deployment, transactions, backup and diagnosis remain simple. Module ownership is preserved so a future extraction is possible, but no distributed-system cost is paid in V1.

