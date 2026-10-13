---
title: brownfield-adopter
description: Optional accelerator for adopted projects — reverse-scan the existing code into a verified:false system map and scenario candidates, committed through openlogos baseline-seed.
---

Reverse-scan an existing codebase and record what can be verified from the code — a system map and a list of scenario candidates — as a **current-state seed**. The seed is written to a private staging area and committed by the `openlogos baseline-seed` command, never edited into `logos/resources/` directly.

This Skill is an **explicit, optional** accelerator. It is not the default next step after `openlogos adopt`, and it never decides whether you may create a change. If you skip it entirely, [`change-writer`](/skills/change-writer) still fills in the formal specs for the scenarios each change touches.

## Phase & Trigger

- **Phase**: Existing-project onboarding (adopted projects, `bootstrap: adopted`)
- **Trigger conditions**:
  - You explicitly ask to "build a current-state seed", "pre-scan the whole codebase", or "run baseline-seed"
  - You ask to resume or rescan a safe open run / uncommitted staging
- **Never triggered automatically** just because `adopt` finished or because `status` / `next` show `baseline_seed_state: required` or `partial`. None of the seed states is a prerequisite for change, plan, delta, merge, or verify.

## Prerequisites

1. `logos/logos.config.json` exists and the target module is registered as an adopted module in `logos-project.yaml` (`baseline-seed` rejects other modules).
2. The AI session has read access to the codebase.
3. The CLI supports `openlogos baseline-seed begin | commit | status` (0.16.0 does).

Unlike the other Skills, `brownfield-adopter` is not copied into `logos/skills/` by `init` / `sync`. It ships with the npm package (`skills/brownfield-adopter/SKILL.md`) and with the OpenLogos Claude Code plugin; ask the AI to load it when you want a seed.

## The `openlogos baseline-seed` command

`openlogos baseline-seed` is the only writer of the seed state and of the seeded target documents. The AI writes only into the run's staging directory.

| Subcommand | Purpose |
|---|---|
| `openlogos baseline-seed begin --module <id> --manifest <path>` | Validate the logical plan (manifest), create a private staging directory `logos/resources/verify/baseline-seed-runs/<run_id>/staging/`, and return a `run_id`. A previous open run of the same module is superseded. |
| `openlogos baseline-seed commit --module <id> --run-id <id>` | Validate the staged bytes (paths, schema, candidate keys) and commit them atomically together with the index and the `seeded` state. |
| `openlogos baseline-seed status --module <id>` | Show the current run, the seed state, and how many expected items are staged or missing. |

All three accept `--format json`.

The module's seed state is one of:

| `baseline_seed_state` | Meaning |
|---|---|
| `required` | No seed committed yet (the default after `adopt`). Informational only — you can create changes right away. |
| `partial` | Some staged items were valid but the set was incomplete; nothing was committed. Uncommitted staging never enters the effective view. |
| `seeded` | A complete seed was committed. Later changes can use it to locate evidence faster. |

## What It Does

1. **Confirms the intent and the recovery gate** — checks that you really asked for an eager seed (not a normal adopt → change), and recovers any unfinished commit journal first. If it reports `baseline_commit_in_progress`, the Skill stops.
2. **Scans the code and plans a manifest** — a logical plan without content hashes, with at least a `system-map` and a `scenario-candidates` entry:

   ```json
   {
     "module": "core",
     "expected": [
       { "kind": "system-map", "target_path": "logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md", "candidate_keys": ["core::<hash>"] },
       { "kind": "scenario-candidates", "target_path": "logos/resources/prd/3-technical-plan/2-scenario-implementation/core-scenario-candidates.md", "candidate_keys": ["core::<hash>"] }
     ]
   }
   ```

   A candidate key is `<module>::<first 12 hex chars of sha256(normalized anchor)>`, where the anchor is a semantic identifier such as a CLI command, an exported entry point, or a route. Target paths must be project-relative and inside the allowed `logos/resources/` targets.
3. **Begins a run** —

   ```bash
   openlogos baseline-seed begin --module core --manifest .logos-seed-plan.json --format json
   ```

4. **Writes the documents into staging** — each document goes to `staging/<target_path>` and carries a `## 逆向基线来源` (reverse-engineered baseline source) section with a fenced YAML `candidates[]` list. Every candidate is `state: active` and `verified: false`; the staged key set must equal the manifest's `candidate_keys`.
5. **Commits the run** —

   ```bash
   openlogos baseline-seed commit --module core --run-id <run_id> --format json
   ```

   - all required kinds present and every expected item valid → committed atomically, state becomes `seeded`;
   - at least one valid item but the set is incomplete → `partial`, nothing committed; fill in staging and rerun `commit`;
   - no valid item → state unchanged.
6. **Hands control back** — whether the seed was committed or paused, the next step is `openlogos change <slug>`.

:::caution
On a launched project with no active proposal, the guard protects new files that git neither tracks nor ignores. A manifest written to the project root (like `.logos-seed-plan.json` above) is such a file, so the write can be blocked. Put the manifest in a path git ignores, or run the seed while a proposal is active. The staging directory is exempt by default.
:::

## Core Principles

1. **Only facts verifiable from the code** — the system map (modules, entry points, dependencies) and scenario candidates. No PRD, no historical "why".
2. **`verified: false` stays frozen** — there is no confirmation step that upgrades a candidate.
3. **Staging only** — the Skill never edits `logos-project.yaml` or the target files in `logos/resources/`; the CLI is the only committer.
4. **A missing capability never blocks change** — if the scan cannot run, the Skill says so and gives you the `openlogos change <slug>` command to copy.
5. **Safe partial vs. unfinished transaction** — an open run or uncommitted staging can be excluded and work can continue; a commit journal in `prepared` / `committing` must be recovered first.
6. **Existing code is grandfathered** — the seed is an unconfirmed snapshot; methodology gates apply only to new intent.

Sources the Skill may rely on are recomputable facts: code entry points, routes, dependency manifests, configuration, and tests. Comments, READMEs, and doc examples are hints only.

## Recovery

- **Scan interrupted before commit** — safe `partial`: complete the staging and rerun `commit`, `begin` again, or simply start a change.
- **Commit crashed** — the next `baseline-seed`, `status`, `next`, `index`, or `sync` call recovers it under the module lock: a `prepared` journal rolls back to the old state; a `committing` journal rolls forward if possible, otherwise back.
- **Recovery impossible** — the commands report `baseline_commit_in_progress` and stop reading standard resources until it is resolved.

## Outputs

- After a successful commit: the seeded documents under `logos/resources/` (for example `core-system-map.md` and `core-scenario-candidates.md`), the derived `baseline_index`, and `baseline_seed_state: seeded` in `logos-project.yaml` — all written by the CLI.
- During a run: only files under `logos/resources/verify/baseline-seed-runs/<run_id>/staging/`.

## Related

- [Adopt an Existing Project](/getting-started/adopt-existing-project) — the default path: adopt, then create changes directly
- [`openlogos adopt`](/cli/adopt) — onboards the project and sets `baseline_seed_state: required`
- [`change-writer`](/skills/change-writer) — fills in the specs each change touches, with or without a seed
