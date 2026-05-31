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
- Target environment is clearly defined
- Rollback strategy is executable

### Step 4: Execute Deployment

For each deployment step:
1. State what will happen and which environment is affected
2. Execute the command
3. Record success/failure and timing
4. If failure occurs, suggest rollback or fix

### Step 5: Generate Deployment Report

Writes `logos/resources/verify/deployment-report.md`:
- Deployment steps executed
- Success/failure status per step
- Timing and environment details
- Any warnings or manual follow-ups needed

### Step 6: Guide Smoke Verification

After successful deployment:
- Remind user that `openlogos smoke` is the next human confirmation point
- Do not auto-run smoke without explicit authorization

## Output Artifacts

| Artifact | Location |
|----------|----------|
| Deployment report | `logos/resources/verify/deployment-report.md` |
| Proposal marker | `logos/changes/<slug>/DEPLOY_DONE` (if applicable) |

## Related Skills

- [`deployment-designer`](/skills/deployment-designer) — Produces the plan this Skill executes
- [`test-writer`](/skills/test-writer) — Designs smoke cases verified after deployment
