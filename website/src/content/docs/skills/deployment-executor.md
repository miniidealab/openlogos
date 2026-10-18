---
title: "deployment-executor"
description: Execute deployment tasks after verify passes, with explicit human authorization, and guide smoke verification.
---

After `openlogos verify` passes, execute deployment tasks according to the merged deployment plan — only with explicit human authorization. This Skill handles **Phase 3 Step 7** (Deployment Execution) and guides the user toward `openlogos smoke` (Phase 3 Step 8).

## Trigger Conditions

- User explicitly requests deployment execution
- User says "execute deployment", "deploy to staging/production", or "按部署方案部署"
- Current proposal `tasks.md` has a `[deploy]` section
- Initial phase verify has passed and deployment to target environment is needed

## Prerequisites

1. **Explicit human authorization** — deployment is a human confirmation point
2. Deployment plan exists in `logos/resources/prd/3-technical-plan/3-deployment/`
3. Current proposal has `VERIFY_PASS` marker
4. `tasks.md` contains a `[deploy]` section
5. Required commands, environment variables, and rollback strategy are declared in the plan

If any prerequisite is not met, the Skill stops and explains what's missing.

## Core Capabilities

1. Read deployment plan and current proposal deployment tasks
2. Break deployment tasks into executable steps
3. Explain purpose, affected environment, and rollback point before critical commands
4. Execute deployment commands and record results
5. Generate deployment report
6. Write deployment completion marker
7. Guide user to run `openlogos smoke`

## Execution Steps

### Step 1: Confirm Authorization

Deployment is a human confirmation point. Must see explicit user intent:
- "Execute deployment"
- "Deploy to staging"
- "按部署方案部署"

Cannot auto-deploy because user said "continue" or "finish the workflow."

### Step 2: Read Deployment Context

Reads:
- `logos/resources/prd/3-technical-plan/3-deployment/*.md`
- Current proposal `proposal.md`
- Current proposal `tasks.md` `[deploy]` section
- Merged main specs

### Step 3: Pre-flight Checks

Verifies:
- Current proposal is `VERIFY_PASS`
- No incomplete code tasks remain
- Target environment is clearly defined — with a `logos/environments.yaml` registry, what you said ("deploy to test") is resolved to a registered environment id (the read-only `openlogos env show <alias>` helps); if it does not resolve, the Skill stops and asks instead of guessing
- Rollback strategy is executable
- The version to deploy is clear — when CI deploys a specific commit or artifact, that commit counts, not the working-tree HEAD

### Step 4: Execute Deployment

The Skill first reads the target environment's mode with `openlogos env show <id> --format json`.

**Environment configured with `deploy.mode: script` or `ci`** — OpenLogos runs the deployment; the Skill does **not** run the plan's steps by hand:

```bash
openlogos deploy --env <id> --dry-run --format json   # optional: show what will run
openlogos deploy --env <id> --format json
```

On a proposal that is ready to deploy this is the proposal channel: the CLI checks executability, runs the script or triggers and watches the CI run, appends the deployment report from the actual result, and on success checks off `[deploy]` and writes `DEPLOY_DONE`. The Skill does not pre-write the report and does not run `openlogos deploy-done` afterwards.

- `DEPLOY_FAILED` — report `failure_reason`, `log_path`, the output tail and a rollback suggestion. Never fall back to a manual deployment, and never retry with another environment or version.
- `DEPLOY_RESULT_UNKNOWN` — report the CI run URL; reconcile later with `openlogos deploy --env <id> --reconcile`, and only `--abandon <deploy_id>` once the remote run is known not to continue.
- `DEPLOY_IN_PROGRESS` — stop and report the holder; never delete locks or pending records.
- `DEPLOY_RECORD_FAILED` — deployed but not recorded: follow `details` and re-run `deploy` (or `deploy-done --env --ref`); never write markers by hand.
- `DEPLOY_PROMOTION_UNVERIFIED` — "promotion not met": stop and show the upstream's last verified version (`details.upstream_candidate_ref`) for you to decide.
- `DEPLOY_APPROVAL_REQUIRED` — "waiting for approval": stop and hand you `details.approve_command` verbatim to run yourself (`! <command>` in Claude Code, or the RunLogos UI); then this step is run again.

In **any** mode, including `--auto`, the Skill never runs `openlogos approve`, never adds `--force-promote`, never switches environment or version, never deploys by hand or via `deploy-done` to get past a gate, and never edits `logos/environments.yaml` to switch a gate off.

**Environment configured with `deploy.mode: agent`** — two phases: `openlogos deploy --env <id>` returns `status: awaiting-agent` with a `deploy_id` and the plan section; the Skill carries out that section step by step, writes the report, then records the result with `openlogos deploy --env <id> --complete <deploy_id> --result done` (or `--result failed`, or `--abandon <deploy_id>`).

**No registry, or the environment has no `deploy`** — the Skill follows the plan step by step as before: for each step it states what will happen and which environment is affected, executes only commands defined in the plan, records the result, and suggests a rollback or fix on failure.

### Step 5: Generate Deployment Report

`logos/resources/verify/deployment-report.md`:
- **script / ci**: appended automatically by `openlogos deploy` from the actual result (time, environment, channel and mode, `deploy_id`, requested and confirmed version, script or workflow and run URL, duration, result, log path, rollback point). The Skill may add what the CLI cannot know (manual business checks, open risks) but never rewrites the CLI's result.
- **agent, or no `deploy` configuration**: written by the Skill — steps executed, success/failure per step, timing and environment details, warnings and manual follow-ups.

### Step 6: Record Completion

- **script / ci / agent**: `openlogos deploy` (or `--complete … --result done`) already recorded completion on the proposal channel; the Skill only checks `proposal.marker_path` and `ledger_written` in the output.
- **No `deploy` configuration**: the Skill runs [`openlogos deploy-done`](/cli/deploy-done). With a registry it must pass the resolved environment and the version actually deployed: `openlogos deploy-done --env staging --ref <revision>`. If the real version cannot be confirmed it omits `--ref`, and the following smoke will not count as verified.
- After any failed deployment: no `deploy-done`, no hand-written `DEPLOY_DONE`.

### Step 7: Guide Smoke Verification

After successful deployment:
- Remind user that `openlogos smoke` is the next human confirmation point; with a registry it must target the same environment: `openlogos smoke --env <id>`
- Do not auto-run smoke without explicit authorization (under `--auto` it is covered by the standing authorization)
- On `SMOKE_ENV_MISMATCH`, `SMOKE_DEPLOY_MARKER_INVALID` or `SMOKE_DEPLOY_SUPERSEDED`, stop and report; never patch `DEPLOY_DONE` by hand

## Output Artifacts

| Artifact | Location |
|----------|----------|
| Deployment report | `logos/resources/verify/deployment-report.md` |
| Proposal marker | `logos/changes/<slug>/DEPLOY_DONE` (if applicable) |
| Deployment ledger record | `logos/.openlogos-runtime/deployments.jsonl` (written by the CLI when a registry exists) |

## Related Skills

- [`deployment-designer`](/skills/deployment-designer) — Produces the plan this Skill executes
- [`test-writer`](/skills/test-writer) — Designs smoke cases verified after deployment
- [`openlogos deploy`](/cli/deploy) / [`openlogos deploy-done`](/cli/deploy-done) / [`openlogos smoke`](/cli/smoke) — The commands this Skill drives
