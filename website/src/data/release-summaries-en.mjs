export const RELEASE_SUMMARIES_EN = {
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
