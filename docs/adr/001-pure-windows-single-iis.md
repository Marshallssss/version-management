# ADR-001: Pure Windows single-IIS production topology

Status: Accepted  
Date: 2026-08-29

## Decision

Production uses Windows Server + IIS + one ASP.NET Core application. The host serves `/api/v1/*` and the compiled React SPA from `wwwroot`, with SPA fallback for non-API routes. PostgreSQL runs as a Windows service and background work runs in a separate Windows Worker service.

## Consequences

There is one user-facing origin and one IIS application to install, secure and troubleshoot. The system does not require Linux, Hyper-V or Docker. API and UI remain independently structured in source and may be split later only through a new ADR.

