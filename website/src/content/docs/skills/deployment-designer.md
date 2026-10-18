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
8. Produce the environment registry `logos/environments.yaml`, with `deploy` entries and deploy scripts for environments that OpenLogos can deploy (see [Environment Registry](/specs/environments))

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

### Step 4.1: Produce the Environment Registry

When the plan names concrete environments (test, staging, production…), the Skill writes or updates `logos/environments.yaml`. It only registers environments the plan really has; with no environment split it writes no registry (the registry is opt-in).

```yaml
schema_version: 1
environments:
  - id: staging
    name: Staging
    tier: staging
    aliases: [pre]
    health: https://staging.example.com/healthz
    secrets: [STAGING_DEPLOY_TOKEN]   # variable names only, never values
    deploy:
      mode: script
      script: deploy/staging.sh
      args: ["{env}", "{ref}"]
  - id: prod
    name: Production
    tier: prod
    deploy:
      mode: ci
      provider: github-actions
      workflow: deploy.yml
```

- **Choosing the mode**: an existing GitHub Actions deploy workflow → `mode: ci`, `provider: github-actions`; another CI → `mode: ci`, `provider: script` with repository `trigger_script` / `status_script`; scriptable steps without a pipeline → `mode: script`; steps that still need human or AI judgement → `mode: agent` with `plan_section` naming the plan section.
- **No commands in the registry**: `deploy` only references repository scripts and workflows plus arguments and timeouts — never `run`, `command` or `shell` fields. The registry can be edited without a proposal, while the scripts are protected files, so changing what a deployment executes always needs a proposal.
- **Deploy scripts** live in tracked paths (default `deploy/<env>.sh`) with the executable bit, run in an isolated worktree of the target commit (so they install dependencies and build themselves), exit non-zero on failure, never print secret values, and are idempotent. They can read `OPENLOGOS_DEPLOY_ENV`, `OPENLOGOS_DEPLOY_REF`, `OPENLOGOS_DEPLOY_ID` and `OPENLOGOS_DEPLOY_CHANNEL`.
- **CI workflows** must report the commit they actually deployed by uploading the `openlogos-deploy-result` artifact (`result.json` with `deployed_ref`); without it the deployed version is recorded as unknown.
- **Promotion and approval gates are optional**: for `tier: prod` the Skill *suggests* `promote_from` and `require_approval: true` and explains that `--auto` runs will stop at them, but it never switches them on by itself — you decide.
- **`proposal_default_env` is written only when you explicitly name an environment.** The Skill explains what the field does (proposals that need deployment default to that environment instead of asking each time) and lets you pick one or leave it unset; it never sets, changes or removes the value on its own.
- **Self-check, no real deployment**: for each environment with `deploy` it runs the read-only `openlogos env check` and `openlogos deploy --env <id> --ref <commit> --dry-run` (a gated environment reporting `DEPLOY_PROMOTION_UNVERIFIED` / `DEPLOY_APPROVAL_REQUIRED` is the expected result), plus `bash -n` on shell scripts. It never runs a real deployment, `openlogos approve` or `--force-promote`.

For environments with `deploy`, the plan also gains a "deploy script review summary": what each script or workflow does, which external resources it touches, which secret names it needs, and how it fails and rolls back.

### Step 5: Design Smoke Test Input

Outputs a smoke scope summary that `test-writer` Skill consumes to generate `SMOKE-*` test case IDs in `logos/resources/test/smoke/`.

## Output Artifacts

| Artifact | Location |
|----------|----------|
| Deployment plan | `logos/resources/prd/3-technical-plan/3-deployment/<module>-01-deployment-plan.md` |
| logos-project.yaml update | `deployment_gates` section |
| Environment registry (when the plan has concrete environments) | `logos/environments.yaml` |
| Deploy scripts (script mode) / CI adapter scripts | Tracked repository paths, default `deploy/<env>.sh` |
| Smoke scope input | Embedded in deployment plan for `test-writer` consumption |

## Related Skills

- [`architecture-designer`](/skills/architecture-designer) — Provides the architecture context this Skill reads
- [`test-writer`](/skills/test-writer) — Consumes smoke scope to generate `SMOKE-*` cases
- [`deployment-executor`](/skills/deployment-executor) — Executes the plan this Skill produces
- [`openlogos env`](/cli/env) / [`openlogos deploy`](/cli/deploy) — Validate the registry and dry-run the configured deployments
