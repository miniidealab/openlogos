---
title: "openlogos change-lint"
description: Read-only delivery check for a change proposal's plan artifacts (proposal.md, tasks.md, deltas) — ten checks L0–L9, the same verdict merge uses for admission.
---

Check whether the active change proposal's plan artifacts — `proposal.md`, `tasks.md` and everything under `deltas/` — are fit to hand over. It is the **delivery gate** for the [`change-writer`](/skills/change-writer) skill: after writing the proposal, and again after writing all deltas, the producer must run it and only report "done" on exit 0.

`openlogos merge` runs the very same check as its admission step, so problems surface while you are still writing deltas instead of when the merge is refused.

The command is **read-only**: it writes no files, markers, guard or hashes and never changes the derived `proposal_step`. It is not a human confirmation point — anyone can run it at any time — and passing it does not authorize a merge.

## Synopsis

```bash
openlogos change-lint [--slug <slug>] [--format json]
```

Must be run from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--slug <slug>` | Check this proposal. Without it, the `activeChange` from `logos/.openlogos-guard` is used. An empty or invalid value is rejected; it never falls back to the guard. |
| `--format json` | Print a JSON envelope: `data.slug`, `data.pass`, `data.plan_package`, `data.violations[]` (`code` / `path` / `message` / `fix_hint`) and, only when non-empty, `data.warnings[]`. |

## The ten checks (L0–L9)

| Check | What it verifies |
|-------|------------------|
| **L0** Plan package | `proposal.md` has every required section (Reason, Change Type, Scope, Deployment Impact, Summary, Decision Clarification), each unique, non-empty and free of template placeholders; `tasks.md` is filled consistently with the proposal |
| **L1** tasks structure | `tasks.md` parses into `## [delta]` / `## [code]` / `## [deploy]` sections |
| **L2** `[code]` heading | A proposal that needs code keeps an empty `## [code]` heading (slices are written after merge) |
| **L3** Test evidence | Code changes reference real test IDs at the right stage: a planned `deltas/test/` task, an actual test delta, or a proposal section headed exactly `## 复用测试 ID` (same heading in English projects) listing `- <ID> — <purpose>` lines whose IDs exist in merged specs. Placeholders such as `UT-Sxx-xx` or `TBD` do not count |
| **L4** Delta markers | Every `.md` delta has `ADDED` / `MODIFIED` / `REMOVED` (or `REMOVED-ITEMS`) markers, no leftover template text, and the composed result has no duplicate test IDs or malformed test tables |
| **L5** Deployment decision | `proposal.md` deployment impact and the `[deploy]` section agree; a proposal that needs deployment updates the deployment plan or cites a merged one |
| **L6** Delta paths | Every file under `deltas/` maps to a valid canonical target |
| **L7** UI declaration | GUI projects only: the UI/UX change declaration block is well-formed and matches the prototypes |
| **L8** ID conservation | Section anchors resolve to exactly one heading; structured IDs are not silently dropped |
| **L9** Downstream blockers | The same blocking reasons `next` / `status` would report (for example, missing real test IDs or the no-delta spec-complete marker) are surfaced now |

Checks scale with the stage: during planning, when no delta exists yet, the delta checks pass with nothing to inspect.

**Warnings** (decision-record reminders, change type vs. delta layers, SQL dialect pre-check skipped, some ID-conservation observations) are printed but never change the result or the exit code.

## Exit codes

| Exit | Meaning | What to do |
|------|---------|------------|
| `0` | All checks passed | The artifacts may be handed over |
| `2` | Checks ran and found violations | Fix each violation as its "what's missing / where / what it should look like" lines say, then rerun until exit 0 |
| `1` | Operational error — the check could not run | Fix the environment: `not_initialized`, `no_active_proposal`, `slug_not_found`, `slug_invalid`, `module_unresolved`, `artifact_unreadable`, `baseline_commit_in_progress` |

## Example

```bash
openlogos change-lint --slug add-remember-me
```

```
change-lint: add-remember-me
  ✓ L0 Plan Package 完成合同
  ✓ L1 tasks.md 结构可解析
  ✓ L2 [code] 标题在场（空段占位合法）
  ✗ L3 [code_change_requires_real_test_ids]
      缺什么：…
      在哪补：logos/changes/add-remember-me/proposal.md
      补成什么样：…
  ✓ L4 delta 段标记与脱模板（2 个 .md delta）
  …
FAIL（9/10，1 项违规）
```

The check labels are currently printed in Chinese regardless of the project locale; the codes (`L3`, `code_change_requires_real_test_ids`) are stable.

## Related commands

- [`change`](/cli/change) — Create the proposal that change-lint checks
- [`merge`](/cli/merge) — Runs the same verdict as its admission step
- [`lint-specs`](/cli/lint-specs) — Structural check of the merged test specs
- [change-writer](/skills/change-writer) — The skill that must pass this gate before reporting completion
