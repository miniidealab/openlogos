---
title: slice-planner
description: Plan launched-change [code] slices after merge from merged specs and real test IDs, and write them with openlogos slice plan.
---

The `slice-planner` Skill runs after a launched change has merged and before code implementation starts. It cuts the merged spec into well-formed `[code]` slices and is the **single source of truth** for them. How many slices there are, and what each one does, is decided here once. Downstream, [`code-implementor`](/skills/code-implementor) consumes the slices line by line and does not re-score or re-batch.

The Skill produces a structured `slices.json`. The [`openlogos slice plan`](/cli/slice) command writes it into the `## [code]` section of `tasks.md` and into `TEST_SLICE_MANIFEST.json`. The Skill does not write deltas, does not implement code, and never hand-edits those two files.

## Trigger Conditions

- `openlogos next` returns `proposal_step == "ready-to-implement"` and `next_node.id == "plan-slices"` without a `gate_id`. The host injects the "plan slices" context.
- `next_node.id == "plan-slices"` with a `test-slice-manifest-missing` / `-invalid` / `-stale` reason (manifest recovery).
- After merge, the user says "cut the slices", "write `[code]`" or "plan the implementation tasks".

If `next_node` also carries `gate_id: "slice-exit"`, the slices are already planned and waiting for approval. Do not run the Skill again.

## Prerequisites

1. The active proposal has `SPEC_MERGED` (or `MERGED`). A pure-code proposal without `[delta]` must still run `openlogos merge <slug>` first. That no-delta merge writes `SPEC_MERGED` with `type: "no_delta_spec_complete"`. Without the marker the state is `spec-complete-required`, not `plan-slices`.
2. Spec deltas have merged into the main documents, or the no-delta marker records that none were needed.
3. **Real test IDs exist**: the merged `logos/resources/test/*-test-cases.md` (or an explicit reuse declaration) contains real `UT-*` / `ST-*` / `SMOKE-*` IDs. If they are missing after spec-complete, the state is `test-id-required`.

Never slice with placeholder IDs. If a prerequisite is missing, stop and point the user to merge or to adding the test IDs.

## Execution Steps

The full rules are in the [Slice Planner spec](/specs/slice-planner). In short:

1. **Read the merged spec and real test IDs.** Read the proposal scope, the merged architecture / scenario / feature specs and the test case files. List the capabilities to build and the available IDs.
2. **Six-dimension scoring.** Score blast radius, behavioral complexity, contract change, test size, risk and uncertainty from 0 to 2 each. **0–7 points: a single slice.** **8 or more: try a vertical split.**
3. **Vertical / horizontal discriminator.** A slice must be one end-to-end capability, scenario or sub-module. Names like "foundation", "plumbing", "helpers", "schema", "write tests", "add reporter" or "UI only" are horizontal red flags. Re-cut when you see them.
4. **Delete-the-rest falsification gate.** For each slice i, ask two questions. (a) With slices i+1..N deleted, does verify still go green? (b) Does slice i deliver an end-to-end, observable capability? Any "no" means you merge it forward into the slice that depends on it, then run the gate again.
5. **Escape hatch.** If the score is 8 or more but no vertical cut passes the gate, keep one slice and state why. When unsure, merge.
6. **Shape each slice.** Each slice is self-closed: business code, its UT/ST, the OpenLogos reporter, and any necessary golden baseline. Order the slices so that none depends on a later one. Each `task_text` ends with the real IDs the slice covers. If the proposal changes smoke cases, the slice also lists the new `SMOKE-*` IDs and requires the runner, the `smoke-results.jsonl` reporter, the config hookup and a smoke coverage precheck.
7. **Write `slices.json` and run the command.**

```bash
openlogos slice plan --file slices.json
```

On success, read the `[code]` section back from disk and show it to the user. On failure, every violation is listed with `code`, `path` and `fix_hint`, and nothing is written. Fix `slices.json` and run the command again.

## `slices.json`

```json
{
  "slices": [
    {
      "slice_id": "slice-01-capability",
      "task_text": "End-to-end capability: implement X with UT/ST + reporter (covers UT-S01-01, ST-S01-01)",
      "owned_test_ids": ["UT-S01-01", "ST-S01-01"],
      "runner_selectors": ["UT-S01-01", "ST-S01-01"],
      "spec_targets": ["logos/resources/test/core-S01-test-cases.md"]
    }
  ]
}
```

| Field | Content |
|-------|---------|
| `slice_id` | Stable, kebab-case, unique in the proposal. Recommended `slice-<nn>-<short-name>`. |
| `task_text` | The `[code]` line text, ending with the real IDs it covers |
| `owned_test_ids` | Every test ID this change adds or modifies is owned by exactly one slice. No placeholders, wildcards or unknown IDs. |
| `runner_selectors` | Non-empty selectors that run the slice's owned tests |
| `spec_targets` | Merged test spec files under `logos/resources/test/` |

Do not include fingerprints, `schema`, `change`, `module` or `generated_at`. The command writes them.

## Recovery Mode

When `openlogos next` asks for `plan-slices` because the manifest is missing, invalid or stale:

- **Do not re-score or re-cut.** The slicing is fine, only the manifest is broken. Reuse the old `slice_id` and `task_text` values (from the old manifest, or rebuilt in order from the existing `[code]` lines).
- Re-run `openlogos slice plan --file <slices.json>` with the same input. Unchanged slices keep their checkboxes, and existing checkpoints stay valid. Do not restore `[x]` by hand.
- Do not delete or rename `TEST_SLICE_MANIFEST.json`, and do not edit `SLICE_CHECKPOINTS.jsonl` or `SLICES_APPROVED`.
- If an ID cannot be assigned to a single slice, report the ambiguity and stop. Do not guess.

To change a slicing that turned out to be wrong, edit `slices.json` and run the same command. Slices whose text changed are reset to unchecked.

## Outputs

| Output | Written by |
|--------|------------|
| `slices.json` (input, any path you choose) | This Skill |
| `logos/changes/<slug>/tasks.md` → `## [code]` | `openlogos slice plan` |
| `logos/changes/<slug>/TEST_SLICE_MANIFEST.json` | `openlogos slice plan` |

`proposal.md`, `[delta]` and `[deploy]` stay byte-for-byte unchanged.

After the slices are written, tell the user they are ready and that implementation starts after the `slice-exit` gate is approved. In `openlogos next --auto` mode, the gate is released automatically and `SLICES_APPROVED` is written.

## Recommended Prompt

```text
Run slice-planner for this proposal's [code] slices. Read the merged specs and real test IDs, do the six-dimension scoring, then check each slice against the vertical/horizontal discriminator and the delete-the-rest gate and write down the conclusions. If it cannot be split, use a single slice. Write the result as a structured slices.json (slice_id / task_text / owned_test_ids / runner_selectors / spec_targets), run openlogos slice plan --file <slices.json>, and read the [code] section back to confirm.
```

## Related

- [`openlogos slice`](/cli/slice): the command that writes `[code]` and the manifest
- [Slice Planner spec](/specs/slice-planner): full slicing rules
- [Test Slice Manifest](/specs/test-slice-manifest): manifest, checkpoints and recovery
- Previous: [`merge-executor`](/skills/merge-executor) / [`openlogos merge`](/cli/merge)
- Next: [`code-implementor`](/skills/code-implementor): implements the slices one by one
