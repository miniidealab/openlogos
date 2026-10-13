---
title: Upgrading from 0.13.x
description: Move an OpenLogos 0.13.x installation and its projects to 0.16.0 — update the CLI, run sync in every project, and switch to the new merge and slice commands.
---

OpenLogos 0.16.0 is the first public release after 0.13.24. Versions 0.13.25–0.15.20 were only installed locally and never published to npm, so if you are on 0.13.x you upgrade straight to 0.16.0. The five steps below cover everything in between.

## Upgrade steps

### 1. Update the global CLI

```bash
npm install -g @miniidealab/openlogos@latest
openlogos --version
```

`openlogos --version` should print `0.16.0`.

### 2. Run `openlogos sync` in each existing project

Updating the global CLI does not touch your projects. Go to the root directory of each existing project (the directory that contains `logos/logos.config.json`) and run:

```bash
cd <project-root>
openlogos sync
```

`sync` refreshes:

- the managed guard script and the post-execution check engine;
- the Claude Code hooks — new `PostToolUse`, `PostToolUseFailure`, and `Stop` entries next to the existing `SessionStart` and `PreToolUse` entries;
- the deployed Skills;
- the OpenLogos managed block in `.gitignore` (it always contains `logos/.openlogos-runtime/`);
- `language` in `.claude/settings.json`, set from the project `locale`, so the reply language no longer drifts after a long session is compacted.

If you skip `sync`, the project keeps running the old guard even though the CLI itself is 0.16.0. After `sync`, start a new session in your AI tool so it loads the refreshed hooks and Skills.

### 3. Cursor projects: managed rules become Skills

In a Cursor project, `sync` migrates the OpenLogos-managed `.cursor/rules/*.mdc` files to `.cursor/skills/<name>/SKILL.md` and writes the OpenLogos entries in `.cursor/hooks.json`, including the `afterShellExecution` post-check. Rules you wrote yourself under `.cursor/rules/` are left untouched.

See [Cursor Plugin](/specs/cursor-plugin) for the full asset layout.

### 4. Proposals in progress: use the new merge and slice commands

The 0.14.x merge and slice transaction commands — `merge transaction *`, `merge-apply`, and the slice transactions — were removed in 0.15.0. For any proposal that is still open:

- Merge its spec deltas with `openlogos merge <slug>`. It applies all deltas in a single call — atomic, all or nothing — and no longer writes a `MERGE_PROMPT.md` for the AI to execute.
- Plan its `[code]` slices with `openlogos slice plan --file <slices.json>`. It writes the `[code]` section of `tasks.md` and `TEST_SLICE_MANIFEST.json`.

If a proposal has already been merged and you then change its deltas, run `openlogos merge <slug>` again: it amends the merged specs against the recorded merge baseline (`result: "amended"` in JSON output). Run `openlogos next` to see where each proposal stands.

### 5. Tools that read `--format json`

If scripts or integrations parse `--format json` output, use `data.contract.version` and the JSON Schemas shipped in the npm package (`spec/schema/*.schema.json`) as the reference. In particular, check the verify gate fields and the projections removed in 0.15.0 (see below).

## What changed in 0.16.0

- **Merge in a single call** — `openlogos merge <slug>` writes all deltas atomically; merging again after editing an already-merged proposal amends it. See [`openlogos merge`](/cli/merge).
- **Slice-based implementation** — after merge, the `slice-planner` Skill plans the `[code]` slices and `openlogos slice plan --file` writes them; verify supports per-slice checkpoints followed by a final full acceptance. See [`openlogos slice`](/cli/slice).
- **change-lint** — checks are consolidated to L0–L9 and include deployment-plan coverage and duplicate post-change test IDs, so problems show up while you write deltas instead of at merge time. See [`openlogos change-lint`](/cli/change-lint).
- **verify gate reduced to three checks** — result ledger consistent, zero failures, zero uncovered cases. The Layer 1 design-time coverage checklist and the Layer 3 acceptance-criteria traceability matrix were removed from the verdict, the report, and the JSON. A failing pre-run command now fails the gate (`pre_run_failed`). See [`openlogos verify`](/cli/verify).
- **Guard protects versioned content** — on a launched project with no active proposal, only code and specs that go into version control are protected; writes to ignored dependencies, build output, logs, and caches no longer need a proposal. Bash / PowerShell commands get a light pre-check plus a content-level comparison after execution. See [PreToolUse Guard](/specs/pretooluse-guard).
- **Protection-scope commands** — `openlogos ignore` and `openlogos exempt` manage what stays out of version control and which committed paths need no proposal; changing them requires approval in the host UI. See [`openlogos ignore` / `openlogos exempt`](/cli/ignore-exempt).
- **New hosts** — ZCode, Qoder, and WorkBuddy are supported by `init`, `adopt`, `sync`, and `launch`; Cursor now uses Skills plus the `afterShellExecution` post-check. See [ZCode](/specs/zcode-plugin), [Qoder](/specs/qoder-plugin), [WorkBuddy](/specs/workbuddy-plugin), and [Cursor](/specs/cursor-plugin).
- **smoke gate** — skipped cases required by the proposal are blocked by default; a case that genuinely cannot run on the current platform passes only with `reason_code: "platform-unavailable"` plus an explanation, and is listed separately in the report. See [`openlogos smoke`](/cli/smoke).
- **Process simplification (0.15.0, breaking)** — Authority Closure and Baseline Closure were removed, together with the slice and merge transactions. Decision clarification and the UI prototype are no longer hard gates.

Gate numbering used throughout this site: verify is **Gate 3.6**, deploy-done is **Gate 3.7**, smoke is **Gate 3.8**.

## Related

- [`openlogos sync`](/cli/sync) — what sync refreshes
- [Quick Start](/getting-started/quick-start) — starting a new project on 0.16.0
- [Adopt an Existing Project](/getting-started/adopt-existing-project) — bringing a project that has never used OpenLogos onboard
