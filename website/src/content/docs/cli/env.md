---
title: "openlogos env"
description: List, inspect and validate the deployment environments registered in logos/environments.yaml.
---

`openlogos env` is the read-only view of your project's **environment registry** (`logos/environments.yaml`). It shows which version is currently deployed to each environment, the most recent deployment and smoke run, and validates the registry file. See [Environments](/specs/environments) for the full registry format.

Environments are **opt-in**: a project without `logos/environments.yaml` behaves exactly as before — `deploy-done`, `smoke` and `status` produce the same output and exit codes.

## Synopsis

```bash
openlogos env list [--format json]
openlogos env show <id|alias> [--format json]
openlogos env check [<id|alias>] [--probe] [--format json]
```

All three subcommands are read-only, do not require an active proposal, and run from the project root.

## Subcommands

| Subcommand | Description |
|------------|-------------|
| `openlogos env list` | Lists every registered environment with its aliases, current version, last deployment and last smoke run. Without a registry it returns an empty list (exit code 0). |
| `openlogos env show <id\|alias>` | Shows one environment: registry configuration, the view fields below and the 20 most recent ledger records (newest first). |
| `openlogos env check [<id\|alias>]` | Validates the registry: format, id / alias conflicts, `deployment_gates` references in `logos-project.yaml`, and whether every variable named in `secrets` exists in the current process environment (names only — values are never read or printed). |
| `env check --probe` | Additionally sends an HTTP GET to each environment's `health` and `version` URLs (5-second timeout). Without `--probe` no network request is made. |

`env show` and `env check` fail with `ENV_REGISTRY_NOT_FOUND` when the registry does not exist; `env show` reports `ENV_UNKNOWN` when the id or alias cannot be resolved. `env check` exits with code 1 when any error is found.

## Default environment for proposals

When the registry sets a top-level `proposal_default_env`, proposals that need deployment and do not name a target environment are deployed there by default (the change-writer Skill reads it instead of asking each time).

- `openlogos env list --format json` outputs `proposal_default_env` at the top level of `data`; the key is absent when not configured.
- In text mode the environment is marked **(proposal default)** — `（提案默认）` in Chinese.

The value must equal an environment `id` exactly (aliases are not accepted). An invalid value makes `env check` report `ENV_FIELD_INVALID` with `field=proposal_default_env` and the whole registry is treated as invalid.

## Environment view (EnvView)

`env list`, `env show` and `status --format json` (under `environments`) share one view per environment:

| Field | Meaning |
|-------|---------|
| `id` / `name` / `tier` / `aliases` | From the registry |
| `current_ref` | Commit of the most recent **successful** deployment with a confirmed version; `null` if never deployed or the version is unconfirmed |
| `previous_ref` | The successful version before `current_ref` — the target of `openlogos deploy --rollback` |
| `deploy_mode` | `script` / `ci` / `agent` from the environment's `deploy` configuration, or `null` |
| `deploy_in_progress` | The current deployment holding the environment, or `null` |
| `last_deploy` | Most recent deployment record of any result (`deploy_id`, `slug`, `ref`, `result`, `channel`, `mode`, `ref_requested`, `failure_reason`, …) |
| `last_smoke` | Most recent smoke record (`result`, `env_evidence`, `fresh_results`, `deploy_env_confirmed`, `verified`, …) |
| `promote_from` / `require_approval` / `open_approvals` / `promotion` | Only for environments that configure promotion or approval gates — see [`deploy`](/cli/deploy) and [`approve`](/cli/approve) |

`previous_ref`, `deploy_mode` and `deploy_in_progress` appear only once deployment execution is in use (some environment configures `deploy`, or the ledger contains records written by `openlogos deploy`). `env show --format json` also includes the validated `deploy` configuration of the environment (script, workflow, plan section and similar references — never commands or secret values).

## Example

```bash
openlogos env list
```

```
Environments (logos/environments.yaml)

  test  Test environment  [test]  (proposal default)
      aliases: qa
      current ref: 02355709cf74
      last deploy: 2026-10-16T14:30:37.505Z (add-notify-webhook)
      last smoke: pass (verified) at 2026-10-16T14:33:27.596Z
  prod  Production  [prod]
      aliases: production
      current ref: unknown
```

```bash
openlogos env check --probe --format json
```

```json
{ "command": "env check", "data": { "scope": null, "ok": true, "errors": [], "warnings": [], "secrets": [], "probes": [] } }
```

## Errors and warnings

| Code | Cause |
|------|-------|
| `ENV_REGISTRY_NOT_FOUND` | `env show` / `env check` without `logos/environments.yaml` |
| `ENV_REGISTRY_INVALID` | The registry exists but is invalid (YAML error, wrong `schema_version`, missing or invalid field, …) |
| `ENV_FIELD_INVALID` | A single field is invalid (reported per field by `env check`) |
| `ENV_DUPLICATE_ID_OR_ALIAS` | Two ids / aliases collide (case-insensitive) |
| `ENV_GATE_REFERENCE_UNKNOWN` | `deployment_gates.<module>.environments` names an unregistered environment |
| `ENV_SECRET_MISSING` | A variable named in `secrets` is not set in the current environment |
| `ENV_PROBE_FAILED` | `--probe` request failed, timed out or returned non-2xx |
| `ENV_UNKNOWN` | The id or alias cannot be resolved |
| `ENV_UNKNOWN_FIELD` | Warning only: an unknown field in the registry |

## Related commands

- [`deploy`](/cli/deploy) — Run the deployment configured for an environment
- [`approve`](/cli/approve) — Approve a commit for an environment that requires approval
- [`deploy-done`](/cli/deploy-done) — Record a deployment done outside `openlogos deploy`
- [`smoke`](/cli/smoke) — Post-deployment check with `--env`
- [Environments](/specs/environments) — Registry format, ledger and gates
