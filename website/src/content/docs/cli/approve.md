---
title: "openlogos approve"
description: Approve one commit for an environment that requires approval before deployment. Human-only.
---

`openlogos approve` records a human approval for deploying one exact commit to an environment that sets `require_approval: true` in `logos/environments.yaml`. [`openlogos deploy`](/cli/deploy) refuses to deploy such an environment with `DEPLOY_APPROVAL_REQUIRED` until a matching, unused approval exists.

## Synopsis

```bash
openlogos approve --env <id|alias> --ref <revision> [--note <text>] [--format json]
```

Run from the project root. No active proposal is required.

## Options

| Option | Description |
|--------|-------------|
| `--env <id\|alias>` | Target environment (required). It must set `require_approval: true`. |
| `--ref <revision>` | Commit to approve (required), resolved with `git rev-parse <revision>^{commit}` to a full 40-character commit. |
| `--note <text>` | Optional note stored with the approval. |
| `--format json` | Structured JSON envelope. |

## What it does

- Writes one `kind=approval` record to the local deployment ledger `logos/.openlogos-runtime/deployments.jsonl`, with a new `approval_id`, the commit, the original `--ref` text, the approver (`git config user.name <user.email>`, display only — not authentication) and the note.
- **Idempotent**: if the environment already has an unused approval for the same commit, it returns that approval with `created=false` and writes nothing. Concurrent runs write a single record.
- An approval is bound to one exact commit and is **used by the first successful deployment** of that commit to that environment. Deploying the same commit again needs a new approval; an approval for another commit never unlocks this one. Failed or unknown deployments do not use it.
- There is no revoke or expiry.

`openlogos env show <id>` lists unused approvals under `open_approvals`.

## Human-only

`openlogos approve` is a **guard-restricted command**. When an AI assistant tries to run it, the host shows its native approval prompt (and blocks it in unattended modes). Run it yourself in a terminal — for example `! openlogos approve --env prod --ref v1.2.0` in Claude Code — or from the RunLogos interface. Unattended `--auto` runs stop at environments that require approval and continue after you approve and re-drive them.

## Example

```bash
openlogos approve --env prod --ref v1.2.0 --note "release checklist signed off"
```

```json
{ "command": "approve", "data": { "environment": "prod", "approval_id": "3b0c…", "created": true, "ref": "<40-character commit>", "ref_input": "v1.2.0" } }
```

Running the same command again before the deployment returns the same `approval_id` with `"created": false`.

## Errors

| Error code | Cause |
|------------|-------|
| `ENV_REGISTRY_NOT_FOUND` / `ENV_REGISTRY_INVALID` | No registry, or the registry is invalid |
| `ENV_REQUIRED` / `ENV_UNKNOWN` | `--env` missing or not resolvable |
| `APPROVAL_NOT_REQUIRED` | The environment does not set `require_approval: true` |
| `APPROVAL_REF_REQUIRED` | `--ref` missing |
| `ENV_REF_UNRESOLVED` | The revision does not resolve to a commit |
| `APPROVAL_WRITE_FAILED` | Appending to the ledger failed (including lock timeout); the ledger is unchanged |

## Related commands

- [`deploy`](/cli/deploy) — Deployment with promotion and approval gates
- [`env`](/cli/env) — `open_approvals` and the environment view
- [Environments](/specs/environments) — `require_approval`, `promote_from` and the ledger
