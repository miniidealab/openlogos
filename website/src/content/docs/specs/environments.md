---
title: Environments
description: The environment registry logos/environments.yaml, the local deployment ledger, smoke environment evidence, promotion and approval gates, and how the guard protects them.
---

OpenLogos can track **where** each version of your project is deployed. You register environments in `logos/environments.yaml`; [`openlogos deploy`](/cli/deploy), [`deploy-done`](/cli/deploy-done) and [`smoke`](/cli/smoke) record every deployment and smoke run in a local ledger; [`openlogos env`](/cli/env) and `status --format json` show the result.

This page summarizes the user-facing behavior. The normative definition is `logos/spec/environments.md` (deployed into your project by `init` / `sync`).

## Opt-in and scope

- Environment management is **opt-in**: it is enabled when `logos/environments.yaml` exists. Without it, `deploy-done`, `smoke` and `status` behave exactly as before. `openlogos deploy` and `openlogos approve` require the registry.
- It is **single-machine**: environment definitions live in the repository (shared), while deployment state and history stay in the local runtime directory and are never committed or synced.
- Projects that do not write `promote_from` / `require_approval` see no gate behavior at all.

## The registry `logos/environments.yaml`

```yaml
schema_version: 1
proposal_default_env: staging        # optional: default target for proposals that need deployment
environments:
  - id: staging
    name: Staging
    tier: staging
    aliases: [stage, 预发]
    health: https://staging.example.com/healthz
    secrets: [STAGING_DEPLOY_TOKEN]   # variable names only, never values
    deploy:
      mode: script
      script: deploy/deploy.sh
      args: ["{env}", "{ref}"]
  - id: prod
    name: Production
    tier: prod
    aliases: [production, 生产]
    deploy:
      mode: ci
      provider: github-actions
      workflow: deploy.yml
    promote_from: staging
    require_approval: true
```

| Field | Notes |
|-------|-------|
| `schema_version` | Must be `1` |
| `proposal_default_env` | Optional. Must equal an environment `id` exactly (no aliases). Proposals that need deployment and name no target default to it |
| `environments[].id` | `^[a-z0-9][a-z0-9-]*$`, unique |
| `name` / `tier` | Required; `tier` is `dev`, `test`, `staging` or `prod` |
| `aliases` | Optional; ids and aliases must be unique case-insensitively |
| `description` / `health` / `version` | Optional; `health` / `version` are http(s) URLs probed by `env check --probe` |
| `secrets` | Optional environment variable **names** the deployment needs |
| `deploy` | Optional deployment configuration — `mode: script \| ci \| agent` plus mode-specific references (`script`, `args`, `workdir`, `timeout_sec`, `provider`, `workflow`, `workflow_ref`, `inputs`, `trigger_script`, `status_script`, `plan_section`). Command strings such as `run` or `shell` are rejected |
| `promote_from` | Optional, only with `deploy`. Another environment's `id`; no self-reference, no cycles |
| `require_approval` | Optional boolean, only with `deploy` |

Unknown fields produce the warning `ENV_UNKNOWN_FIELD`. An invalid registry (`ENV_REGISTRY_INVALID`) makes `deploy-done`, `smoke`, `deploy` and `approve` refuse to run (fail-closed); `status` reports `environment_registry_error` instead of crashing. Write `promote_from` and `require_approval` as plain keys — escaped key spellings are rejected.

## Resolving `--env`

- Without a registry, `--env <label>` is a free-form label.
- With a registry, the input is matched against ids, then aliases, case-insensitively; no match is `ENV_UNKNOWN`. `deploy-done` and `smoke` require `--env` once a registry exists (`ENV_REQUIRED`) — there is no "only one environment" default.

## `DEPLOY_DONE` content

`deploy-done --env <id> [--ref <revision>]` and the proposal channel of `openlogos deploy` write the marker as one JSON line:

```json
{"deploy_id":"6f1c…","environment":"staging","ref":"<40-character commit>","ref_source":"explicit","recorded_at":"2026-10-14T08:00:00.000Z"}
```

`ref` is the version actually deployed, or `null` when `--ref` was not given — the current `HEAD` is never assumed. A corrupted non-empty marker makes `smoke` stop with `SMOKE_DEPLOY_MARKER_INVALID`; empty markers from older CLIs are still accepted.

## The deployment ledger `deployments.jsonl`

`logos/.openlogos-runtime/deployments.jsonl` is an append-only local ledger written only by the CLI (AI editing tools are always blocked from this directory):

| `kind` | Written by | Key fields |
|--------|-----------|-----------|
| `deploy` | `deploy-done --env`, `openlogos deploy` | `deploy_id`, `ref` (confirmed version), `ref_requested`, `result` (`done` / `failed` / `unknown`), `channel`, `mode`, `rollback`, `failure_reason`, `log_path` |
| `smoke` | `smoke --env` | `deploy_id`, `ref`, `result`, `env_evidence`, `fresh_results`, `deploy_env_confirmed`, `verified` |
| `approval` | `openlogos approve` | `approval_id`, `ref`, `approver`, `note` |

A smoke record is **verified** only when the smoke passed, environment evidence is `declared`, the results come from this run (`fresh_results`), the deployed environment is confirmed and the version is known. Only verified smokes count as "this commit passed smoke in this environment" — which is what promotion checks rely on.

From the ledger, every environment gets a `current_ref` (last successful, confirmed version) and a `previous_ref` (the rollback target). Malformed lines are skipped and counted as `corrupt_lines`.

## Smoke environment evidence

- `openlogos smoke --env <id>` runs `smoke.command` with `OPENLOGOS_SMOKE_ENV=<id>`.
- Smoke runners declare the environment they actually checked by writing `target_environment` on each result row.
- If any row names a different environment, the gate fails with `SMOKE_ENV_EVIDENCE_MISMATCH`. If every row declares the right environment the evidence is `declared`; rows without the field give `missing` — the gate still works as before, but the smoke is not `verified`.
- When the environment was deployed again after the proposal recorded its deployment, smoke stops with `SMOKE_DEPLOY_SUPERSEDED`.

## Promotion and approval

- **Promotion** (`promote_from`): deploying commit X to the environment requires a verified smoke of X on the upstream environment, otherwise `DEPLOY_PROMOTION_UNVERIFIED`. Only the direct upstream is checked. `--rollback` skips it; a human can bypass it with `deploy --force-promote "<reason>"`, which is recorded.
- **Approval** (`require_approval: true`): deploying commit X requires an unused approval for X written by [`openlogos approve`](/cli/approve), otherwise `DEPLOY_APPROVAL_REQUIRED` with a ready-to-run approve command. The first successful deployment uses the approval; rollbacks need approval too.
- Both checks run before anything executes and are re-checked after the environment lock is taken. `deploy-done --env` refuses gated environments (`DEPLOY_DONE_GATED_ENV`) — use `openlogos deploy`.
- Unattended `--auto` runs treat "approval missing" and "promotion not satisfied" as hard stops in every mode. The AI cannot approve, force a promotion, switch environment or version, fall back to manual deployment or edit the gated registry to get past them.

## Guard rules

- `logos/environments.yaml` is a built-in default of `guard.exempt`: as operational configuration it can be edited without a change proposal. Projects that configured `guard.exempt` explicitly need `openlogos exempt add logos/environments.yaml` to get this.
- Once the registry contains `promote_from` or `require_approval` (or any backslash, since the guard cannot then prove there is no gate), it becomes a **gate policy source**: the exemption no longer applies, an active proposal is not enough, and direct AI edits, deletes or moves go through the host's native approval (blocked in non-interactive modes).
- `openlogos approve` and `openlogos deploy --force-promote` are guard-restricted commands that only a human can authorize.
- `deploy` only executes tracked repository scripts and workflows, which the guard already protects — changing what a deployment runs always requires a change proposal.

## Related

- [`env`](/cli/env) · [`deploy`](/cli/deploy) · [`approve`](/cli/approve) · [`deploy-done`](/cli/deploy-done) · [`smoke`](/cli/smoke)
- [Change Management](/specs/change-management) · [PreToolUse Guard](/specs/pretooluse-guard)
- [deployment-designer](/skills/deployment-designer) · [deployment-executor](/skills/deployment-executor)
