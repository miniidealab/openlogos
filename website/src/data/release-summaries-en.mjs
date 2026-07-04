export const RELEASE_SUMMARIES_EN = {
  '0.13.1': {
    valueSummaryEn: [],
    fixSummaryEn: [
      '`openlogos verify` now rejects inconsistent result ledgers: malformed JSONL rows, invalid statuses, unknown or manual result IDs, and broken count invariants surface through the new `consistency` JSON diagnostics and fail the gate with `result_ledger_inconsistent`.',
      'Duplicate test IDs remain last-write-wins compatible, but the final result set must still trace back to defined automated test cases before the gate can pass.',
    ],
  },
  '0.12.9': {
    valueSummaryEn: [
      'Exposed `code_required` as an explicit contract field on `openlogos status/next/watch --format json` (`modules[].active_change.code_required`), giving external consumers such as RunLogos a single source of truth for whether the active proposal needs code — instead of re-deriving it with keyword regexes.',
    ],
    fixSummaryEn: [],
  },
  '0.12.5': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Guarded slice auto-pass: after merge, `openlogos next --auto` no longer auto-passes the `slice-exit` gate until the `[code]` slices have actually been written by slice-planner, so unformed slices are never skipped prematurely.',
    ],
  },
  '0.12.4': {
    valueSummaryEn: [
      'The `next_node` orchestration hint now emits `gate_id` at the slice-exit frontier so drivers can precisely identify the current gate.',
    ],
    fixSummaryEn: [
      'Fixed node routing for no-delta pure-code proposals: `tasks.md` keeps at least one `## [tag]` section heading so `parseTaskSections` no longer returns null and misroutes to the `write-delta` node (which deadlocked unattended runs).',
    ],
  },
  '0.12.3': {
    valueSummaryEn: [
      'Redefined `openlogos next --auto` as full-auto / unattended mode: a standing, run-scoped authorization that lets a proposal run the whole chain to completion, auto-passing `skippable` human gates, with a two-tier authorization model (semi-auto human checkpoints vs. full-auto unattended) and a revert marker mechanism.',
      'In full-auto mode `verify` / `smoke` / `archive` auto-execute once the code is green (`auto_execute:true`) and `git push` is allowed by the PreToolUse guard safelist; every auto-pass appends an append-only audit line to `GATE_AUTO_PASSED`.',
      'Hard red line: code that hit the iteration ceiling without passing tests is escalated to a `loop-exhausted` exit gate (default non-skippable) — no mode, including `--auto`, ever auto-passes untested code.',
    ],
    fixSummaryEn: [],
  },
  '0.12.0': {
    valueSummaryEn: [
      'Split slice planning into its own stage: `[code]` slices moved out of the plan stage into a dedicated slice subflow that runs after merge and before implement (new `plan-slices` node + `slice-planner` skill, six-dimension scoring + delete-the-rest falsification gate, new `ready-to-implement` residency state). `write-tasks` no longer produces `[code]`.',
    ],
    fixSummaryEn: [],
  },
  '0.11.3': {
    valueSummaryEn: [
      'Introduced the orchestratable dev-flow engine: the whole development process is modeled as a declarative subflow→node→gate→loop state machine as the single source of truth, with `status/next/watch` passively derived from built-in flow templates; added `openlogos flow show` (`--resolved`, `--lifecycle initial|launched`) and the built-in `initial` / `launched` templates.',
      'Added the read-only streaming `openlogos watch` command for live derived dev-flow state, and `next --auto` to skip `skippable` gates.',
      'Added overlay-driven derivation: a project `logos/flow/*.yaml` can `extends: builtin:*` and only write the diffs (skip nodes / set-loop / cmd predicates).',
      'Added cmd predicates, real loop iteration, fan-out threshold group convergence, and the `next_node` orchestration hint; restructured the change flow into plan / spec / merge stages plus a code slice loop.',
    ],
    fixSummaryEn: [
      'Preserved user instruction files during instruction-file merges.',
      'Scoped the Codex guard injection context by proposal step, fixed auto plan-gate progress display, and enforced smoke runner coverage checks.',
    ],
  },
  '0.10.10': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Shipped the Mermaid skill safety rules with the CLI package so `openlogos init/sync` generates skill assets that carry the flowchart/sequenceDiagram label-safety constraints.',
      'Synced the site skill docs with the tag-driven GitHub Actions release pipeline so published packages no longer lag the site.',
    ],
  },
  '0.10.9': {
    valueSummaryEn: [
      'Added the `openlogos deploy-done` controlled completion command that validates `VERIFY_PASS`, the deployment decision, the `[deploy]` section and the deployment report, then checks tasks, writes `DEPLOY_DONE` and clears stale `SMOKE_PASS/FAIL`.',
      'Updated the deployment-executor skill to call `openlogos deploy-done`, with a `deploy-done --format json` output contract and post-deploy smoke coverage.',
    ],
    fixSummaryEn: [],
  },
  '0.10.8': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed Codex SessionStart lifecycle injection to read `lifecycle`/`active_change` from `openlogos status --format json`.',
      'Fixed the next-step guidance for launched, all-done projects, and removed the release regression test dependency on build artifacts.',
    ],
  },
  '0.10.6': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed an empty-proposal deployment placeholder conflict false positive: only exact `是`/`否` field values count as a boolean deployment decision.',
    ],
  },
  '0.10.5': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed proposal-template placeholder state misdetection by scoping the deployment placeholder check to the structured fields under the deployment-impact section.',
    ],
  },
  '0.10.4': {
    valueSummaryEn: [
      'Added the PreToolUse guard hook: launched projects hard-block Edit/Write/Bash with exit 2 when no active change proposal exists, upgrading change management from a reminder to enforcement (with safelist and initial-lifecycle exemption).',
      'Comprehensive site docs sync: filled 11 missing doc pages and corrected version, command count, skill count, phase model and lifecycle terminology.',
    ],
    fixSummaryEn: [],
  },
  '0.10.3': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed a site-build Node version incompatibility in the tag release pipeline by switching the website build to Node 22.12.0 for Astro 6.',
    ],
  },
  '0.10.2': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed a cross-platform sandbox test issue in the release pipeline (`ST-JSON-27` now uses a writable in-workspace `sandbox_root`).',
    ],
  },
  '0.10.1': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed a tag release workflow misconfiguration by replacing the direct `secrets` reference in an `if` condition with an explicit credential check step.',
    ],
  },
  '0.10.0': {
    valueSummaryEn: [
      'Standardized verify/smoke sandbox execution: `openlogos verify` and `smoke` support `sandbox_mode`, `sandbox_root` and `sandbox_deny_workspace_write`, exposing a `sandbox` diagnostic in JSON output.',
      'Added the CLI sandbox executor (auto downgrade / always isolate) and synced the site verify docs.',
    ],
    fixSummaryEn: [
      'Prevented test commands from accidentally writing to the workspace by reclaiming result files and restricting workspace writes.',
    ],
  },
  '0.9.29': {
    valueSummaryEn: [
      'Added the vendored ui-ux-pro-max skill for GUI product design guidance across web, mobile, and desktop products.',
      'Expanded product-designer coverage for desktop apps, including window, menu, IPC, and filesystem design dimensions.',
      'Added a non-blocking Python 3 check at the end of openlogos init with friendly multi-OS install guidance.',
    ],
    fixSummaryEn: [],
  },
  '0.9.28': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed JSON status and detect output so partially damaged logos-project.yaml files can still recover launched module state and YAML diagnostics.',
    ],
  },
  '0.9.27': {
    valueSummaryEn: [
      'Released deploy-progress-summary-panel support, including CLI adaptation, deployment progress summary fields, and stronger conflict gates.',
    ],
    fixSummaryEn: [],
  },
  '0.9.26': {
    valueSummaryEn: [
      'Released proposal-deploy-consistency-hardening support for CLI deployment gate consistency.',
    ],
    fixSummaryEn: [],
  },
  '0.9.24': {
    valueSummaryEn: [
      'Added deployment phases and deployment state transitions to the proposal lifecycle, including deploy tasks and ready-to-deploy states.',
      'Added the openlogos smoke command for post-deployment smoke gates, smoke reports, and SMOKE_PASS or SMOKE_FAIL markers.',
      'Added deployment-designer and deployment-executor skills for deployment planning, rollback strategy, smoke checks, and human-confirmed execution.',
    ],
    fixSummaryEn: [],
  },
  '0.9.21': {
    valueSummaryEn: [
      'Updated the website and CLI documentation so init, sync, launch, AI tool selection, and version examples match the current implementation.',
    ],
    fixSummaryEn: [
      'Fixed multi-tool sync consistency so sync and launch deploy all selected AI tool skills, plugin assets, and instruction files together.',
    ],
  },
  '0.9.20': {
    valueSummaryEn: [
      'Allowed code-only proposals to skip the merge stage and move directly into coding or ready-to-verify based on the code task section.',
    ],
    fixSummaryEn: [],
  },
  '0.9.19': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed openlogos merge idempotency so an already merged proposal exits cleanly instead of regenerating MERGE_PROMPT.md.',
    ],
  },
  '0.9.18': {
    valueSummaryEn: [
      'Expanded the proposal lifecycle into an eight-step state machine from writing through verify-passed or verify-failed.',
      'Made the [code] section drive the coding to ready-to-verify transition after SPEC_MERGED is present.',
      'Added verify marker files and next/status guidance for ready-to-verify, verify-passed, and verify-failed states.',
    ],
    fixSummaryEn: [],
  },
  '0.9.17': {
    valueSummaryEn: [
      'Introduced structured [delta] and [code] task sections so specification work and code work are tracked separately.',
      'Allowed proposals without a [delta] section to proceed without being stuck before merge.',
      'Added spec/tasks-spec.md and refreshed the generated tasks template.',
    ],
    fixSummaryEn: [],
  },
  '0.9.16': {
    valueSummaryEn: [
      'Expanded proposal states into writing, delta-writing, ready-to-merge, merge-generated, and coding.',
      'Made openlogos merge recursively scan nested delta folders and map them back to the correct resource directories.',
      'Added two-step merge markers that distinguish generated merge instructions from completed specification merges.',
    ],
    fixSummaryEn: [
      'Fixed proposals with deltas getting stuck in ready-to-merge after merge instructions were generated.',
    ],
  },
  '0.9.15': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed delta proposals that could not advance after merge by writing a merge marker when openlogos merge runs.',
    ],
  },
  '0.9.14': {
    valueSummaryEn: [
      'Clarified change-writer delta path mapping for nested PRD, technical plan, and test resource directories.',
    ],
    fixSummaryEn: [],
  },
  '0.9.13': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed no-delta proposals so openlogos merge writes a marker and moves the workflow into coding.',
    ],
  },
  '0.9.12': {
    valueSummaryEn: [
      'Added change-writer guidance for producing delta files, including target folders, naming rules, and allowed resource mappings.',
    ],
    fixSummaryEn: [],
  },
  '0.9.11': {
    valueSummaryEn: [
      'Changed change management rules to detect launched modules from logos-project.yaml instead of relying on manual user prompts.',
    ],
    fixSummaryEn: [],
  },
  '0.9.10': {
    valueSummaryEn: [
      'Made empty delta directories a valid openlogos merge result, equivalent to a successful no-op merge.',
    ],
    fixSummaryEn: [],
  },
  '0.9.9': {
    valueSummaryEn: [
      'Changed archive directory names to include a timestamp prefix for easier historical proposal lookup.',
    ],
    fixSummaryEn: [],
  },
  '0.9.8': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Strengthened reporter requirements so generated tests must create a shared OpenLogos reporter before writing test cases.',
    ],
  },
  '0.9.7': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Fixed phase detection for new modules so existing core documents no longer make new modules appear complete.',
      'Added automatic sync backfill for missing scenarios[].module fields in logos-project.yaml.',
    ],
  },
  '0.9.6': {
    valueSummaryEn: [
      'Added automatic Claude Code plugin deployment for slash commands, agent files, hook scripts, and settings integration.',
    ],
    fixSummaryEn: [
      'Fixed module add so it no longer requires an active change proposal.',
      'Changed module rename and remove to warn during active proposals instead of blocking the command.',
    ],
  },
  '0.9.5': {
    valueSummaryEn: [
      'Added [manual] test case markers for cases that require human visual, TTY, window, or hardware verification.',
      'Added manual-aware acceptance trace behavior and verify JSON manual_count output.',
      'Updated test-writer guidance and task templates for manual case handling.',
    ],
    fixSummaryEn: [],
  },
  '0.9.4': {
    valueSummaryEn: [],
    fixSummaryEn: [
      'Rolled back the incorrect spec and skills delta category mapping from merge.ts.',
    ],
  },
  '0.9.3': {
    valueSummaryEn: [
      'Removed verify-style tasks from task templates so openlogos verify remains a separate workflow node.',
    ],
    fixSummaryEn: [
      'Added merge support for spec and skills delta categories.',
    ],
  },
  '0.9.2': {
    valueSummaryEn: [
      'Added skip_phases module configuration for projects that intentionally skip API, database, or scenario phases.',
      'Updated phase detection so skipped phases are respected globally and per module.',
      'Updated architecture-designer and logos-project specs to document skip_phases usage.',
    ],
    fixSummaryEn: [],
  },
  '0.9.1': {
    valueSummaryEn: [
      'Regenerated AGENTS.md and CLAUDE.md so generated guidance matches the current project configuration.',
    ],
    fixSummaryEn: [
      'Fixed plugin lifecycle detection to derive launched state from logos-project.yaml instead of the old config lifecycle field.',
      'Fixed the OpenLogos phase hook so failed scenario checks no longer terminate the script under strict shell settings.',
      'Updated stale change management copy in plugin phase guidance.',
    ],
  },
  '0.9.0': {
    valueSummaryEn: [
      'Added the openlogos verify acceptance gate between merge and archive.',
      'Added automated commit checkpoints and a separate human-confirmed git push step.',
      'Aligned the workflow around merge, implementation, verify, and archive ordering.',
    ],
    fixSummaryEn: [],
  },
  '0.8.2': {
    valueSummaryEn: [
      'Raised the npm release version to 0.8.2 for the tested CLI package.',
    ],
    fixSummaryEn: [
      'Fixed an unused parameter in cli/src/commands/status.ts that blocked release linting.',
    ],
  },
};
