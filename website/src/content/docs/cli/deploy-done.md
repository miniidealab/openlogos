---
title: "openlogos deploy-done"
description: Record controlled deployment completion after verify passes and a human confirms the deploy (Gate 3.7).
---

After `verify` passes (Gate 3.6) and a human has confirmed the deployment, `openlogos deploy-done` records the completion in a controlled way. This closes **Gate 3.7** (deployment done, deployment report present, deployment marker written). It re-checks that verify passed, that the proposal actually requires deployment, and that the `[deploy]` tasks and the deployment report exist — only then does it check off the deploy tasks, write the `DEPLOY_DONE` marker, and clear any stale smoke markers.

## Synopsis

```bash
openlogos deploy-done [--env <name>] [--format json]
```

Must be run from the project root, with an active change proposal (guard file present).

## Options

| Option | Description |
|--------|-------------|
| `--env <name>` | Target environment label recorded with the completion (for example `staging`). |
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

No tasks are checked and no marker is written when any check fails.

## Related commands

- [`verify`](/cli/verify) — Gate 3.6 acceptance (must pass first)
- [`smoke`](/cli/smoke) — Post-deployment health check (Gate 3.8)
- [`archive`](/cli/archive) — Archive the completed proposal
