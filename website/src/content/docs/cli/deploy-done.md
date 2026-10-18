---
title: "openlogos deploy-done"
description: Record controlled deployment completion after verify passes and a human confirms the deploy (Gate 3.7).
---

After `verify` passes (Gate 3.6) and a human has confirmed the deployment, `openlogos deploy-done` records the completion in a controlled way. This closes **Gate 3.7** (deployment done, deployment report present, deployment marker written). It re-checks that verify passed, that the proposal actually requires deployment, and that the `[deploy]` tasks and the deployment report exist — only then does it check off the deploy tasks, write the `DEPLOY_DONE` marker, and clear any stale smoke markers.

## Synopsis

```bash
openlogos deploy-done [--env <name>] [--ref <git revision>] [--format json]
```

Must be run from the project root, with an active change proposal (guard file present).

`deploy-done` records a deployment that was carried out by someone else (a person, a CI pipeline, a tag-driven release). If the environment has a `deploy` configuration in `logos/environments.yaml`, prefer [`openlogos deploy`](/cli/deploy): on the proposal channel it runs the deployment and records completion in one step.

## Options

| Option | Description |
|--------|-------------|
| `--env <name>` | Target environment recorded with the completion (for example `staging`). Without a registry this is a free-form label; when `logos/environments.yaml` exists it must be an environment id or alias and is **required**. |
| `--ref <git revision>` | The version that was actually deployed (tag, branch or commit). It is resolved to a full 40-character commit and recorded in `DEPLOY_DONE` and the deployment ledger. Omitted → the version is recorded as unknown (`null`); HEAD at call time is never used as a substitute. |
| `--format json` | Output a structured JSON envelope for tools such as RunLogos. |

## What it does

- Confirms verify passed — evaluated against the resolved `verify` node's per-field predicate (marker `VERIFY_PASS`/`VERIFY_FAIL`, or a `cmd:`-gate), replacing a hard-coded marker check
- Requires an active proposal whose deployment decision resolves to "deployment required" (fails on a decision conflict or when deployment is not required)
- Requires a `[deploy]` task section in `tasks.md` and the deployment report at `logos/resources/verify/deployment-report.md`
- Checks off every task in the `[deploy]` section of `tasks.md`
- Writes the `logos/changes/<slug>/DEPLOY_DONE` marker
- Clears any stale `SMOKE_PASS` / `SMOKE_FAIL` markers from a previous run
- Reports `next_step`: `ready-to-smoke` (run `openlogos smoke`) or `deploy-done` (run `openlogos archive`)

This is a human-triggered, one-shot command — it fails loud on any missing precondition rather than partially recording completion.

## Environment registry and deployment ledger

When the project has a `logos/environments.yaml` registry (see [Environment Registry](/specs/environments)):

- `--env` is resolved against environment ids first, then aliases (case-insensitive); an unknown value fails with `ENV_UNKNOWN`, a missing one with `ENV_REQUIRED`. There is no "only one environment, so pick it" default.
- `DEPLOY_DONE` is written as a single JSON line, rewritten on every run:

  ```json
  {"deploy_id":"6f1c…","environment":"prod","ref":"<40-char commit>","ref_source":"explicit","recorded_at":"2026-10-14T08:00:00.000Z"}
  ```

- A `deploy` record is appended to the local deployment ledger `logos/.openlogos-runtime/deployments.jsonl` (the same ledger used by `smoke --env`, `deploy` and `env`). The ledger is written first and `DEPLOY_DONE` last, so a marker on disk always has its ledger record; if any step fails, tasks, markers and the ledger line are restored and the command ends with `DEPLOY_DONE_WRITE_FAILED`.
- `--format json` adds a `deployment` object (`deploy_id`, `environment`, `ref`, `ref_source`, `observed_head`, `ledger_written`).
- Environments with promotion or approval gates (`promote_from`, or `require_approval: true`) cannot be recorded by hand: `deploy-done --env` refuses them with `DEPLOY_DONE_GATED_ENV`. Deploy those environments with [`openlogos deploy`](/cli/deploy), which checks the gates first.

Without a registry, `deploy-done` behaves exactly as before: `--env` is stored as a plain label and no ledger is written.

## Example

```bash
openlogos deploy-done --env staging
```

```
OpenLogos deploy-done

  Proposal: add-notify-webhook
  Environment: staging
  Marker: logos/changes/add-notify-webhook/DEPLOY_DONE
  Deployment tasks: 3/3
  Cleared stale smoke markers: -

Next: explicitly request `openlogos smoke --env staging`.
```

If the proposal does not need smoke, the last line suggests `openlogos archive <slug>` instead.

## Errors

| Error code | Cause | Fix |
|------------|-------|-----|
| `PROJECT_NOT_INITIALIZED` | Not in the project root | `cd` to the project root |
| `NO_ACTIVE_CHANGE` / `CHANGE_NOT_FOUND` | No active proposal, or its directory is missing | Run only for an active proposal whose verify has passed |
| `VERIFY_NOT_PASSED` | Verify has not passed (or the `cmd:` verify gate failed) | Run `openlogos verify` and resolve `VERIFY_FAIL` |
| `DEPLOYMENT_DECISION_CONFLICT` | `proposal.md` and `tasks.md` disagree about deployment | Fix the deployment decision |
| `DEPLOYMENT_NOT_REQUIRED` | The proposal does not require deployment | Archive after verify passes |
| `DEPLOY_TASKS_MISSING` | No non-empty `[deploy]` section in `tasks.md` | Add the deployment tasks |
| `DEPLOYMENT_REPORT_MISSING` | `logos/resources/verify/deployment-report.md` is missing | Write the deployment report (deployment-executor) |
| `ENV_REGISTRY_INVALID` | `logos/environments.yaml` exists but is invalid | Fix it; `openlogos env check` lists every problem |
| `ENV_REQUIRED` / `ENV_UNKNOWN` | Registry present but `--env` missing, or it matches no id / alias | Pass a registered id or alias |
| `ENV_REF_UNRESOLVED` | `--ref` does not resolve to a commit | Pass an existing tag, branch or commit |
| `DEPLOY_DONE_GATED_ENV` | The environment has `promote_from` or `require_approval: true` | Use `openlogos deploy --env <id>` |
| `DEPLOY_DONE_WRITE_FAILED` | A write step failed after the checks passed | Read the message (it says what was restored) and re-run |

No tasks are checked, no marker is written and nothing is added to the ledger when any check fails.

## Related commands

- [`verify`](/cli/verify) — Gate 3.6 acceptance (must pass first)
- [`smoke`](/cli/smoke) — Post-deployment health check (Gate 3.8)
- [`deploy`](/cli/deploy) — Run the configured deployment for an environment
- [`env`](/cli/env) — See what each environment is running
- [`archive`](/cli/archive) — Archive the completed proposal
