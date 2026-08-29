# ADR-012: Project clone copies template data only

Status: Accepted  
Date: 2026-08-29

## Decision

Project Clone copies component structure, custom-field definitions and project metadata templates by default. It does not copy software versions, released baselines, machines, target assignments, deployments, audit history or operational attachments.

## Consequences

Clone accelerates setup without manufacturing false operational history. Any optional draft-template cloning must be an explicit later feature.

