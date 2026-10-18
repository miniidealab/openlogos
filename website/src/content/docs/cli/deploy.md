---
title: "openlogos deploy"
description: Run the deployment configured for an environment in logos/environments.yaml, record it in the deployment ledger, and roll back to the previous version.
---

`openlogos deploy` runs the deployment that an environment declares under `deploy` in `logos/environments.yaml`, records the result in the local deployment ledger, and — in the proposal channel — writes the deployment report and the `DEPLOY_DONE` marker for you. It also enforces the environment's promotion and approval gates. See [Environments](/specs/environments) for the registry format.

## Synopsis

```bash
openlogos deploy --env <id|alias> [--ref <revision>] [--rollback] [--channel proposal|version] [--dry-run] [--format json]
openlogos deploy --env <id|alias> --complete <deploy_id> --result done|failed [--format json]   # agent mode
openlogos deploy --env <id|alias> --abandon <deploy_id> [--format json]                         # give up a pending record
openlogos deploy --env <id|alias> --reconcile [--format json]                                   # settle an unknown CI result
```

Requires `logos/environments.yaml`, an environment that configures `deploy`, and a git repository. Run from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--env <id\|alias>` | Target environment (required; no "only one environment" default). |
| `--ref <revision>` | Version to deploy, resolved to a full commit. Required in the version channel; the proposal channel defaults to `HEAD`. |
| `--rollback` | Redeploy the environment's `previous_ref` (version channel). Mutually exclusive with `--ref`. |
| `--channel proposal\|version` | Override the default channel. |
| `--dry-run` | Run every check and print the plan (channel, commit, script or workflow, expanded arguments) without creating a worktree, executing, or writing any file. |
| `--force-promote "<reason>"` | Skip the promotion check with a recorded reason. **Human-only** — see below. |
| `--complete <deploy_id> --result done\|failed` | Agent mode: record the result of a deployment the agent carried out. |
| `--abandon <deploy_id>` | Release a pending record (agent or CI) that will never finish; recorded as `result=unknown`, `failure_reason=abandoned`. |
| `--reconcile` | Query the remote CI run of a deployment whose result was unknown and record its final state. |
| `--format json` | Structured JSON envelope. |

## Deployment modes

| `deploy.mode` | What the CLI does |
|---------------|-------------------|
| `script` | Checks out the requested commit with `git worktree add --detach` in an isolated worktree and runs the repository script there as an argument array (no shell). The worktree has no untracked files, so the script installs and builds what it needs. `workdir: in-place` runs in the project instead, but only when `HEAD` equals the requested commit and the working tree is clean. |
| `ci` | `provider: github-actions` dispatches the workflow with `gh`, takes the run id from the dispatch response and polls it to completion. `provider: script` adapts other CI systems through a trigger script and a status script. The deployed version counts as confirmed only when the run reports the commit it actually deployed. |
| `agent` | Registers a pending record and returns the deployment plan section (`status: awaiting-agent`). The agent follows the plan, then runs `--complete <deploy_id> --result done\|failed`. |

Every mode receives `OPENLOGOS_DEPLOY_ENV`, `OPENLOGOS_DEPLOY_REF` (requested commit), `OPENLOGOS_DEPLOY_ID` and `OPENLOGOS_DEPLOY_CHANNEL`. The `deploy` configuration may only reference tracked repository scripts and `.github/workflows` files — never command strings — so changing what a deployment executes always means changing guarded files.

## Channels

- **Proposal channel** — the default when the active proposal is ready to deploy. Before running, the CLI checks the proposal (verify passed, deployment required, `[deploy]` tasks present). After a `script` or `ci` deployment it appends a report section to `logos/resources/verify/deployment-report.md`; on success it checks off `[deploy]` and writes `DEPLOY_DONE`, so you do not run `deploy-done` afterwards.
- **Version channel** — the default otherwise. Deploys `--ref` (or `--rollback`) independently of any proposal; the result goes only to the ledger and the deployment log.

## Rollback

```bash
openlogos deploy --env staging --rollback
```

Redeploys the environment's `previous_ref` using that version's own script, and records `rollback: true` and `rollback_from`. To go back further, deploy an explicit `--ref`. There are no snapshots — rollback is simply another deployment.

## Promotion and approval gates

Environments can declare two gates (see [Environments](/specs/environments)):

- `promote_from: <upstream id>` — the requested commit must already have a **verified** smoke on the upstream environment. Otherwise the command stops with `DEPLOY_PROMOTION_UNVERIFIED` and executes nothing.
- `require_approval: true` — the commit needs an unused approval from [`openlogos approve`](/cli/approve). Otherwise the command stops with `DEPLOY_APPROVAL_REQUIRED`; `error.details.approve_command` contains the exact command a human can run. An approval is used by one successful deployment.

`--force-promote "<reason>"` bypasses only the promotion check and records `promotion_override_reason`. Both `openlogos approve` and `deploy --force-promote` are **guard-restricted**: an AI assistant cannot run them without the host's native approval prompt, and unattended `--auto` runs stop at these gates instead of passing them.

## Logs and secrets

The full output is written to `logos/.openlogos-runtime/deploy-logs/<deploy_id>.log`; text mode streams it to the terminal, JSON mode includes only the last 80 lines or 8 KiB plus `log_path`. Secrets come only from the process environment. Every value of a variable declared in the environment's `secrets` is replaced with `***` in captured output, logs and JSON (values shorter than 4 characters are not masked).

Only one deployment can hold an environment at a time (`DEPLOY_IN_PROGRESS`). A CI deployment whose result is unknown keeps the environment held until `--reconcile` records the final state or `--abandon` releases it.

## Example

```bash
openlogos deploy --env staging --ref v1.2.0 --dry-run
openlogos deploy --env staging --ref v1.2.0
openlogos deploy --env prod --ref v1.2.0 --format json
```

## Errors

| Error code | Cause |
|------------|-------|
| `ENV_REGISTRY_NOT_FOUND` / `ENV_REGISTRY_INVALID` | No registry, or the registry is invalid |
| `ENV_REQUIRED` / `ENV_UNKNOWN` | `--env` missing or not resolvable |
| `DEPLOY_NOT_CONFIGURED` | The environment has no `deploy` configuration |
| `DEPLOY_ARGS_CONFLICT` | Incompatible options (for example `--ref` with `--rollback`) |
| `DEPLOY_REF_REQUIRED` / `ENV_REF_UNRESOLVED` | Version channel without `--ref` / `--rollback`, or the revision cannot be resolved |
| `DEPLOY_ROLLBACK_TARGET_MISSING` | `--rollback` but no `previous_ref` |
| `DEPLOY_PROMOTION_UNVERIFIED` | Promotion check failed — nothing executed |
| `DEPLOY_APPROVAL_REQUIRED` | No unused approval for this commit — nothing executed |
| `DEPLOY_SECRETS_MISSING` | A declared secret is not set (names only) |
| `DEPLOY_SCRIPT_MISSING` / `DEPLOY_SCRIPT_NOT_EXECUTABLE` | The script is missing or not executable in the requested commit |
| `DEPLOY_WORKTREE_MISMATCH` | `workdir: in-place` with a different `HEAD` or uncommitted changes |
| `DEPLOY_CI_UNAVAILABLE` / `DEPLOY_CI_REF_NOT_DISPATCHABLE` | `gh` unavailable or not logged in, or the dispatch ref does not resolve to the requested commit |
| `DEPLOY_IN_PROGRESS` | Another deployment holds the environment |
| `DEPLOY_PENDING_NOT_FOUND` | `--complete` / `--abandon` / `--reconcile` without a matching pending record |
| `DEPLOY_FAILED` | The deployment ran and failed (recorded as `result=failed`) |
| `DEPLOY_RESULT_UNKNOWN` | Triggered but the result is unknown (recorded as `result=unknown`; environment stays held) |
| `DEPLOY_RECORD_FAILED` | Deployed, but writing the ledger or marker failed — re-run to record it |

Warnings `DEPLOY_REF_UNCONFIRMED` (succeeded but the deployed version could not be confirmed) and `DEPLOY_WORKTREE_CLEANUP_FAILED` do not change the exit code.

## Related commands

- [`env`](/cli/env) — Inspect environments, `current_ref` and `previous_ref`
- [`approve`](/cli/approve) — Approve a commit for a gated environment
- [`smoke`](/cli/smoke) — Verify the deployment with `--env`
- [`deploy-done`](/cli/deploy-done) — Record a deployment done outside `openlogos deploy`
- [deployment-executor](/skills/deployment-executor) — The Skill that drives deployments
