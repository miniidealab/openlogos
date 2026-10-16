import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type Locale = 'en' | 'zh';

export function readLocale(root: string): Locale {
  const configPath = join(root, 'logos', 'logos.config.json');
  if (!existsSync(configPath)) return 'en';
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.locale === 'zh') return 'zh';
  } catch { /* ignore */ }
  return 'en';
}

const messages: Record<Locale, Record<string, string>> = {
  en: {
    // init
    'init.creating': 'Creating OpenLogos project structure for "{name}"{source}...',
    'init.done': 'Project initialized. Next steps:',
    'init.step1': '  1. Review logos/logos.config.json to verify project settings',
    'init.nameTip': '  Tip: Project name "{name}" was auto-detected{source}.\n       To change it, edit logos/logos.config.json and run `openlogos sync`.',
    'init.pythonMissingHeader': 'Note: Python 3 was not detected on this machine.',
    'init.pythonMissingBody': '  The built-in ui-ux-pro-max skill (professional UI/UX design intelligence)\n  requires Python 3.x to run. With Python 3 installed, Phase 2 will\n  automatically deliver style / color / font / component recommendations\n  for GUI products (Web / Mobile / Desktop).\n  Install:\n    macOS:  brew install python3\n    Ubuntu: sudo apt install python3\n    Windows: winget install Python.Python.3.12\n  This does not block OpenLogos — other skills work as usual.',
    'init.step2': '  2. Start with Phase 1: tell AI "Help me write requirements"',
    'init.step3': '  3. Run `openlogos status` to check progress at any time',
    'init.nameConflict': 'Project name conflict detected:',
    'init.nameChoice1': '  1. "{name}"  ← your input',
    'init.nameChoice2': '  2. "{name}"     ← from {source}',
    'init.namePrompt': 'Which name would you like to use? [1/2] (default: 1): ',
    'init.langPrompt': 'Your choice [1/2] (default: 1): ',
    'init.aiToolHeader': 'Choose AI coding tool / 选择 AI 编码工具:',
    'init.aiToolClaudeCode': '  1. Claude Code (default)',
    'init.aiToolOpenCode': '  2. OpenCode',
    'init.aiToolCodex': '  3. Codex',
    'init.aiToolCursor': '  4. Cursor',
    'init.aiToolOther': '  5. Other',
    'init.aiToolAll': '  6. All (deploy for all tools)',
    'init.aiToolPrompt': 'Your choice [1/2/3/4/5/6] (default: 1): ',
    'init.skillsDeployed': '{count} skills deployed to {target}',
    'init.skillsSynced': '{count} skills synced to {target}',
    'init.opencodePluginDeployed': 'OpenCode plugin deployed to {target}',
    'init.opencodePluginSynced': 'OpenCode plugin synced to {target}',
    'init.opencodeConfigCreated': 'opencode.json created with recommended permission defaults',
    'init.opencodeConfigUpdated': 'opencode.json merged with missing recommended permission defaults',
    'init.opencodeCommandsDeployed': 'OpenCode slash commands deployed to .opencode/commands/ ({count} files)',
    'init.codexPluginDeployed': 'Codex plugin deployed to {target}',
    'init.codexPluginSynced': 'Codex plugin synced to {target}',
    'init.codexConfigCreated': '.codex/config.toml created with plugin and hook configuration',
    'init.codexConfigUpdated': '.codex/config.toml merged with plugin and hook configuration',
    'init.codexPersonalPluginInstalled': 'Codex personal marketplace refreshed: openlogos@personal',
    'init.codexPersonalPluginInstallFailed': 'Codex personal plugin install failed; run `codex plugin add openlogos@personal` manually after sync.',
    'init.codexProjectSkillsPreserved': 'Project-specific Codex skills/plugins were preserved outside the OpenLogos namespace.',
    'init.claudePluginDeployed': 'Claude Code plugin deployed: {commandCount} commands, {agentCount} agents → .claude/',
    'init.claudePluginSynced': 'Claude Code plugin synced: {commandCount} commands, {agentCount} agents → .claude/',
    'init.claudePluginSkipped': 'Claude Code plugin already deployed (.claude/commands/openlogos/ exists), skipped',
    'init.claudeHooksUpdated': '.claude/settings.json updated with SessionStart hook',
    'init.claudeLanguageCustom': 'Project .claude/settings.json language is a custom value {value}; left unchanged',
    'sync.indexAdded': '{count} new file(s) added to logos-project.yaml resource_index',
    'sync.indexNoop': 'logos-project.yaml resource_index is already up to date',
    'sync.scenariosModuleAdded': '{count} scenario(s) backfilled with module field in logos-project.yaml',

    // status
    'phase.1': 'Phase 1 · Requirements (WHY)',
    'phase.2': 'Phase 2 · Product Design (WHAT)',
    'phase.3-0': 'Phase 3-0 · Architecture',
    'phase.3-1': 'Phase 3-1 · Scenario Modeling',
    'phase.3-2-api': 'Phase 3-2 · API Design',
    'phase.3-2-db': 'Phase 3-2 · Database Design',
    'phase.3-3-deployment': 'Phase 3-3 · Deployment Plan',
    'phase.3-4a': 'Phase 3-4a · Test Case Design (Unit + Scenario)',
    'phase.3-4b': 'Phase 3-4b · API Orchestration Tests',
    'phase.3-5': 'Phase 3-5 · Code Implementation',
    'phase.3-6': 'Phase 3-6 · Test Acceptance (verify)',
    'phase.3-7-deploy': 'Phase 3-7 · Deployment Execution',
    'phase.3-8-smoke': 'Phase 3-8 · Deployment Smoke Test',
    'status.modules': 'Modules',
    'yaml.degraded': 'WARNING: logos-project.yaml is degraded (parse_status: {status}). The CLI is running on AST-recovered data only.',
    'status.activeProposals': 'Active Change Proposals',
    'status.activeChange': 'Active Change',
    'status.proposalStepLabel': 'Step',
    'status.proposalStep.writing': 'writing — fill in proposal.md and tasks.md',
    'status.proposalStep.ready-to-delta': 'plan ready — approve the plan (incl. slicing) before writing deltas',
    'status.proposalStep.delta-writing': 'writing deltas — update change delta files',
    'status.proposalStep.implementing': 'writing deltas — update change delta files',
    'status.proposalStep.in-progress': 'writing deltas — update change delta files',
    'status.proposalStep.ready-to-merge': 'ready to merge — explicitly request `openlogos merge` to proceed',
    'status.proposalStep.merge-generated': 'merge instructions generated — ask AI to merge specs',
    'status.proposalStep.spec-complete-required': 'spec-complete required — run no-delta merge before planning code slices',
    'status.proposalStep.test-id-required': 'test IDs required — add or reference real UT/ST/SMOKE IDs before planning code slices',
    'status.proposalStep.ready-to-implement': 'slices pending — approve the [code] slicing (slice-exit gate) before implementing',
    'status.proposalStep.coding': 'coding — implement code from merged specs',
    'status.proposalStep.ready-to-verify': 'ready to verify — explicitly request `openlogos verify`',
    'status.proposalStep.verify-passed': 'verify passed — explicitly request `openlogos archive` to close',
    'status.proposalStep.verify-failed': 'verify failed — fix issues and run `openlogos verify` again',
    'status.proposalStep.ready-to-deploy': 'ready to deploy — deployment requires explicit human authorization',
    'status.proposalStep.deploy-done': 'deployment done',
    'status.proposalStep.ready-to-smoke': 'ready for smoke — explicitly request `openlogos smoke`',
    'status.proposalStep.smoke-passed': 'smoke passed — explicitly request `openlogos archive` to close',
    'status.proposalStep.smoke-failed': 'smoke failed — fix environment or smoke checks and run `openlogos smoke` again',
    'status.deployTasks': 'Deployment tasks',
    'status.allDone': 'All phases complete.',
    'status.allDoneHint': '   → Or run `openlogos launch` to start iteration development',
    'status.suggestNext': 'Suggested next step: {label}',
    'suggest.phase1': 'Tell AI: "Help me write requirements"',
    'suggest.phase2': 'Tell AI: "Do product design based on requirements"',
    'suggest.phase3-0': 'Tell AI: "Help me design the technical architecture"',
    'suggest.phase3-1': 'Tell AI: "Help me draw S01 sequence diagram"',
    'suggest.phase3-2-api': 'Tell AI: "Help me design the API"',
    'suggest.phase3-2-db': 'Tell AI: "Help me design the database"',
    'suggest.phase3-3-deployment': 'Tell AI: "Help me design the deployment plan"',
    'suggest.phase3-4a': 'Tell AI: "Help me design test cases"',
    'suggest.phase3-4b': 'Tell AI: "Help me design orchestration tests"',
    'suggest.phase3-5': 'Tell AI: "Execute Phase 3 Step 5 — implement business code and tests"',
    'suggest.phase3-6': 'Run your tests, then explicitly request `openlogos verify`',
    'suggest.phase3-7-deploy': 'Deployment requires explicit human authorization. Ask AI to execute the deployment plan only after confirming.',
    'suggest.phase3-8-smoke': 'Explicitly request `openlogos smoke` after deployment is complete',
    'suggest.fallback': 'Continue improving documents',

    // verify
    'verify.title': 'OpenLogos Test Verification',
    'verify.readingResults': 'Reading test results: {path}',
    'verify.readingCases': 'Reading test cases: logos/resources/test/',
    'verify.summary': 'Results Summary',
    'verify.totalDefined': 'Total defined:  {count} cases ({ut} UT + {st} ST)',
    'verify.totalExecuted': 'Total executed: {count} cases',
    'verify.passed': 'Passed:      {count}',
    'verify.failed': 'Failed:       {count}',
    'verify.skipped': 'Skipped:     {count}',
    'verify.manual': 'Manual (excluded): {count}',
    'verify.coverage': 'Coverage:  {pct}%  ({covered}/{total})',
    'verify.passRate': 'Pass rate: {pct}%  ({passed}/{total})',
    'verify.gatePass': 'Gate 3.6: PASS',
    'verify.gateFail': 'Gate 3.6: FAIL',
    'verify.gateFailCoverage': 'Gate 3.6: FAIL (incomplete coverage)',
    'verify.failedCases': 'Failed cases:',
    'verify.uncoveredCases': 'Uncovered cases ({count}):',
    'verify.reportPath': 'Report: {path}',
    'verify.noResults': 'No test results found at {path}.\nRun your tests first, then try again.',
    'verify.noCases': 'No test case specs found in logos/resources/test/.\nRun test design (Step 3a) first.',
    'verify.checklistTitle': 'Design-time Coverage (Layer 1)',
    'verify.checklistSummary': 'Checklist: {checked}/{total} assertions confirmed',
    'verify.checklistUnchecked': 'Unchecked assertions ({count}):',
    'verify.gateFailChecklist': 'Gate 3.6: FAIL (design-time checklist incomplete)',
    'verify.acTitle': 'Acceptance Criteria Traceability (Layer 3)',
    'verify.acSummary': 'AC traceability: {passed}/{total} criteria passed',
    'verify.acFailed': 'Failing criteria ({count}):',
    'verify.gateFailAc': 'Gate 3.6: FAIL (acceptance criteria not fully traced)',
    'verify.preRunConfigAdded': 'verify pre-run config detected and written: {command}',
    'verify.preRunConfigTodo': 'verify pre-run config could not be inferred; please fill verify.pre_run_command or verify.regression_command manually.',
    'verify.preRunCompatSkipped': 'verify.pre_run_command is kept for compatibility but not executed because two-phase verify is configured.',
    'verify.coverageLocalDiag': 'Current project does not have a verify pre-run command; incomplete coverage may be caused by running only a partial test set.',
    'verify.coverageLocalSuggestionPreRun': 'Set verify.pre_run_command in logos/logos.config.json to generate a complete test-results.jsonl in one run.',
    'verify.coverageLocalSuggestionTwoPhase': 'If the project uses regression + incremental testing, set verify.regression_command and verify.incremental_command, and use last-write-wins merging.',
    'verify.preRunModeNone': 'verify pre-run mode: none',
    'verify.preRunModeSingle': 'verify pre-run mode: single-stage',
    'verify.preRunModeTwoPhase': 'verify pre-run mode: two-phase',
    'verify.preRunStageLine': '[{status}] {stage}: {command} (exit={exit}, duration={duration})',
    'verify.sandboxSummary': 'verify sandbox: mode={mode}, status={status}, isolated={isolated}, write_denied={writeDenied}',
    'smoke.sandboxSummary': 'smoke sandbox: mode={mode}, status={status}, isolated={isolated}, write_denied={writeDenied}',
    'verify.deployTasksTitle': 'Deployment tasks',
    'verify.deployHumanGate': 'Deployment is a human confirmation point. AI must not start deployment without explicit authorization.',
    'verify.deployAiHint': 'After authorization, AI must read the merged deployment plan and this proposal, then execute the [deploy] tasks one by one.',
    'deployDone.title': 'OpenLogos deploy-done',
    'deployDone.proposal': 'Proposal: {slug}',
    'deployDone.environment': 'Environment: {environment}',
    'deployDone.marker': 'Marker: {path}',
    'deployDone.deployTasks': 'Deployment tasks: {checked}/{total}',
    'deployDone.clearedSmokeMarkers': 'Cleared stale smoke markers: {markers}',
    'deployDone.nextSmoke': 'Next: explicitly request `{command}`.',
    'deployDone.nextArchive': 'Next: explicitly request `{command}`.',
    'deployDone.error.projectNotInitialized': 'logos/logos.config.json not found.',
    'deployDone.error.noActiveChange': 'No active change proposal found. Run this command only after verify has passed for an active proposal.',
    'deployDone.error.changeNotFound': 'Change proposal \'{slug}\' not found.',
    'deployDone.error.verifyNotPassed': 'Verification has not passed. Run `openlogos verify` first and resolve any VERIFY_FAIL marker.',
    'deployDone.error.decisionConflict': 'Deployment decision conflict. {reason}',
    'deployDone.error.notRequired': 'This proposal does not require deployment. Archive it after verification passes.',
    'deployDone.error.deployTasksMissing': 'No non-empty [deploy] section was found in tasks.md.',
    'deployDone.error.deploymentReportMissing': 'Deployment report is missing: {path}.',
    'deployDone.error.deploymentReportNotWritable': 'Deployment report location is not writable: {path}.',
    'deployDone.error.registryInvalid': 'Environment registry {path} is invalid: {reason}. Run `openlogos env check` for details.',
    'deployDone.error.envRequired': 'This project has an environment registry; pass --env <id|alias>. Available: {available}.',
    'deployDone.error.envUnknown': 'Unknown environment "{input}". Available: {available}.',
    'deployDone.error.gatedEnv': 'Environment {environment} is gated by promotion / approval (promote_from / require_approval in logos/environments.yaml); deploy-done cannot record deployments for it. Use openlogos deploy --env {environment} instead. Nothing was written.',
    'deployDone.error.refUnresolved': 'Cannot resolve --ref "{ref}" to a git commit. Pass the revision that was actually deployed.',
    'deployDone.error.writeFailed': 'Failed to record the deployment ({reason}); {rollback}',
    'deployDone.error.writeFailedRolledBack': 'tasks.md, smoke markers, DEPLOY_DONE and the deployment ledger were restored to their previous state.',
    'deployDone.error.writeFailedRollbackIncomplete': 'rollback is incomplete, please check manually: {problems}',
    'deployDone.error.writeFailedNothingWritten': 'nothing was written.',
    'deployDone.ref': 'Deployed ref: {ref}',
    'deployDone.refUnknown': 'Deployed ref: unknown (pass --ref to record the deployed version)',
    // smoke 环境（environment-registry，S19）
    'smoke.env.registryInvalid': 'Environment registry {path} is invalid: {reason}. Run `openlogos env check` for details.',
    'smoke.env.required': 'This project has an environment registry; pass --env <id|alias>. Available: {available}.',
    'smoke.env.unknown': 'Unknown environment "{input}". Available: {available}.',
    'smoke.env.mismatch': 'DEPLOY_DONE records environment "{deployed}", but smoke targets "{target}". Smoke must run against the environment that was deployed.',
    'smoke.env.superseded': 'The environment was deployed again after this change was marked deployed (DEPLOY_DONE {marker}; latest deployment {latest}, {channel} channel, result {result}), so it no longer runs this change\'s deployment. Redeploy through the proposal channel, then run smoke again.',
    'deploy.error.projectNotInitialized': 'Project is not initialized (logos/logos.config.json not found).',
    'deploy.error.argsConflict': 'Invalid deploy arguments: {detail}',
    'deploy.args.missingValue': '{flag} requires a value.',
    'deploy.args.multiplePending': '--complete, --abandon and --reconcile cannot be combined.',
    'deploy.args.pendingWithDeployArgs': '--complete / --abandon / --reconcile handle an existing pending deployment and cannot be combined with --ref, --rollback, --channel or --dry-run.',
    'deploy.args.resultWithoutComplete': '--result is only valid with --complete.',
    'deploy.args.resultRequired': '--complete requires --result done|failed.',
    'deploy.args.refAndRollback': '--ref and --rollback are mutually exclusive.',
    'deploy.args.channelInvalid': '--channel must be proposal or version (got "{channel}").',
    'deploy.args.rollbackProposal': '--rollback always uses the version channel and cannot be combined with --channel proposal.',
    'deploy.args.forcePromoteEmpty': '--force-promote requires a non-empty reason.',
    'deploy.args.forcePromoteNotConfigured': '--force-promote only applies to environments with promote_from; {environment} has none.',
    'deploy.args.forcePromoteWithRollback': '--force-promote cannot be combined with --rollback (rollback skips the promotion check).',
    'deploy.args.forcePromoteWithPending': '--force-promote cannot be combined with --complete / --abandon / --reconcile.',
    'deploy.error.promotionUnverified': 'Environment {environment} promotes from {from}, but commit {requested} has not passed a verified smoke in {from}. Deploy and smoke it in {from} first, or have a human run with --force-promote "<reason>".',
    'deploy.error.approvalRequired': 'Environment {environment} requires approval, and commit {requested} has no unused approval. A human must approve it first (AI must not approve on your behalf): {command}',
    'approve.error.projectNotInitialized': 'Project is not initialized (logos/logos.config.json not found). Run openlogos init first.',
    'approve.error.notRequired': 'Environment {environment} does not require approval (require_approval is not true in logos/environments.yaml); nothing to approve.',
    'approve.error.refRequired': '--ref is required: approvals bind an exact commit. Usage: openlogos approve --env <id> --ref <revision>.',
    'approve.error.writeFailed': 'Could not write the approval to the deployment ledger ({reason}); the ledger is unchanged.',
    'approve.text.created': 'Approval recorded for {environment}',
    'approve.text.existing': 'An unused approval already exists for {environment}; nothing new was written',
    'approve.text.ref': 'commit: {ref} ({input})',
    'approve.text.approver': 'approver: {approver} (display only)',
    'approve.text.note': 'note: {note}',
    'deploy.error.registryNotFound': 'Environment registry not found: {path}. openlogos deploy requires a registry with a deploy configuration.',
    'deploy.error.registryInvalid': 'Environment registry is invalid ({path}): {reason}. Run openlogos env check for details.',
    'deploy.error.envRequired': '--env is required. Available environments: {available}.',
    'deploy.error.envUnknown': 'Unknown environment "{input}". Available environments: {available}.',
    'deploy.error.notConfigured': 'Environment {environment} has no deploy configuration in logos/environments.yaml.',
    'deploy.error.pendingNotFound': 'Environment {environment} has no pending deployment matching {deployId}.',
    'deploy.error.gitRequired': 'openlogos deploy requires the project to be a git repository.',
    'deploy.error.inProgress': 'Environment {environment} is already being deployed (deploy_id {deployId}, mode {mode}, started {startedAt}).',
    'deploy.error.refRequired': 'The version channel requires --ref <revision> or --rollback.',
    'deploy.error.refUnresolved': 'Cannot resolve "{ref}" to a git commit.',
    'deploy.error.rollbackTargetMissing': 'Environment {environment} has no previous successful version to roll back to.',
    'deploy.error.secretsMissing': 'Deploy secrets of environment {environment} are missing from the process environment: {names}.',
    'deploy.error.scriptMissing': 'Deploy script {script} does not exist in commit {commit}.',
    'deploy.error.scriptNotExecutable': 'Deploy script {script} is not executable in commit {commit} (git mode must be 100755).',
    'deploy.error.worktreeMismatch': 'workdir: in-place requires HEAD to equal the requested commit and a clean working tree (HEAD {head}, requested {requested}, uncommitted changes: {dirty}).',
    'deploy.error.failed': 'Deployment to {environment} failed: {reason}. Log: {logPath}.',
    'deploy.error.failedLedgerNotWritten': 'The failure could not be written to the ledger: {reason}.',
    'deploy.error.recordFailed': 'Deployment {deployId} to {environment} succeeded (ref {ref}) but recording it failed: {reason}. Re-run openlogos deploy (or openlogos deploy-done --env --ref on the proposal channel) to record it.',
    'deploy.error.rollbackIncomplete': 'restore incomplete: {problems}',
    'deploy.failure.exitCode': 'the script exited with code {code}',
    'deploy.failure.timeout': 'the script exceeded timeout_sec {sec} and its process tree was terminated',
    'deploy.failure.spawn': 'the script could not be started ({reason})',
    'deploy.failure.worktree': 'cannot create the isolated worktree: {reason}',
    'deploy.warning.worktreeCleanupFailed': 'Failed to remove the isolated worktree {path}: {reason}.',
    'deploy.word.yes': 'yes',
    'deploy.word.no': 'no',
    'deploy.report.title': '# Deployment Report',
    'deploy.report.section': '## Deployment {time} → {environment}',
    'deploy.report.environment': 'Target environment',
    'deploy.report.channel': 'Channel / mode',
    'deploy.report.script': 'Script',
    'deploy.report.duration': 'Duration',
    'deploy.report.result': 'Result',
    'deploy.report.unconfirmed': 'unconfirmed',
    'deploy.report.none': 'none',
    'deploy.text.done': '✓ Deployed to {environment} (deploy_id {deployId})',
    'deploy.text.dryRun': 'Dry run for {environment}: all checks passed, nothing was executed or written',
    'deploy.text.channel': 'Channel / mode: {channel} / {mode}',
    'deploy.text.requested': 'Requested: {input} → {requested}',
    'deploy.text.ref': 'Confirmed ref: {ref}',
    'deploy.text.rollback': 'Rollback from: {from}',
    'deploy.text.promotedFrom': 'Promoted from: {from} (verified upstream)',
    'deploy.text.promotionOverride': 'Promotion check overridden: {reason}',
    'deploy.text.approval': 'Approval used: {id}',
    'deploy.text.plan': 'Would run: {script} {args} (workdir: {workdir})',
    'deploy.text.log': 'Log: {path}',
    'deploy.text.proposal': 'Proposal {slug}: [deploy] tasks {checked}/{total} checked, DEPLOY_DONE written',
    'deploy.error.ciUnavailable': 'CI is not available: {reason}.',
    'deploy.error.ciRefNotDispatchable': 'The GitHub Actions dispatch ref is not usable: {reason}.',
    'deploy.error.resultUnknown': 'The result of deployment {deployId} to {environment} is unknown: {reason}. The environment stays occupied; run openlogos deploy --env {environment} --reconcile later, or --abandon {deployId} once the run is known to be over.',
    'deploy.error.pendingNotCi': 'The pending deployment of environment {environment} uses mode {mode}; only ci pending deployments can be reconciled.',
    'deploy.error.reconcileNoRunId': 'Pending deployment {deployId} of environment {environment} has no run identity, so its result cannot be queried. Once the remote run is known to be over, release it with --abandon {deployId}.',
    'deploy.error.ciQueryFailed': 'Cannot query the status of CI run {runId}.',
    'deploy.error.abandonRecordFailed': 'Could not record abandoning deployment {deployId} of environment {environment}: {reason}. The pending record is kept.',
    'deploy.failure.ciConclusion': 'the CI run concluded with {conclusion}',
    'deploy.failure.ciObserveTimeout': 'CI run {runId} did not finish within timeout_sec {sec}',
    'deploy.failure.ciRunIdMissing': 'the dispatch response did not include a run identity',
    'deploy.warning.refUnconfirmed': 'The deployed version is not confirmed: requested {requested}, reported {reported}. ref is recorded as null.',
    'deploy.text.reconciled': '✓ Reconciled deployment {deployId} of {environment}',
    'deploy.text.stillRunning': '… Deployment {deployId} of {environment} is still running; the environment stays occupied',
    'deploy.text.abandoned': '✓ Abandoned pending deployment {deployId} of {environment}',
    'deploy.text.planWorkflow': 'Would dispatch: {workflow} @ {ref}',
    'deploy.text.run': 'Run: {runId} {url}',
    'deploy.error.pendingNotAgent': 'The pending deployment of environment {environment} uses mode {mode}; only agent pending deployments can be completed with --complete.',
    'deploy.error.pendingChanged': 'The pending deployment {deployId} of environment {environment} was completed, abandoned or replaced meanwhile; nothing was written.',
    'deploy.error.dryRunCmdVerify': 'The proposal verify uses a cmd predicate, which a dry run does not execute, so verify cannot be confirmed read-only. Run the deployment without --dry-run, or record verify with openlogos verify first.',
    'deploy.failure.agentReported': 'the executing agent reported the deployment as failed',
    'deploy.text.awaitingAgent': '… Deployment {deployId} of {environment} is registered and awaiting the agent; the environment is occupied',
    'deploy.text.planAgent': 'Deployment plan: {path} (section: {section})',
    'deploy.text.completeHint': 'When finished, run openlogos deploy --env {environment} --complete {deployId} --result done|failed (or --abandon {deployId}).',
    'env.issue.DEPLOY_CI_UNAVAILABLE': 'Environment {environment} deploys through GitHub Actions but gh is not usable: {reason}.',
    'smoke.env.markerInvalid': 'DEPLOY_DONE content is invalid ({problems}). Confirm the actual deployed environment and version, then re-run `openlogos deploy-done --env <id> [--ref <revision>]`.',
    'smoke.env.markerUnreadable': 'Cannot read DEPLOY_DONE ({reason}); a read failure does not prove a legacy empty marker. Fix the file, then re-run `openlogos deploy-done --env <id> [--ref <revision>]` if needed.',
    'smoke.ledger.appendFailed': 'Failed to append the smoke record to the deployment ledger ({reason}); SMOKE_PASS / SMOKE_FAIL were not changed. Gate result of this run: {gate}; smoke-report.md was already written for this run and is kept. Fix the cause and re-run smoke.',
    'smoke.ledger.markerFailed': 'The smoke record was appended to the deployment ledger, but updating the smoke marker failed ({reason}); {rollback} Gate result of this run: {gate}; smoke-report.md was already written for this run and is kept.',
    'smoke.ledger.rollbackComplete': 'SMOKE_PASS / SMOKE_FAIL were restored to their previous state and this run\'s ledger record was removed.',
    'smoke.ledger.rollbackIncomplete': 'rollback is incomplete, please check manually: {problems}.',
    'smoke.env.evidence': 'Environment evidence: {evidence} · ref: {ref} · {verified}',
    'smoke.env.refUnknown': 'unknown',
    'smoke.env.verified': 'verified',
    'smoke.env.notVerified': 'not verified',
    // env（environment-registry，S41）
    'env.usage': 'Usage: openlogos env <list | show <id|alias> | check [<id|alias>] [--probe]> [--format json]',
    'env.error.projectNotInitialized': 'logos/logos.config.json not found.',
    'env.error.registryNotFound': 'Environment registry {path} not found; environment management is not enabled for this project.',
    'env.error.registryInvalid': 'Environment registry {path} is invalid: {reason}. Run `openlogos env check` for details.',
    'env.error.unknown': 'Unknown environment "{input}". Available: {available}.',
    'env.error.argRequired': 'Missing environment id or alias. Available: {available}.',
    'env.list.title': 'Environments ({path})',
    'env.list.absent': 'No environment registry ({path}); environment management is not enabled.',
    'env.list.empty': 'The registry defines no environments.',
    'env.view.aliases': 'aliases: {aliases}',
    'env.view.proposalDefault': '  (proposal default)',
    'env.view.currentRef': 'current ref: {ref}',
    'env.view.unknownRef': 'unknown',
    'env.view.lastDeploy': 'last deploy: {time} ({slug})',
    'env.view.lastSmoke': 'last smoke: {result}{verified} at {time}',
    'env.view.verified': ' (verified)',
    'env.view.notVerified': ' (not verified)',
    'env.view.never': 'never',
    'env.view.previousRef': 'previous ref (rollback target): {ref}',
    'env.view.inProgress': 'deployment in progress: {id} ({mode})',
    'env.view.promotion': 'promotes from {from} (candidate ref: {ref})',
    'env.view.approvalRequired': 'approval required; {count} open approval(s)',
    'env.view.approvalNotRequired': 'approval not required; {count} open approval(s)',
    'env.view.openApproval': 'approval {id}: ref {ref}, by {approver} at {time}',
    'env.show.history': 'History (newest first, up to {limit}):',
    'env.ledger.corrupt': 'Ledger {path}: {count} invalid line(s) skipped.',
    'env.check.title': 'Environment registry check ({path})',
    'env.check.ok': 'No problems found.',
    'env.check.problems': '{count} problem(s) found.',
    'env.check.secret': 'secret {name} ({environment}): {state}',
    'env.check.secretSet': 'set',
    'env.check.secretMissing': 'MISSING',
    'env.check.probe': '{kind} {url}: {state}',
    'env.issue.ENV_REGISTRY_INVALID': 'Environment registry is invalid: {reason}.',
    'env.issue.ENV_FIELD_INVALID': 'Environment {environment}: field {field} is invalid ({reason}).',
    'env.issue.ENV_FIELD_INVALID_TOP': 'Registry field {field} is invalid ({reason}).',
    'env.issue.ENV_DUPLICATE_ID_OR_ALIAS': 'Environment {environment}: {field} value "{value}" is not unique ({reason}).',
    'env.issue.ENV_UNKNOWN_FIELD': 'Unknown field {field}{where} (ignored).',
    'env.issue.ENV_GATE_REFERENCE_UNKNOWN': 'deployment_gates.{module}.environments references unregistered environment "{value}".',
    'env.issue.ENV_SECRET_MISSING': 'Environment {environment}: variable {name} is not set in the current process environment.',
    'env.issue.ENV_PROBE_FAILED': 'Environment {environment}: {kind} probe {url} failed ({detail}).',
    'smoke.gate.notRequired': 'Active proposal \'{slug}\' does not require smoke. Run `openlogos archive {slug}` after verification passes.',
    'smoke.gate.decisionConflict': 'Deployment decision conflict. {reason} Fix the deployment decision in proposal.md / tasks.md first.',
    'smoke.gate.deployNotDone': 'DEPLOY_DONE marker is missing. Complete the deployment, then run `openlogos deploy-done` before smoke.',
    'smoke.gate.deployTasksIncomplete': 'The [deploy] section in tasks.md still has unchecked items. Finish the [deploy] tasks, then run `openlogos deploy-done`.',
    'archive.gate.verifyNotPassed': 'Verification has not passed. Run `openlogos verify` and resolve any VERIFY_FAIL marker before archiving.',
    'archive.gate.deployNotDone': 'This proposal requires deployment but DEPLOY_DONE is missing. Run `openlogos deploy-done` after the deployment is complete. A SMOKE_PASS marker does not imply the deployment was done.',
    'archive.gate.smokeNotPassed': 'This proposal requires smoke but SMOKE_PASS is missing (or SMOKE_FAIL is present). Run `openlogos smoke` before archiving.',
    'next.stateInconsistencyHint': 'Inconsistent state detected ({evidence}) while DEPLOY_DONE is missing — run `{remediation}` to reconcile.',

    // change
    'change.creating': 'Creating change proposal: {slug}',
    'change.done': 'Change proposal created. Next steps:',
    'change.step1': '  1. Tell AI: "Help me fill in change proposal {slug}"',
    'change.step2': '  2. AI will analyze impact and fill in proposal.md + tasks.md',
    'change.step3': '  3. Then work through tasks.md, putting deltas in deltas/',
    'change.step4': '  4. When done, explicitly request `openlogos merge {slug}` to generate merge instructions',
    'change.guardConflict': 'Error: Active change proposal \'{activeChange}\' is still in progress.',
    'change.guardConflictHint': 'Finish it and explicitly request `openlogos archive {activeChange}` before creating a new proposal.',
    'change.guardInvalid': 'Error: logos/.openlogos-guard is invalid.',
    'change.guardInvalidHint': 'Fix or remove the guard file before creating a new proposal.',
    'change.moduleAuto': 'Module: {module} (auto-detected, only one module registered)',
    'change.moduleDefault': 'Module: {module} (defaulted to core — use --module <id> to specify another)',
    'change.moduleAssigned': 'Module: {module}',
    'change.moduleNotFound': 'Error: Module \'{module}\' not found in logos-project.yaml.',
    'change.moduleNotFoundAvailable': 'Available modules: {modules}',
    'change.moduleNotFoundHint': 'Run `openlogos module list` to see available modules.',
    'change.moduleNoCore': 'Error: this project has multiple modules and no `core`; cannot infer change ownership.',
    'change.moduleNoCoreRetryHeader': 'Retry with one of:',

    // merge
    'merge.summary': 'Merge Summary:',
    'merge.proposal': '  - Change proposal: {slug}',
    'merge.deltaCount': '  - Delta files: {count}',
    'merge.aiHint': 'Tell AI: "Read logos/changes/{slug}/MERGE_PROMPT.md and execute merge"',
    'merge.noDelta': 'No delta files in logos/changes/{slug}/deltas/ — no-delta spec-complete marker written.',
    'merge.alreadyMerged': 'Specs already merged for \'{slug}\' (SPEC_MERGED exists) — nothing to do.',
    'merge.conservationRejected': 'Error: delta entry-conservation check failed (S37): {path} — refusing to generate MERGE_PROMPT; no markers written.',
    'merge.conservationHint': '  Fix: carry the full remaining section content in the same-anchor MODIFIED block, or name each removed ID in a same-anchor REMOVED-ITEMS block (`- <ID> — <reason>`); use a heading-path anchor (`parent > target`) when the title repeats. Run `openlogos change-lint` first to locate all violations at the producing side.',
    'merge.archiveHint': 'Specs are merged and SPEC_MERGED is written. Next: implement the code, run `openlogos verify`, and explicitly request `openlogos archive {slug}` after verification passes. To re-merge, run `git checkout logos/resources/`, fix the deltas and rerun `openlogos merge`.',

    // launch
    'launch.done': '✓ Module "{module}" launched! Change management is now active.',
    'launch.hint1': '  From now on, modifications to existing documents require a change proposal.',
    'launch.hint2': '  Run `openlogos change <slug>` to start a new change proposal.',
    'launch.rulesUpdated': 'AI rules updated in {target}',
    'launch.moduleAlreadyLaunched': 'Module "{module}" is already launched. No action needed.',
    'launch.multiModuleError': 'Multiple modules found ({modules}). Please specify: `openlogos launch <module-id>`',
    'launch.moduleNotFound': 'Module "{module}" not found in logos-project.yaml.',
    'launch.migrationAuto': 'Migrated: module "{module}" auto-marked as launched (was config.lifecycle: active).',
    'launch.migrationWarn': 'Warning: config.lifecycle is "active" but no module is marked launched. Run `openlogos launch <module-id>` to migrate.',
    'launch.suggest': 'Run `openlogos launch` to activate change management for future iterations.',
    'launch.verifyRequired': 'Module "{module}" cannot launch before `openlogos verify` passes and writes logos/resources/verify/acceptance-report.md.',
    'launch.deployRequired': 'Module "{module}" requires deployment before launch. Complete deployment and write logos/resources/verify/deployment-report.md first.',
    'launch.smokeRequired': 'Module "{module}" requires deployment smoke before launch. Explicitly run `openlogos smoke` and write logos/resources/verify/smoke-report.md first.',

    // next
    'next.title': 'Next Step',
    'next.nextNode': 'Next node',
    'flow.rawBuiltin': 'built-in @{version}',
    'flow.resolvedApplied': 'resolved · project overlay applied',
    'flow.resolvedNoOverlay': 'resolved · no project overlay',
    'flow.notSkippable': 'not skippable',
    'flow.resolvedHint': 'Tip: use --resolved to view the effective flow after applying project overlay.',
    'next.createChange': 'Create a change proposal before modifying any code',
    'next.createChangeDetail': 'Run `openlogos change <slug>` to create a new change proposal and activate the guard.',
    'next.fillProposal': 'Fill in proposal.md and tasks.md for the active change',
    'next.fillProposalDetail': 'Tell AI: "Help me fill in change proposal {slug}" — AI will analyze impact and complete the proposal.',
    'next.writeDeltas': 'Write delta documents',
    'next.writeDeltasDetail': 'Tell AI: "Continue writing delta files for {slug}" — keep changes under logos/changes/{slug}/deltas/. When all delta tasks are checked, explicitly request `openlogos merge {slug}`.',
    'next.approvePlan': 'Approve the plan (proposal/tasks and [code] slicing)',
    'next.approvePlanDetail': 'Review and approve proposal.md + tasks.md (incl. [code] slicing) at the plan gate. In --auto the plan-exit gate auto-passes (audited). After approval, write delta files for {slug}.',
    'next.startCoding': 'Start implementing per tasks.md',
    'next.startCodingDetail': 'Tell AI: "Execute tasks in logos/changes/{slug}/tasks.md" — implement code and write tests. Check off each [code] task when done.',
    'next.planSlices': 'Plan [code] slices (slice-planner)',
    'next.planSlicesDetail': 'Tell AI: run slice-planner for {slug} — slice the [code] section against the merged specs + real test IDs (six-dim scoring, vertical/horizontal discriminator, delete-the-rest falsification gate), then approve at the slice-exit gate.',
    'next.replanHint': ' To re-slice instead: openlogos slice transaction reopen --reason "<why>".',
    'next.runVerify': 'Run verification',
    'next.runVerifyDetail': 'Explicitly request `openlogos verify` to run acceptance tests.',
    'next.archive': 'Archive the proposal',
    'next.archiveDetail': 'Explicitly request `openlogos archive {slug}` to close this proposal.',
    'next.authorizeDeploy': 'Authorize deployment',
    'next.authorizeDeployDetail': 'Deployment is a human confirmation point. If ready, explicitly ask AI to execute the deployment tasks for {slug} from the merged deployment plan.',
    'next.runSmoke': 'Run deployment smoke tests',
    'next.runSmokeDetail': 'Explicitly request `openlogos smoke` after deployment is complete.',
    'next.fixAndSmoke': 'Fix smoke failures and re-run smoke',
    'next.fixAndSmokeDetail': 'Fix the deployment environment or smoke checks, then explicitly request `openlogos smoke` again.',
    'next.fixAndVerify': 'Fix issues and re-verify',
    'next.fixAndVerifyDetail': 'Fix the failing tests, then explicitly request `openlogos verify` again.',
    'next.continueImpl': 'Continue implementation and run tests',
    'next.continueImplDetail': 'When all tasks are done, explicitly request `openlogos merge {slug}` to generate merge instructions.',
    'next.merge': 'Generate merge instructions',
    'next.mergeDetail': 'Explicitly request `openlogos merge {slug}` to generate MERGE_PROMPT.md.',
    'next.executeMerge': 'Execute spec merge',
    'next.executeMergeDetail': 'Ask AI to read logos/changes/{slug}/MERGE_PROMPT.md, merge deltas into logos/resources, commit docs, then write logos/changes/{slug}/SPEC_MERGED.',
    'next.specCompleteRequired': 'Complete no-delta spec marker',
    'next.specCompleteRequiredDetail': 'Explicitly request `openlogos merge {slug}` to write the no-delta SPEC_MERGED marker before planning [code] slices.',
    'next.testIdRequired': 'Add real test IDs',
    'next.testIdRequiredDetail': 'Add or explicitly reference real UT/ST/SMOKE IDs for {slug}; `plan-slices` is blocked until test IDs are stable.',
    'next.launch': 'Activate change management for future iterations',
    'next.phaseDetail': 'Current phase: {phase}',

    // archive
    'archive.done': '✓ Change proposal \'{slug}\' archived.',
    'archive.path': '  logos/changes/{slug}/ → logos/changes/archive/{slug}/',
    'archive.watch.failed': 'Error [{code}]: archive watcher handshake failed ({reason}).',
    'archive.watch.details': '  Instances: {details}',
    'archive.watch.incompatible': 'A RunLogos instance cannot coordinate this protocol. Upgrade openlogos CLI or close that instance, then retry.',
    'archive.watch.legacyBusy': 'Error: Windows could not move the proposal directory. An older RunLogos instance or another program may still be watching it; upgrade or close the application, then retry.',
    'archive.watch.reconciled': '  Archive completion was reconciled from disk state after an operation error.',

    // impact (S36)
    'impact.header': 'impact: lifecycle_only = {value}',
    'impact.filesHeader': 'files ({count}):',
    'impact.nonLifecycleHeader': 'non-lifecycle paths ({count}):',
    'impact.operationsLine': 'operations: {ops}',
    'impact.changesLine': 'changes: {changes}',
    'impact.reasonsHeader': 'reasons:',
    'impact.footerTrue': 'Conclusion: all changes are lifecycle bookkeeping (safe to skip artifact build). CI must read only lifecycle_only.',
    'impact.footerFalse': 'Conclusion: not lifecycle-only (fail-closed). CI must read only lifecycle_only.',
  },
  zh: {
    // init
    'init.creating': 'Creating OpenLogos project structure for "{name}"{source}...',
    'init.done': '项目初始化完成。下一步：',
    'init.step1': '  1. 检查 logos/logos.config.json 确认项目配置',
    'init.nameTip': '  提示：项目名 "{name}" 是自动探测的{source}。\n       如需修改，编辑 logos/logos.config.json 后运行 `openlogos sync`。',
    'init.pythonMissingHeader': '提示：未检测到 Python 3。',
    'init.pythonMissingBody': '  内置的 ui-ux-pro-max skill（专业 UI/UX 设计智能）需要 Python 3.x 才能运行。\n  安装后，在 Phase 2 做 GUI 类产品（Web / 移动 / 桌面）设计时即可自动获得\n  风格 / 配色 / 字体 / 组件库推荐。\n  安装方式：\n    macOS:  brew install python3\n    Ubuntu: sudo apt install python3\n    Windows: winget install Python.Python.3.12\n  此提示不影响 OpenLogos 主流程，其他 skill 可正常使用。',
    'init.step2': '  2. 开始 Phase 1：对 AI 说「帮我写需求文档」',
    'init.step3': '  3. 随时运行 `openlogos status` 查看进度',
    'init.nameConflict': '检测到项目名不一致：',
    'init.nameChoice1': '  1. "{name}"  ← 你的输入',
    'init.nameChoice2': '  2. "{name}"     ← 来自 {source}',
    'init.namePrompt': '使用哪个名称？[1/2]（默认 1）：',
    'init.langPrompt': '请选择 [1/2]（默认 1）：',
    'init.aiToolHeader': '选择 AI 编码工具:',
    'init.aiToolClaudeCode': '  1. Claude Code（默认）',
    'init.aiToolOpenCode': '  2. OpenCode',
    'init.aiToolCodex': '  3. Codex',
    'init.aiToolCursor': '  4. Cursor',
    'init.aiToolOther': '  5. 其他',
    'init.aiToolAll': '  6. 全部（为所有工具初始化）',
    'init.aiToolPrompt': '请选择 [1/2/3/4/5/6]（默认: 1）: ',
    'init.skillsDeployed': '{count} 个 Skills 已部署到 {target}',
    'init.skillsSynced': '{count} 个 Skills 已同步到 {target}',
    'init.opencodePluginDeployed': 'OpenCode 插件已部署到 {target}',
    'init.opencodePluginSynced': 'OpenCode 插件已同步到 {target}',
    'init.opencodeConfigCreated': '已创建 opencode.json，并写入推荐权限默认值',
    'init.opencodeConfigUpdated': '已为 opencode.json 补齐缺失的推荐权限默认值',
    'init.opencodeCommandsDeployed': 'OpenCode 斜杠命令已部署到 .opencode/commands/（{count} 个文件）',
    'init.codexPluginDeployed': 'Codex 插件已部署到 {target}',
    'init.codexPluginSynced': 'Codex 插件已同步到 {target}',
    'init.codexConfigCreated': '已创建 .codex/config.toml，并写入插件与 hook 配置',
    'init.codexConfigUpdated': '已为 .codex/config.toml 补齐插件与 hook 配置',
    'init.codexPersonalPluginInstalled': '已刷新 Codex 个人 marketplace：openlogos@personal',
    'init.codexPersonalPluginInstallFailed': 'Codex 个人插件安装失败；请在 sync 后手动运行 `codex plugin add openlogos@personal`。',
    'init.codexProjectSkillsPreserved': '已保留项目专属 Codex skills/plugins，未放入 OpenLogos 命名空间。',
    'init.claudePluginDeployed': 'Claude Code 插件已部署：{commandCount} 个命令，{agentCount} 个 agent → .claude/',
    'init.claudePluginSynced': 'Claude Code 插件已同步：{commandCount} 个命令，{agentCount} 个 agent → .claude/',
    'init.claudePluginSkipped': 'Claude Code 插件已存在（.claude/commands/openlogos/ 已有文件），跳过部署',
    'init.claudeHooksUpdated': '.claude/settings.json 已写入 SessionStart hook',
    'init.claudeLanguageCustom': '项目 .claude/settings.json 的 language 为自定义值 {value}，未改动',
    'sync.indexAdded': '{count} 个新文件已补录到 logos-project.yaml resource_index',
    'sync.indexNoop': 'logos-project.yaml resource_index 已是最新，无需补录',
    'sync.scenariosModuleAdded': '{count} 个 scenario 已补全 module 字段到 logos-project.yaml',

    // status
    'phase.1': 'Phase 1 · 需求文档 (WHY)',
    'phase.2': 'Phase 2 · 产品设计 (WHAT)',
    'phase.3-0': 'Phase 3-0 · 技术架构',
    'phase.3-1': 'Phase 3-1 · 场景建模',
    'phase.3-2-api': 'Phase 3-2 · API 设计',
    'phase.3-2-db': 'Phase 3-2 · 数据库设计',
    'phase.3-3-deployment': 'Phase 3-3 · 部署方案',
    'phase.3-4a': 'Phase 3-4a · 测试用例设计（单元 + 场景）',
    'phase.3-4b': 'Phase 3-4b · API 编排测试',
    'phase.3-5': 'Phase 3-5 · 代码实现',
    'phase.3-6': 'Phase 3-6 · 测试验收（verify）',
    'phase.3-7-deploy': 'Phase 3-7 · 部署执行',
    'phase.3-8-smoke': 'Phase 3-8 · 部署冒烟测试（smoke）',
    'status.modules': '模块',
    'yaml.degraded': '警告：logos-project.yaml 已降级（parse_status: {status}），CLI 当前仅基于 AST 恢复出的数据运行。',
    'status.activeProposals': '活跃变更提案',
    'status.activeChange': '活跃变更',
    'status.proposalStepLabel': '当前步骤',
    'status.proposalStep.writing': '填写提案 — 请完善 proposal.md 和 tasks.md',
    'status.proposalStep.ready-to-delta': '方案待批准 — 批准方案（含切片划分）后开始撰写 Delta',
    'status.proposalStep.delta-writing': '撰写 Delta — 更新变更增量文档',
    'status.proposalStep.implementing': '撰写 Delta — 更新变更增量文档',
    'status.proposalStep.in-progress': '撰写 Delta — 更新变更增量文档',
    'status.proposalStep.ready-to-merge': '可合并 — 明确授权执行 merge，再明确授权执行归档',
    'status.proposalStep.merge-generated': '合并指令已生成 — 等待 AI 合并主规格',
    'status.proposalStep.spec-complete-required': '需完成规格阶段 — 先执行 no-delta merge 写入 SPEC_MERGED，再规划代码切片',
    'status.proposalStep.test-id-required': '需补测试 ID — 先补充或显式复用真实 UT/ST/SMOKE ID，再规划代码切片',
    'status.proposalStep.ready-to-implement': '切片待批准 — 批准 [code] 切片划分（slice-exit 门）后开始实现',
    'status.proposalStep.coding': '编码中 — 按已合并规格实现代码',
    'status.proposalStep.ready-to-verify': '待验收 — 明确授权执行 `openlogos verify`',
    'status.proposalStep.verify-passed': '验收通过 — 明确授权执行 `openlogos archive` 归档',
    'status.proposalStep.verify-failed': '验收未通过 — 修复问题后重新运行 `openlogos verify`',
    'status.proposalStep.ready-to-deploy': '待部署 — 部署必须由人类明确授权',
    'status.proposalStep.deploy-done': '部署完成',
    'status.proposalStep.ready-to-smoke': '待冒烟测试 — 明确授权执行 `openlogos smoke`',
    'status.proposalStep.smoke-passed': '冒烟测试通过 — 明确授权执行 `openlogos archive` 归档',
    'status.proposalStep.smoke-failed': '冒烟测试未通过 — 修复环境或 smoke 检查后重新运行 `openlogos smoke`',
    'status.deployTasks': '部署任务',
    'status.allDone': '所有阶段已完成！',
    'status.allDoneHint': '   → 或运行 `openlogos launch` 开始迭代开发',
    'status.suggestNext': '建议下一步：{label}',
    'suggest.phase1': '对 AI 说：「帮我写需求文档」',
    'suggest.phase2': '对 AI 说：「基于需求文档做产品设计」',
    'suggest.phase3-0': '对 AI 说：「帮我设计技术架构」',
    'suggest.phase3-1': '对 AI 说：「帮我画 S01 的时序图」',
    'suggest.phase3-2-api': '对 AI 说：「帮我设计 API」',
    'suggest.phase3-2-db': '对 AI 说：「帮我设计数据库」',
    'suggest.phase3-3-deployment': '对 AI 说：「帮我设计部署方案」',
    'suggest.phase3-4a': '对 AI 说：「帮我设计测试用例」',
    'suggest.phase3-4b': '对 AI 说：「帮我设计编排测试」',
    'suggest.phase3-5': '对 AI 说：「请按 Phase 3 Step 5 执行代码实现」',
    'suggest.phase3-6': '运行测试后明确授权执行 `openlogos verify`',
    'suggest.phase3-7-deploy': '部署必须由人类明确授权。确认后再要求 AI 按部署方案执行部署。',
    'suggest.phase3-8-smoke': '部署完成后明确授权执行 `openlogos smoke`',
    'suggest.fallback': '继续完善文档',

    // verify
    'verify.title': 'OpenLogos 测试验收',
    'verify.readingResults': '读取测试结果：{path}',
    'verify.readingCases': '读取测试用例：logos/resources/test/',
    'verify.summary': '结果摘要',
    'verify.totalDefined': '定义用例：  {count} 个（{ut} UT + {st} ST）',
    'verify.totalExecuted': '执行用例：  {count} 个',
    'verify.passed': '通过：    {count}',
    'verify.failed': '失败：     {count}',
    'verify.skipped': '跳过：     {count}',
    'verify.manual': '人工用例（已排除）：{count}',
    'verify.coverage': '覆盖度：{pct}%（{covered}/{total}）',
    'verify.passRate': '通过率：{pct}%（{passed}/{total}）',
    'verify.gatePass': 'Gate 3.6：PASS',
    'verify.gateFail': 'Gate 3.6：FAIL',
    'verify.gateFailCoverage': 'Gate 3.6：FAIL（覆盖不完整）',
    'verify.failedCases': '失败用例：',
    'verify.uncoveredCases': '未覆盖用例（{count}）：',
    'verify.reportPath': '报告：{path}',
    'verify.noResults': '未找到测试结果文件：{path}\n请先运行测试，再重试。',
    'verify.noCases': '未找到测试用例规格文件（logos/resources/test/）。\n请先完成测试设计（Step 3a）。',
    'verify.checklistTitle': '设计时覆盖度（Layer 1）',
    'verify.checklistSummary': '覆盖度校验：{checked}/{total} 项确认',
    'verify.checklistUnchecked': '未确认项（{count}）：',
    'verify.gateFailChecklist': 'Gate 3.6：FAIL（设计时覆盖度校验未通过）',
    'verify.acTitle': '验收条件追溯（Layer 3）',
    'verify.acSummary': '验收追溯：{passed}/{total} 个验收条件通过',
    'verify.acFailed': '未通过的验收条件（{count}）：',
    'verify.gateFailAc': 'Gate 3.6：FAIL（验收条件追溯未完全通过）',
    'verify.preRunConfigAdded': '已检测到并写入 verify 预跑配置：{command}',
    'verify.preRunConfigTodo': '无法推断 verify 预跑配置，请手动填写 verify.pre_run_command 或 verify.regression_command。',
    'verify.preRunCompatSkipped': 'verify.pre_run_command 作为兼容配置保留，但由于已配置两阶段 verify，本次未执行该命令。',
    'verify.coverageLocalDiag': '当前项目未配置 verify 预跑命令，覆盖不足可能是因为只运行了局部测试。',
    'verify.coverageLocalSuggestionPreRun': '在 logos/logos.config.json 中配置 verify.pre_run_command，一次运行生成完整 test-results.jsonl。',
    'verify.coverageLocalSuggestionTwoPhase': '如果项目采用回归 + 增量测试，可配置 verify.regression_command 与 verify.incremental_command，并使用 last-write-wins 合并结果。',
    'verify.preRunModeNone': 'verify 预跑模式：无',
    'verify.preRunModeSingle': 'verify 预跑模式：单阶段',
    'verify.preRunModeTwoPhase': 'verify 预跑模式：双阶段',
    'verify.preRunStageLine': '[{status}] {stage}：{command}（exit={exit}，duration={duration}）',
    'verify.sandboxSummary': 'verify 沙箱：mode={mode}，status={status}，isolated={isolated}，write_denied={writeDenied}',
    'smoke.sandboxSummary': 'smoke 沙箱：mode={mode}，status={status}，isolated={isolated}，write_denied={writeDenied}',
    'verify.deployTasksTitle': '部署任务',
    'verify.deployHumanGate': '部署是人类确认点。AI 未经明确授权不得发起部署。',
    'verify.deployAiHint': '获得授权后，AI 必须读取合并后的部署方案和当前提案，再逐项执行 [deploy] 任务。',
    'deployDone.title': 'OpenLogos deploy-done',
    'deployDone.proposal': '提案：{slug}',
    'deployDone.environment': '环境：{environment}',
    'deployDone.marker': '标记：{path}',
    'deployDone.deployTasks': '部署任务：{checked}/{total}',
    'deployDone.clearedSmokeMarkers': '已清理过期 smoke 标记：{markers}',
    'deployDone.nextSmoke': '下一步：明确授权执行 `{command}`。',
    'deployDone.nextArchive': '下一步：明确授权执行 `{command}`。',
    'deployDone.error.projectNotInitialized': '未找到 logos/logos.config.json。',
    'deployDone.error.noActiveChange': '未找到活跃变更提案。请仅在活跃提案 verify 通过后执行此命令。',
    'deployDone.error.changeNotFound': '变更提案 \'{slug}\' 不存在。',
    'deployDone.error.verifyNotPassed': '验收尚未通过。请先运行 `openlogos verify`，并解决任何 VERIFY_FAIL 标记。',
    'deployDone.error.decisionConflict': '部署决策冲突。{reason}',
    'deployDone.error.notRequired': '当前提案不需要部署。验收通过后可直接归档。',
    'deployDone.error.deployTasksMissing': 'tasks.md 中缺少非空 [deploy] section。',
    'deployDone.error.deploymentReportMissing': '缺少部署报告：{path}。',
    'deployDone.error.deploymentReportNotWritable': '部署报告输出位置不可写：{path}。',
    'deployDone.error.registryInvalid': '环境登记表 {path} 不合法：{reason}。运行 `openlogos env check` 查看详情。',
    'deployDone.error.envRequired': '本项目已登记环境，请传入 --env <id|别名>。可用：{available}。',
    'deployDone.error.envUnknown': '未登记的环境「{input}」。可用：{available}。',
    'deployDone.error.gatedEnv': '环境 {environment} 配置了晋级 / 审批门禁（logos/environments.yaml 中的 promote_from / require_approval），deploy-done 不能为其登记部署，请改用 openlogos deploy --env {environment}。未写入任何内容。',
    'deployDone.error.refUnresolved': '无法把 --ref「{ref}」解析为 git 提交。请传入实际部署的版本。',
    'deployDone.error.writeFailed': '记录部署失败（{reason}）；{rollback}',
    'deployDone.error.writeFailedRolledBack': 'tasks.md、smoke marker、DEPLOY_DONE 与部署账本均已恢复到执行前状态。',
    'deployDone.error.writeFailedRollbackIncomplete': '恢复未完成，请人工检查：{problems}',
    'deployDone.error.writeFailedNothingWritten': '未写入任何文件。',
    'deployDone.ref': '部署版本：{ref}',
    'deployDone.refUnknown': '部署版本：未知（传入 --ref 可记录实际部署版本）',
    // smoke 环境（environment-registry，S19）
    'smoke.env.registryInvalid': '环境登记表 {path} 不合法：{reason}。运行 `openlogos env check` 查看详情。',
    'smoke.env.required': '本项目已登记环境，请传入 --env <id|别名>。可用：{available}。',
    'smoke.env.unknown': '未登记的环境「{input}」。可用：{available}。',
    'smoke.env.mismatch': 'DEPLOY_DONE 记录的部署环境为「{deployed}」，但本次 smoke 目标为「{target}」。smoke 必须针对已部署的环境执行。',
    'smoke.env.superseded': '本提案落标之后该环境又被部署过（DEPLOY_DONE 为 {marker}；最近一次部署为 {latest}，{channel} 通道，结果 {result}），环境上运行的已不是本提案的部署。请在提案通道重新部署后再执行 smoke。',
    'deploy.error.projectNotInitialized': '项目未初始化（找不到 logos/logos.config.json）。',
    'deploy.error.argsConflict': 'deploy 参数非法：{detail}',
    'deploy.args.missingValue': '{flag} 需要一个值。',
    'deploy.args.multiplePending': '--complete、--abandon 与 --reconcile 不能同时使用。',
    'deploy.args.pendingWithDeployArgs': '--complete / --abandon / --reconcile 处理已有的未决部署，不能与 --ref、--rollback、--channel、--dry-run 混用。',
    'deploy.args.resultWithoutComplete': '--result 只能与 --complete 一起使用。',
    'deploy.args.resultRequired': '--complete 需要 --result done|failed。',
    'deploy.args.refAndRollback': '--ref 与 --rollback 互斥。',
    'deploy.args.channelInvalid': '--channel 只能是 proposal 或 version（收到「{channel}」）。',
    'deploy.args.rollbackProposal': '--rollback 恒走版本通道，不能与 --channel proposal 同用。',
    'deploy.args.forcePromoteEmpty': '--force-promote 需要非空的理由。',
    'deploy.args.forcePromoteNotConfigured': '--force-promote 只适用于配置了 promote_from 的环境；{environment} 未配置。',
    'deploy.args.forcePromoteWithRollback': '--force-promote 不能与 --rollback 同用（回滚不做晋级检查）。',
    'deploy.args.forcePromoteWithPending': '--force-promote 不能与 --complete / --abandon / --reconcile 同用。',
    'deploy.error.promotionUnverified': '环境 {environment} 从 {from} 晋级，但提交 {requested} 未在 {from} 通过已验证的 smoke。请先在 {from} 部署并 smoke，或由人带 --force-promote "<理由>" 执行。',
    'deploy.error.approvalRequired': '环境 {environment} 要求审批，提交 {requested} 没有未使用的审批。须由人先批准（AI 不得代为审批）：{command}',
    'approve.error.projectNotInitialized': '项目尚未初始化（找不到 logos/logos.config.json），请先运行 openlogos init。',
    'approve.error.notRequired': '环境 {environment} 不要求审批（logos/environments.yaml 中 require_approval 不为 true），无需审批。',
    'approve.error.refRequired': '必须传 --ref：审批绑定精确的 commit。用法：openlogos approve --env <id> --ref <revision>。',
    'approve.error.writeFailed': '审批未能写入部署账本（{reason}），账本保持原样。',
    'approve.text.created': '已为 {environment} 写入审批',
    'approve.text.existing': '{environment} 已有该版本的未使用审批，未写入新记录',
    'approve.text.ref': '提交：{ref}（{input}）',
    'approve.text.approver': '审批人：{approver}（只作展示）',
    'approve.text.note': '备注：{note}',
    'deploy.error.registryNotFound': '找不到环境登记表：{path}。openlogos deploy 需要配置了 deploy 的登记表。',
    'deploy.error.registryInvalid': '环境登记表非法（{path}）：{reason}。运行 openlogos env check 查看详情。',
    'deploy.error.envRequired': '必须传 --env。可用环境：{available}。',
    'deploy.error.envUnknown': '未知环境「{input}」。可用环境：{available}。',
    'deploy.error.notConfigured': '环境 {environment} 在 logos/environments.yaml 中没有配置 deploy。',
    'deploy.error.pendingNotFound': '环境 {environment} 没有与 {deployId} 匹配的未决部署。',
    'deploy.error.gitRequired': 'openlogos deploy 要求项目是 git 仓库。',
    'deploy.error.inProgress': '环境 {environment} 正在部署中（deploy_id {deployId}，方式 {mode}，开始于 {startedAt}）。',
    'deploy.error.refRequired': '版本通道必须传 --ref <revision> 或 --rollback。',
    'deploy.error.refUnresolved': '无法把「{ref}」解析为 git commit。',
    'deploy.error.rollbackTargetMissing': '环境 {environment} 没有可回滚的上一个成功版本。',
    'deploy.error.secretsMissing': '环境 {environment} 的部署密钥在进程环境中缺失：{names}。',
    'deploy.error.scriptMissing': '部署脚本 {script} 在 commit {commit} 中不存在。',
    'deploy.error.scriptNotExecutable': '部署脚本 {script} 在 commit {commit} 中不带可执行位（git 模式须为 100755）。',
    'deploy.error.worktreeMismatch': 'workdir: in-place 要求 HEAD 等于请求 commit 且工作区无未提交改动（HEAD {head}，请求 {requested}，有未提交改动：{dirty}）。',
    'deploy.error.failed': '部署到 {environment} 失败：{reason}。日志：{logPath}。',
    'deploy.error.failedLedgerNotWritten': '失败记录未能写入账本：{reason}。',
    'deploy.error.recordFailed': '部署 {deployId} 已在 {environment} 成功（ref {ref}），但记录写入失败：{reason}。请重新执行 openlogos deploy（提案通道也可执行 openlogos deploy-done --env --ref）补记。',
    'deploy.error.rollbackIncomplete': '恢复未完成：{problems}',
    'deploy.failure.exitCode': '脚本以退出码 {code} 结束',
    'deploy.failure.timeout': '脚本超过 timeout_sec {sec}，已终止其进程树',
    'deploy.failure.spawn': '脚本无法启动（{reason}）',
    'deploy.failure.worktree': '无法创建隔离工作树：{reason}',
    'deploy.warning.worktreeCleanupFailed': '隔离工作树 {path} 移除失败：{reason}。',
    'deploy.word.yes': '是',
    'deploy.word.no': '否',
    'deploy.report.title': '# 部署报告',
    'deploy.report.section': '## 部署记录 {time} → {environment}',
    'deploy.report.environment': '目标环境',
    'deploy.report.channel': '通道 / 执行方式',
    'deploy.report.script': '执行脚本',
    'deploy.report.duration': '耗时',
    'deploy.report.result': '结果',
    'deploy.report.unconfirmed': '未确认',
    'deploy.report.none': '无',
    'deploy.text.done': '✓ 已部署到 {environment}（deploy_id {deployId}）',
    'deploy.text.dryRun': '{environment} 预演：全部检查通过，未执行、未写入任何内容',
    'deploy.text.channel': '通道 / 执行方式：{channel} / {mode}',
    'deploy.text.requested': '请求版本：{input} → {requested}',
    'deploy.text.ref': '已确认版本：{ref}',
    'deploy.text.rollback': '回滚自：{from}',
    'deploy.text.promotedFrom': '晋级自：{from}（上游已验证）',
    'deploy.text.promotionOverride': '已越过晋级检查：{reason}',
    'deploy.text.approval': '所用审批：{id}',
    'deploy.text.plan': '将执行：{script} {args}（workdir: {workdir}）',
    'deploy.text.log': '日志：{path}',
    'deploy.text.proposal': '提案 {slug}：[deploy] 任务已勾选 {checked}/{total}，已写入 DEPLOY_DONE',
    'deploy.error.ciUnavailable': 'CI 不可用：{reason}。',
    'deploy.error.ciRefNotDispatchable': 'GitHub Actions 调度 ref 不可用：{reason}。',
    'deploy.error.resultUnknown': '部署 {deployId} 到 {environment} 的结果未知：{reason}。环境保持占用；稍后执行 openlogos deploy --env {environment} --reconcile 补记，或确认远程不会再运行后用 --abandon {deployId} 解除。',
    'deploy.error.pendingNotCi': '环境 {environment} 的未决部署方式为 {mode}，只有 ci 方式的未决部署可以 reconcile。',
    'deploy.error.reconcileNoRunId': '环境 {environment} 的未决部署 {deployId} 没有运行身份，无法查询结果。确认远程不会再运行后，用 --abandon {deployId} 解除。',
    'deploy.error.ciQueryFailed': '无法查询 CI 运行 {runId} 的状态。',
    'deploy.error.abandonRecordFailed': '放弃环境 {environment} 的部署 {deployId} 时记录写入失败：{reason}。未决记录保留。',
    'deploy.failure.ciConclusion': 'CI 运行结论为 {conclusion}',
    'deploy.failure.ciObserveTimeout': 'CI 运行 {runId} 未在 timeout_sec {sec} 内结束',
    'deploy.failure.ciRunIdMissing': 'dispatch 响应缺少运行身份',
    'deploy.warning.refUnconfirmed': '实际部署版本未确认：请求 {requested}，回报 {reported}。ref 记为 null。',
    'deploy.text.reconciled': '✓ 已补记 {environment} 的部署 {deployId}',
    'deploy.text.stillRunning': '… {environment} 的部署 {deployId} 仍在运行，环境保持占用',
    'deploy.text.abandoned': '✓ 已放弃 {environment} 的未决部署 {deployId}',
    'deploy.text.planWorkflow': '将调度：{workflow} @ {ref}',
    'deploy.text.run': '运行：{runId} {url}',
    'deploy.error.pendingNotAgent': '环境 {environment} 的未决部署方式为 {mode}，只有 agent 方式的未决部署可以用 --complete 完成。',
    'deploy.error.pendingChanged': '环境 {environment} 的未决部署 {deployId} 在此期间已被完成、放弃或替换，未写入任何内容。',
    'deploy.error.dryRunCmdVerify': '提案的 verify 判据是 cmd 命令，dry-run 不执行命令，无法在只读约束下确认 verify。请去掉 --dry-run 直接部署，或先用 openlogos verify 记录验收结果。',
    'deploy.failure.agentReported': '执行者报告部署失败',
    'deploy.text.awaitingAgent': '… 已登记 {environment} 的部署 {deployId}，等待执行者按方案部署；环境已被占用',
    'deploy.text.planAgent': '部署方案：{path}（章节：{section}）',
    'deploy.text.completeHint': '完成后执行 openlogos deploy --env {environment} --complete {deployId} --result done|failed（或 --abandon {deployId} 放弃）。',
    'env.issue.DEPLOY_CI_UNAVAILABLE': '环境 {environment} 通过 GitHub Actions 部署，但 gh 不可用：{reason}。',
    'smoke.env.markerInvalid': 'DEPLOY_DONE 内容不合法（{problems}）。请确认真实部署的环境与版本后重新执行 `openlogos deploy-done --env <id> [--ref <revision>]`。',
    'smoke.env.markerUnreadable': '无法读取 DEPLOY_DONE（{reason}）；读取失败不能证明它是旧版空 marker。请修复该文件，必要时重新执行 `openlogos deploy-done --env <id> [--ref <revision>]`。',
    'smoke.ledger.appendFailed': '向部署账本追加 smoke 记录失败（{reason}）；SMOKE_PASS / SMOKE_FAIL 未被改动。本次门禁结论：{gate}；本次已写出的 smoke-report.md 保留。请排除原因后重新执行 smoke。',
    'smoke.ledger.markerFailed': 'smoke 记录已追加到部署账本，但更新 smoke 标记失败（{reason}）；{rollback}本次门禁结论：{gate}；本次已写出的 smoke-report.md 保留。',
    'smoke.ledger.rollbackComplete': 'SMOKE_PASS / SMOKE_FAIL 已恢复到执行前状态，本次账本记录已撤销。',
    'smoke.ledger.rollbackIncomplete': '恢复未完成，请人工检查：{problems}。',
    'smoke.env.evidence': '环境证据：{evidence} · 版本：{ref} · {verified}',
    'smoke.env.refUnknown': '未知',
    'smoke.env.verified': '已验证',
    'smoke.env.notVerified': '未验证',
    // env（environment-registry，S41）
    'env.usage': '用法：openlogos env <list | show <id|别名> | check [<id|别名>] [--probe]> [--format json]',
    'env.error.projectNotInitialized': '未找到 logos/logos.config.json。',
    'env.error.registryNotFound': '未找到环境登记表 {path}，本项目未启用环境管理。',
    'env.error.registryInvalid': '环境登记表 {path} 不合法：{reason}。运行 `openlogos env check` 查看详情。',
    'env.error.unknown': '未登记的环境「{input}」。可用：{available}。',
    'env.error.argRequired': '缺少环境 id 或别名。可用：{available}。',
    'env.list.title': '环境（{path}）',
    'env.list.absent': '没有环境登记表（{path}），本项目未启用环境管理。',
    'env.list.empty': '登记表中没有定义任何环境。',
    'env.view.aliases': '别名：{aliases}',
    'env.view.proposalDefault': '  （提案默认）',
    'env.view.currentRef': '当前版本：{ref}',
    'env.view.unknownRef': '未知',
    'env.view.lastDeploy': '最近部署：{time}（{slug}）',
    'env.view.lastSmoke': '最近 smoke：{result}{verified}，{time}',
    'env.view.verified': '（已验证）',
    'env.view.previousRef': '上一版本（回滚目标）：{ref}',
    'env.view.inProgress': '部署进行中：{id}（{mode}）',
    'env.view.promotion': '晋级上游：{from}（候选版本：{ref}）',
    'env.view.approvalRequired': '部署需要审批；未使用的审批 {count} 份',
    'env.view.approvalNotRequired': '部署不需要审批；未使用的审批 {count} 份',
    'env.view.openApproval': '审批 {id}：版本 {ref}，{approver}，{time}',
    'env.view.notVerified': '（未验证）',
    'env.view.never': '无',
    'env.show.history': '历史（新到旧，最多 {limit} 条）：',
    'env.ledger.corrupt': '账本 {path}：已跳过 {count} 条非法记录。',
    'env.check.title': '环境登记表检查（{path}）',
    'env.check.ok': '未发现问题。',
    'env.check.problems': '发现 {count} 个问题。',
    'env.check.secret': '密钥 {name}（{environment}）：{state}',
    'env.check.secretSet': '已设置',
    'env.check.secretMissing': '缺失',
    'env.check.probe': '{kind} {url}：{state}',
    'env.issue.ENV_REGISTRY_INVALID': '环境登记表不合法：{reason}。',
    'env.issue.ENV_FIELD_INVALID': '环境 {environment}：字段 {field} 不合法（{reason}）。',
    'env.issue.ENV_FIELD_INVALID_TOP': '登记表顶层字段 {field} 不合法（{reason}）。',
    'env.issue.ENV_DUPLICATE_ID_OR_ALIAS': '环境 {environment}：{field} 的值「{value}」不唯一（{reason}）。',
    'env.issue.ENV_UNKNOWN_FIELD': '未知字段 {field}{where}（已忽略）。',
    'env.issue.ENV_GATE_REFERENCE_UNKNOWN': 'deployment_gates.{module}.environments 引用了未登记的环境「{value}」。',
    'env.issue.ENV_SECRET_MISSING': '环境 {environment}：当前进程环境中未设置变量 {name}。',
    'env.issue.ENV_PROBE_FAILED': '环境 {environment}：{kind} 探测 {url} 失败（{detail}）。',
    'smoke.gate.notRequired': '活跃提案 \'{slug}\' 不需要 smoke。验收通过后可直接运行 `openlogos archive {slug}`。',
    'smoke.gate.decisionConflict': '部署决策冲突。{reason} 请先修正 proposal.md / tasks.md 中的部署决策。',
    'smoke.gate.deployNotDone': '缺少 DEPLOY_DONE 标记。请先完成部署，再运行 `openlogos deploy-done`，然后执行 smoke。',
    'smoke.gate.deployTasksIncomplete': 'tasks.md 的 [deploy] section 仍有未勾选条目。请补齐 [deploy] 任务后运行 `openlogos deploy-done`。',
    'archive.gate.verifyNotPassed': '验收尚未通过。归档前请运行 `openlogos verify`，并解决任何 VERIFY_FAIL 标记。',
    'archive.gate.deployNotDone': '当前提案需要部署，但缺少 DEPLOY_DONE 标记。请在部署完成后运行 `openlogos deploy-done`。SMOKE_PASS 在场也不能反推部署已完成。',
    'archive.gate.smokeNotPassed': '当前提案需要 smoke，但缺少 SMOKE_PASS 标记（或存在 SMOKE_FAIL）。归档前请运行 `openlogos smoke`。',
    'next.stateInconsistencyHint': '检测到矛盾事实（{evidence}）但 DEPLOY_DONE 缺失——请运行 `{remediation}` 完成对账。',

    // change
    'change.creating': '创建变更提案：{slug}',
    'change.done': '变更提案已创建。下一步：',
    'change.step1': '  1. 对 AI 说：「帮我填写变更提案 {slug}」',
    'change.step2': '  2. AI 将分析影响范围并填写 proposal.md + tasks.md',
    'change.step3': '  3. 然后按 tasks.md 逐项产出 delta 文件到 deltas/',
    'change.step4': '  4. 完成后明确授权执行 `openlogos merge {slug}` 生成合并指令',
    'change.guardConflict': 'Error: 当前活动变更提案 \'{activeChange}\' 尚未完成。',
    'change.guardConflictHint': '请先完成该提案，并明确授权执行 `openlogos archive {activeChange}` 后再创建新提案。',
    'change.guardInvalid': 'Error: logos/.openlogos-guard 内容无效。',
    'change.guardInvalidHint': '请先修复或删除 guard 文件，再创建新提案。',
    'change.moduleAuto': '归属模块：{module}（自动挂靠，当前只有一个模块）',
    'change.moduleDefault': '归属模块：{module}（默认挂靠 core，可用 --module <id> 指定其他模块）',
    'change.moduleAssigned': '归属模块：{module}',
    'change.moduleNotFound': 'Error: 模块 \'{module}\' 在 logos-project.yaml 中不存在。',
    'change.moduleNotFoundAvailable': '可用模块：{modules}',
    'change.moduleNotFoundHint': '运行 `openlogos module list` 查看可用模块。',
    'change.moduleNoCore': 'Error: 当前项目包含多个模块且未配置 core，无法推断变更归属。',
    'change.moduleNoCoreRetryHeader': '请任选一个模块重试：',

    // merge
    'merge.summary': '合并摘要：',
    'merge.proposal': '  - 变更提案：{slug}',
    'merge.deltaCount': '  - Delta 文件：{count} 个',
    'merge.aiHint': '对 AI 说：「读取 logos/changes/{slug}/MERGE_PROMPT.md 并执行合并」',
    'merge.noDelta': 'logos/changes/{slug}/deltas/ 中没有 delta 文件，已写入 no-delta spec-complete 标记。',
    'merge.conservationRejected': 'Error: delta 条目守恒检查未通过（S37）：{path}——拒绝生成 MERGE_PROMPT，未写任何 marker。',
    'merge.conservationHint': '  修复方式：把缺失 ID 的条目补回同锚 MODIFIED 块的结构位置（携带整节全量内容），或新增同锚 REMOVED-ITEMS 块逐行点名（`- <ID> — <删除原因>`）；锚歧义时改用标题路径锚（父级标题 > 目标标题）。可先运行 `openlogos change-lint` 在产出点定位全部违规。',
    'merge.alreadyMerged': '提案 \'{slug}\' 的规格已合并（SPEC_MERGED 存在），无需重复操作。',
    'merge.archiveHint': '规格已合并并写入 SPEC_MERGED。下一步实现代码、运行 `openlogos verify`，验收通过后明确授权执行 `openlogos archive {slug}`。如需重新合并：`git checkout logos/resources/` 回到合并前，修正 delta 后重跑 `openlogos merge`。',

    // launch
    'launch.done': '✓ 模块 "{module}" 已 launch！变更管理已激活。',
    'launch.hint1': '  从现在起，修改已有文档必须先创建变更提案。',
    'launch.hint2': '  运行 `openlogos change <slug>` 创建新的变更提案。',
    'launch.rulesUpdated': 'AI 规则已更新到 {target}',
    'launch.moduleAlreadyLaunched': '模块 "{module}" 已处于 launched 状态，无需重复操作。',
    'launch.multiModuleError': '存在多个模块（{modules}），请明确指定：`openlogos launch <module-id>`',
    'launch.moduleNotFound': '模块 "{module}" 在 logos-project.yaml 中不存在。',
    'launch.migrationAuto': '已迁移：模块 "{module}" 自动标记为 launched（原 config.lifecycle: active）。',
    'launch.migrationWarn': '警告：config.lifecycle 为 "active" 但没有模块标记为 launched，请运行 `openlogos launch <module-id>` 完成迁移。',
    'launch.suggest': '运行 `openlogos launch` 激活变更管理，开始迭代开发。',
    'launch.verifyRequired': '模块 "{module}" 尚不能 launch：必须先通过 `openlogos verify` 并写入 logos/resources/verify/acceptance-report.md。',
    'launch.deployRequired': '模块 "{module}" 需要先完成部署才能 launch。请先完成部署并写入 logos/resources/verify/deployment-report.md。',
    'launch.smokeRequired': '模块 "{module}" 需要先完成部署冒烟测试才能 launch。请明确授权执行 `openlogos smoke` 并写入 logos/resources/verify/smoke-report.md。',

    // next
    'next.title': '下一步',
    'next.nextNode': '下一节点',
    'flow.rawBuiltin': '内置模板 @{version}',
    'flow.resolvedApplied': 'resolved · 已应用项目 overlay',
    'flow.resolvedNoOverlay': 'resolved · 无项目 overlay',
    'flow.notSkippable': '不可跳过',
    'flow.resolvedHint': '提示：使用 --resolved 查看应用项目 overlay 后的生效流程。',
    'next.createChange': '修改代码前必须先创建变更提案',
    'next.createChangeDetail': '运行 `openlogos change <slug>` 创建变更提案并激活 guard。',
    'next.fillProposal': '填写活跃变更的 proposal.md 和 tasks.md',
    'next.fillProposalDetail': '对 AI 说：「帮我填写变更提案 {slug}」— AI 将分析影响范围并完善提案。',
    'next.writeDeltas': '撰写 delta 文档',
    'next.writeDeltasDetail': '对 AI 说：「继续为 {slug} 产出 delta 文件」— 所有变更都写入 logos/changes/{slug}/deltas/，delta 任务全部勾选后再明确授权执行 `openlogos merge {slug}`。',
    'next.approvePlan': '批准方案（proposal/tasks 与 [code] 切片划分）',
    'next.approvePlanDetail': '在 plan 门 review 并批准 proposal.md + tasks.md（含 [code] 切片划分）；--auto 模式下 plan-exit 门自动放行（留审计）。批准后为 {slug} 产出 delta 文件。',
    'next.startCoding': '按 tasks.md 开始编码实现',
    'next.startCodingDetail': '对 AI 说：「执行 logos/changes/{slug}/tasks.md 中的任务」— 实现代码并编写测试，完成后勾选 [code] section 所有任务。',
    'next.planSlices': '规划 [code] 切片（slice-planner）',
    'next.planSlicesDetail': '对 AI 说：为 {slug} 运行 slice-planner — 对已合并规格 + 真实测试 ID 划分 [code] 切片（六维打分 + 垂直/横向判别器 + 删后续证伪门），然后在 slice-exit 门确认。',
    'next.replanHint': ' 如需重新划分切片：openlogos slice transaction reopen --reason "<原因>"。',
    'next.runVerify': '运行验收测试',
    'next.runVerifyDetail': '明确授权执行 `openlogos verify` 运行验收测试。',
    'next.archive': '归档提案',
    'next.archiveDetail': '明确授权执行 `openlogos archive {slug}` 归档本次变更。',
    'next.authorizeDeploy': '授权执行部署',
    'next.authorizeDeployDetail': '部署是人类确认点。确认后，请明确要求 AI 基于合并后的部署方案执行 {slug} 的部署任务。',
    'next.runSmoke': '运行部署冒烟测试',
    'next.runSmokeDetail': '部署完成后明确授权执行 `openlogos smoke`。',
    'next.fixAndSmoke': '修复冒烟问题并重新运行',
    'next.fixAndSmokeDetail': '修复部署环境或 smoke 检查问题后，再明确授权执行 `openlogos smoke`。',
    'next.fixAndVerify': '修复问题并重新验收',
    'next.fixAndVerifyDetail': '修复失败的测试用例，然后明确授权重新执行 `openlogos verify`。',
    'next.continueImpl': '继续实现并运行测试',
    'next.continueImplDetail': '所有任务完成后，明确授权执行 `openlogos merge {slug}` 生成合并指令。',
    'next.merge': '生成合并指令',
    'next.mergeDetail': '明确授权执行 `openlogos merge {slug}`，生成 MERGE_PROMPT.md。',
    'next.executeMerge': '执行规格合并',
    'next.executeMergeDetail': '让 AI 读取 logos/changes/{slug}/MERGE_PROMPT.md，将 delta 合入 logos/resources，提交规格文档后写入 logos/changes/{slug}/SPEC_MERGED。',
    'next.specCompleteRequired': '完成 no-delta 规格阶段标记',
    'next.specCompleteRequiredDetail': '明确授权执行 `openlogos merge {slug}` 写入 no-delta SPEC_MERGED 后，再进入 [code] 切片规划。',
    'next.testIdRequired': '补充真实测试 ID',
    'next.testIdRequiredDetail': '先为 {slug} 补充或显式复用真实 UT/ST/SMOKE ID；测试 ID 稳定前不得进入 `plan-slices`。',
    'next.launch': '激活变更管理，开始迭代开发',
    'next.phaseDetail': '当前阶段：{phase}',

    // archive
    'archive.done': '✓ 变更提案 \'{slug}\' 已归档。',
    'archive.path': '  logos/changes/{slug}/ → logos/changes/archive/{slug}/',
    'archive.watch.failed': '错误 [{code}]：归档 watcher 握手失败（{reason}）。',
    'archive.watch.details': '  实例：{details}',
    'archive.watch.incompatible': '检测到无法协调该协议的 RunLogos 实例；请升级 openlogos CLI 或关闭该实例后重试。',
    'archive.watch.legacyBusy': '错误：Windows 无法移动提案目录，可能有旧版 RunLogos 或其他程序仍在监听；请升级或关闭应用后重试。',
    'archive.watch.reconciled': '  归档操作报错后已依据磁盘状态调和为成功。',

    // impact (S36)
    'impact.header': 'impact: lifecycle_only = {value}',
    'impact.filesHeader': '文件（{count}）：',
    'impact.nonLifecycleHeader': '非 lifecycle 路径（{count}）：',
    'impact.operationsLine': '推断操作：{ops}',
    'impact.changesLine': '涉及提案：{changes}',
    'impact.reasonsHeader': '原因：',
    'impact.footerTrue': '结论：全部变更为生命周期簿记（可跳过制品构建）。CI 只应读取 lifecycle_only 字段。',
    'impact.footerFalse': '结论：非纯生命周期变更（fail-closed）。CI 只应读取 lifecycle_only 字段。',
  },
};

export function t(locale: Locale, key: string, vars?: Record<string, string>): string {
  let msg = messages[locale]?.[key] ?? messages['en'][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replaceAll(`{${k}}`, v);
    }
  }
  return msg;
}

// Phase label key mapping (used by status.ts)
export const PHASE_KEYS = [
  'phase.1', 'phase.2', 'phase.3-0', 'phase.3-1',
  'phase.3-2-api', 'phase.3-2-db', 'phase.3-3-deployment',
  'phase.3-4a', 'phase.3-4b', 'phase.3-5', 'phase.3-6',
  'phase.3-7-deploy', 'phase.3-8-smoke',
] as const;

export const SUGGEST_KEYS: Record<string, string> = {
  'phase.1': 'suggest.phase1',
  'phase.2': 'suggest.phase2',
  'phase.3-0': 'suggest.phase3-0',
  'phase.3-1': 'suggest.phase3-1',
  'phase.3-2-api': 'suggest.phase3-2-api',
  'phase.3-2-db': 'suggest.phase3-2-db',
  'phase.3-3-deployment': 'suggest.phase3-3-deployment',
  'phase.3-4a': 'suggest.phase3-4a',
  'phase.3-4b': 'suggest.phase3-4b',
  'phase.3-5': 'suggest.phase3-5',
  'phase.3-6': 'suggest.phase3-6',
  'phase.3-7-deploy': 'suggest.phase3-7-deploy',
  'phase.3-8-smoke': 'suggest.phase3-8-smoke',
};

// --- Long-form templates ---

export function proposalTemplate(locale: Locale, slug: string, module?: string): string {
  const createdAt = new Date().toISOString().slice(0, 10);
  const meta = module ? `\n> module: ${module} | created: ${createdAt}\n` : '';
  if (locale === 'zh') {
    return `# 变更提案：${slug}
${meta}
## 变更原因
[为什么要做这个变更？来源于哪个需求/反馈/Bug？]

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：[查了哪些既有能力/判据/通道？逐项写明为什么不够用，或如何复用]
- 为什么不能更小：[能不能只做其中一半？能不能不新建机制？逐条说明为何不行]
- 本提案主动砍掉的：[列出考虑过但决定不做的设计，各附一句理由]

## 变更类型
[需求级 / 设计级 / 接口级 / 代码级]

## 变更范围
- 影响的需求文档：[列表]
- 影响的功能规格：[列表]
- 影响的业务场景：[列表]
- 影响的 API：[列表]
- 影响的 DB 表：[列表]
- 影响的编排测试：[列表]

## 部署影响
- 是否需要部署：是 / 否
- 部署原因：[说明为什么需要或不需要部署]
- 影响环境：[本地 / 测试 / 预发 / 生产 / 无]
- 是否涉及数据迁移：是 / 否
- 是否需要回滚预案：是 / 否
- 是否需要 smoke：是 / 否

## UI/UX 变更声明

\`\`\`yaml
ui_impact: false            # 本次是否触及界面（GUI 项目才有意义）
design_system_mode: generated   # generated | fallback（fallback 时须填 design_system_fallback_reason）
design_system_fallback_reason: ""
pages: []                   # 每项 {id, prototype: core-NN-<slug>.html, description}
\`\`\`

## 决策澄清

\`\`\`yaml
schema: openlogos/clarification@1
mode: adaptive
status: pending
impacts:
  data:
    status: none
    reason: 待 change-writer 按仓库事实确认本次无数据高影响选择
  compatibility:
    status: none
    reason: 待 change-writer 按仓库事实确认本次无兼容高影响选择
  security_privacy:
    status: none
    reason: 待 change-writer 按仓库事实确认本次无安全隐私高影响选择
  public_release:
    status: none
    reason: 待 change-writer 按仓库事实确认本次无公开发布高影响选择
  external_commitment:
    status: none
    reason: 待 change-writer 按仓库事实确认本次无外部承诺高影响选择
decisions: []
unresolved: []
defaults: []
\`\`\`

## 变更概述
[用 1-3 段话概述具体改什么]
`;
  }
  return `# Change Proposal: ${slug}
${meta}
## Reason
[Why is this change needed? Which requirement/feedback/bug triggered it?]

## Minimal Implementation Rationale

> S35/S09: this section is **not** a canonical required section — a missing, empty, or
> placeholder-only section triggers no check. It is a self-discipline prompt that acts
> *before* the design happens; the after-the-fact scale signal is the change-lint warning.

- Existing mechanisms searched: [which existing capabilities/criteria/channels did you check? say why each is insufficient, or how you reuse it]
- Why it cannot be smaller: [could you ship only half? could you avoid building anything new? address each]
- Deliberately cut from this proposal: [designs you considered and decided against, one reason each]

## Change Type
[Requirements / Design / Interface / Code]

## Scope
- Affected requirements: [list]
- Affected feature specs: [list]
- Affected scenarios: [list]
- Affected APIs: [list]
- Affected DB tables: [list]
- Affected orchestration tests: [list]

## Deployment Impact
- Deployment required: yes / no
- Deployment reason: [Explain why deployment is or is not required]
- Affected environments: [local / test / staging / production / none]
- Data migration involved: yes / no
- Rollback plan required: yes / no
- Smoke required: yes / no

## UI/UX Change Declaration

\`\`\`yaml
ui_impact: false            # Does this change touch the UI (only meaningful for GUI projects)
design_system_mode: generated   # generated | fallback (fallback requires design_system_fallback_reason)
design_system_fallback_reason: ""
pages: []                   # each item {id, prototype: core-NN-<slug>.html, description}
\`\`\`

## Decision Clarification

\`\`\`yaml
schema: openlogos/clarification@1
mode: adaptive
status: pending
impacts:
  data:
    status: none
    reason: change-writer must confirm from repository facts that no high-impact data choice is pending
  compatibility:
    status: none
    reason: change-writer must confirm from repository facts that no high-impact compatibility choice is pending
  security_privacy:
    status: none
    reason: change-writer must confirm from repository facts that no high-impact security or privacy choice is pending
  public_release:
    status: none
    reason: change-writer must confirm from repository facts that no public release choice is pending
  external_commitment:
    status: none
    reason: change-writer must confirm from repository facts that no external commitment choice is pending
decisions: []
unresolved: []
defaults: []
\`\`\`

## Summary
[Describe what will change in 1-3 paragraphs]
`;
}

export function tasksTemplate(locale: Locale, launched = false): string {
  if (locale === 'zh') {
    return `# 实现任务

## [delta] 规格变更
- [ ] 更新需求文档的场景和验收条件
- [ ] 更新产品设计文档的功能规格

## [code] 代码实现
${launched ? '' : '- [ ] 实现代码变更'}
`;
  }
  return `# Implementation Tasks

## [delta] Spec Changes
- [ ] Update requirements scenarios and acceptance criteria
- [ ] Update product design feature specs

## [code] Code Implementation
${launched ? '' : '- [ ] Implement code changes'}
`;
}

export function mergePromptTemplate(
  locale: Locale,
  slug: string,
  proposalContent: string,
  deltas: Array<{ relativePath: string; deltaFullPath: string; targetDir: string }>,
): string {
  if (locale === 'zh') {
    let prompt = `# 合并指令

## 变更提案
- 提案名称：${slug}
- 提案目录：logos/changes/${slug}/

## 提案内容

${proposalContent}

## 需要合并的 Delta 文件

`;
    for (let i = 0; i < deltas.length; i++) {
      const d = deltas[i];
      prompt += `### ${i + 1}. ${d.relativePath}

- Delta 文件：\`${d.deltaFullPath}\`
- 目标目录：\`${d.targetDir}/\`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

`;
    }
    prompt += `## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(${slug}): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 \`openlogos verify\` 验收，验收通过后明确授权执行 \`openlogos archive ${slug}\`。
`;
    return prompt;
  }

  let prompt = `# Merge Instruction

## Change Proposal
- Proposal: ${slug}
- Directory: logos/changes/${slug}/

## Proposal Content

${proposalContent}

## Delta Files to Merge

`;
  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i];
    prompt += `### ${i + 1}. ${d.relativePath}

- Delta file: \`${d.deltaFullPath}\`
- Target directory: \`${d.targetDir}/\`
- Action: Read ADDED / MODIFIED / REMOVED markers in the delta and merge into the corresponding main document in the target directory

`;
  }
  prompt += `## Execution Requirements

1. Process each delta file one by one, report a summary after each
2. For ADDED markers: insert new content at the specified location in the main document
3. For MODIFIED markers: replace the content of the same-named section in the main document
4. For REMOVED markers: delete the corresponding section from the main document
5. Preserve the original formatting and style of the main document
6. If the main document has a "last updated" timestamp, update it
7. After all changes are complete, list the modification summary
8. After all changes are merged, automatically run git commit (inform user, no confirmation needed):
   git add -A && git commit -m "docs(${slug}): merge spec deltas"
   Then prompt the user: implement code per the updated specs, run \`openlogos verify\` after code is complete, and explicitly authorize \`openlogos archive ${slug}\` after verification passes.
`;
  return prompt;
}

export function conventionsForYaml(locale: Locale): string {
  if (locale === 'zh') {
    return `conventions:
  - "遵循 OpenLogos 三层推进模型（Why → What → How）"
  - "每次变更必须先创建 logos/changes/ 变更提案"`;
  }
  return `conventions:
  - "Follow the OpenLogos three-layer progression (Why → What → How)"
  - "Every change must start with a logos/changes/ change proposal"`;
}

export function conventionsForAgentsMd(locale: Locale): string {
  if (locale === 'zh') {
    return `- 遵循 OpenLogos 三层推进模型（Why → What → How）
- 每次变更必须先创建 logos/changes/ 变更提案`;
  }
  return `- Follow the OpenLogos three-layer progression (Why → What → How)
- Every change must start with a logos/changes/ change proposal`;
}
