---
title: slice-planner
description: Plan launched-change [code] slices after spec-complete, using merged specs and real test IDs.
---

The `slice-planner` Skill is used after a launched change reaches spec-complete and before code implementation begins. It writes only the `## [code]` section of `tasks.md`; it does not author deltas and does not implement code.

## When to Use

- `openlogos next --format json` returns `proposal_step=="ready-to-implement"` and `next_node.id=="plan-slices"`.
- The active proposal has `SPEC_MERGED` or `MERGED`.
- Real `UT-*` / `ST-*` / `SMOKE-*` IDs are already available from merged test docs, proposal text, or explicit reuse.

Pure-code no-delta proposals must still run `openlogos merge <slug>` first. That no-op merge writes `SPEC_MERGED` with `type:"no_delta_spec_complete"`. Without that marker, the correct state is `spec-complete-required`, not `plan-slices`. If test IDs are missing after spec-complete, the correct state is `test-id-required`.

## Output

Update `logos/changes/<slug>/tasks.md` and write well-formed `[code]` slices. Each slice must be self-closed: business code + tests + OpenLogos reporter + necessary golden/smoke evidence, and each line must end with the real IDs it covers.

Full slicing rules are documented in [Slice Planner](/specs/slice-planner).
