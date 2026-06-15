---
title: "deployment-designer"
description: Design deployment topology, environment configuration, release commands, rollback strategy, and post-deployment smoke test plan (Phase 3 Step 3).
---

Before code implementation, produce a complete deployment plan covering deployment topology, environment configuration, release commands, data migration, rollback strategy, and post-deployment smoke test design. This Skill is the entry point for **Phase 3 Step 3**.

## Trigger Conditions

- User asks to design a deployment plan, release plan, or go-live plan
- User mentions "Phase 3 Step 3", "deployment plan", or "部署方案"
- API/DB design is complete and the project needs to enter deployment planning
- `logos/resources/prd/3-technical-plan/3-deployment/` is empty

## Prerequisites

1. Architecture overview exists in `logos/resources/prd/3-technical-plan/1-architecture/`
2. Scenario implementation docs exist in `logos/resources/prd/3-technical-plan/2-scenario-implementation/`
3. API/DB design is complete, or the module has explicitly skipped those phases via `skip_phases`
4. `logos/logos-project.yaml` is readable

## Core Capabilities

1. Derive deployment targets from architecture, API, DB, and tech stack
2. Design deployment topology for local / test / staging / production environments
3. Define environment variables, secret sources, build commands, and release commands
4. Define data migration, seed data, and rollback strategy
5. Design post-deployment verification checklist
6. Design smoke test input for `test-writer` to generate `SMOKE-*` cases
7. Update `logos-project.yaml` deployment gate information

## Execution Steps

### Step 1: Read Context

Reads architecture overview, scenario docs, API specs, DB DDL, and existing deployment plans. Confirms whether the project needs deployment, what target environments exist, and what smoke coverage is needed.

### Step 2: Determine Deployment Gates

- Software projects require a deployment plan by default
- Projects with runtime environments require deployment execution and smoke by default
- Pure documentation, spec-only, or library projects can declare `deployment_required: false`

### Step 3: Output Deployment Plan

Writes to `logos/resources/prd/3-technical-plan/3-deployment/<module>-01-deployment-plan.md`:

- Deployment topology diagram (Mermaid)
- Environment matrix (local / staging / production)
- Build and release commands
- Environment variables and secrets
- Data migration strategy
- Rollback plan
- Post-deployment checklist
- Smoke test scope definition

Mermaid deployment topology diagrams must follow the same `graph` / `flowchart` syntax safety rule as architecture diagrams: use quoted labels in the form `ID["label"]`, such as `Pages["Cloudflare Pages"]`, `Worker["Cloudflare Worker<br/>staging"]`, and `PROXY["/voice/api proxy"]`. Avoid `PROXY[/voice/api proxy]`, because `[/` is Mermaid shape syntax and can break rendering. Use `subgraph "Staging Environment"` for subgraph names with spaces or symbols.

### Step 4: Update logos-project.yaml

Writes `deployment_gates` section:

```yaml
deployment_gates:
  <module>:
    deployment_required: true
    smoke_required: true
    environments:
      - staging
```

### Step 5: Design Smoke Test Input

Outputs a smoke scope summary that `test-writer` Skill consumes to generate `SMOKE-*` test case IDs in `logos/resources/test/smoke/`.

## Output Artifacts

| Artifact | Location |
|----------|----------|
| Deployment plan | `logos/resources/prd/3-technical-plan/3-deployment/<module>-01-deployment-plan.md` |
| logos-project.yaml update | `deployment_gates` section |
| Smoke scope input | Embedded in deployment plan for `test-writer` consumption |

## Related Skills

- [`architecture-designer`](/skills/architecture-designer) — Provides the architecture context this Skill reads
- [`test-writer`](/skills/test-writer) — Consumes smoke scope to generate `SMOKE-*` cases
- [`deployment-executor`](/skills/deployment-executor) — Executes the plan this Skill produces
