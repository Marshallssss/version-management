# ADR-010: Component adjacency tree and recursive SQL

Status: Accepted  
Date: 2026-08-29

## Decision

Components use an adjacency list with nullable parent and explicit sibling order. Recursive PostgreSQL CTEs serve tree reads; fixed depth columns and generic graph storage are rejected for Core V1.

## Consequences

Arbitrary depth remains possible with strong relational integrity and understandable migrations. Closure tables may be introduced only after measured query pressure.

