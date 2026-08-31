# ADR-017: Windows 11 or Windows Server IIS deployment host

Status: Accepted
Date: 2026-08-31

## Decision

ConfigHub supports IIS deployment on Windows 11 Pro/Enterprise as well as Windows Server. The existing single-IIS Host, PostgreSQL Windows service, and independent ConfigHub Worker topology remains unchanged.

## Consequences

`ops/windows/preflight.ps1` treats either supported Windows host as eligible and checks IIS through the Server role API or the Windows optional-feature API as appropriate. Deployment acceptance still requires an elevated session, IIS, .NET Hosting Bundle, PostgreSQL service and client tools, protected machine configuration, TLS, backup destination, Worker service, and HTTPS readiness. Windows 11 support does not waive any of these operational controls.
