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
    'sync.indexAdded': '{count} new file(s) added to logos-project.yaml resource_index',
    'sync.indexNoop': 'logos-project.yaml resource_index is already up to date',

    // status
    'phase.1': 'Phase 1 · Requirements (WHY)',
    'phase.2': 'Phase 2 · Product Design (WHAT)',
    'phase.3-0': 'Phase 3-0 · Architecture',
    'phase.3-1': 'Phase 3-1 · Scenario Modeling',
    'phase.3-2-api': 'Phase 3-2 · API Design',
    'phase.3-2-db': 'Phase 3-2 · Database Design',
    'phase.3-3a': 'Phase 3-3a · Test Case Design (Unit + Scenario)',
    'phase.3-3b': 'Phase 3-3b · API Orchestration Tests',
    'phase.3-4': 'Phase 3-4 · Code Implementation',
    'phase.3-5': 'Phase 3-5 · Test Acceptance (verify)',
    'status.modules': 'Modules',
    'status.activeProposals': 'Active Change Proposals',
    'status.activeChange': 'Active Change',
    'status.proposalStepLabel': 'Step',
    'status.proposalStep.writing': 'writing — fill in proposal.md and tasks.md',
    'status.proposalStep.implementing': 'implementing — start coding per tasks.md',
    'status.proposalStep.in-progress': 'in progress — continue implementation, then merge',
    'status.proposalStep.ready-to-merge': 'ready to merge — explicitly request `openlogos merge` to proceed',
    'status.allDone': 'All phases complete! Run `openlogos verify` to check test acceptance.',
    'status.allDoneHint': '   → Or run `openlogos launch` to start iteration development',
    'status.suggestNext': 'Suggested next step: {label}',
    'suggest.phase1': 'Tell AI: "Help me write requirements"',
    'suggest.phase2': 'Tell AI: "Do product design based on requirements"',
    'suggest.phase3-0': 'Tell AI: "Help me design the technical architecture"',
    'suggest.phase3-1': 'Tell AI: "Help me draw S01 sequence diagram"',
    'suggest.phase3-2-api': 'Tell AI: "Help me design the API"',
    'suggest.phase3-2-db': 'Tell AI: "Help me design the database"',
    'suggest.phase3-3a': 'Tell AI: "Help me design test cases"',
    'suggest.phase3-3b': 'Tell AI: "Help me design orchestration tests"',
    'suggest.phase3-4': 'Tell AI: "Execute Phase 3 Step 4 — implement business code and tests"',
    'suggest.phase3-5': 'Run your tests, then run `openlogos verify`',
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
    'verify.gatePass': 'Gate 3.5: PASS',
    'verify.gateFail': 'Gate 3.5: FAIL',
    'verify.gateFailCoverage': 'Gate 3.5: FAIL (incomplete coverage)',
    'verify.failedCases': 'Failed cases:',
    'verify.uncoveredCases': 'Uncovered cases ({count}):',
    'verify.reportPath': 'Report: {path}',
    'verify.noResults': 'No test results found at {path}.\nRun your tests first, then try again.',
    'verify.noCases': 'No test case specs found in logos/resources/test/.\nRun test design (Step 3a) first.',
    'verify.checklistTitle': 'Design-time Coverage (Layer 1)',
    'verify.checklistSummary': 'Checklist: {checked}/{total} assertions confirmed',
    'verify.checklistUnchecked': 'Unchecked assertions ({count}):',
    'verify.gateFailChecklist': 'Gate 3.5: FAIL (design-time checklist incomplete)',
    'verify.acTitle': 'Acceptance Criteria Traceability (Layer 3)',
    'verify.acSummary': 'AC traceability: {passed}/{total} criteria passed',
    'verify.acFailed': 'Failing criteria ({count}):',
    'verify.gateFailAc': 'Gate 3.5: FAIL (acceptance criteria not fully traced)',

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
    'change.moduleNotFoundHint': 'Run `openlogos module list` to see available modules.',

    // merge
    'merge.summary': 'Merge Summary:',
    'merge.proposal': '  - Change proposal: {slug}',
    'merge.deltaCount': '  - Delta files: {count}',
    'merge.aiHint': 'Tell AI: "Read logos/changes/{slug}/MERGE_PROMPT.md and execute merge"',
    'merge.archiveHint': 'After merge, implement code per updated specs, then run `openlogos verify`. After verification passes, explicitly request `openlogos archive {slug}`.',

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

    // next
    'next.title': 'Next Step',
    'next.createChange': 'Create a change proposal before modifying any code',
    'next.createChangeDetail': 'Run `openlogos change <slug>` to create a new change proposal and activate the guard.',
    'next.fillProposal': 'Fill in proposal.md and tasks.md for the active change',
    'next.fillProposalDetail': 'Tell AI: "Help me fill in change proposal {slug}" — AI will analyze impact and complete the proposal.',
    'next.startCoding': 'Start implementing per tasks.md',
    'next.startCodingDetail': 'Tell AI: "Execute tasks in logos/changes/{slug}/tasks.md" — implement code and write tests.',
    'next.continueImpl': 'Continue implementation and run tests',
    'next.continueImplDetail': 'When all tasks are done, explicitly request `openlogos merge {slug}` to generate merge instructions.',
    'next.merge': 'Merge and archive the change proposal',
    'next.mergeDetail': 'Explicitly request `openlogos merge {slug}`, implement code per updated specs, run `openlogos verify`, then explicitly request `openlogos archive {slug}`.',
    'next.launch': 'Activate change management for future iterations',
    'next.phaseDetail': 'Current phase: {phase}',

    // archive
    'archive.done': '✓ Change proposal \'{slug}\' archived.',
    'archive.path': '  logos/changes/{slug}/ → logos/changes/archive/{slug}/',
  },
  zh: {
    // init
    'init.creating': 'Creating OpenLogos project structure for "{name}"{source}...',
    'init.done': '项目初始化完成。下一步：',
    'init.step1': '  1. 检查 logos/logos.config.json 确认项目配置',
    'init.nameTip': '  提示：项目名 "{name}" 是自动探测的{source}。\n       如需修改，编辑 logos/logos.config.json 后运行 `openlogos sync`。',
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
    'sync.indexAdded': '{count} 个新文件已补录到 logos-project.yaml resource_index',
    'sync.indexNoop': 'logos-project.yaml resource_index 已是最新，无需补录',

    // status
    'phase.1': 'Phase 1 · 需求文档 (WHY)',
    'phase.2': 'Phase 2 · 产品设计 (WHAT)',
    'phase.3-0': 'Phase 3-0 · 技术架构',
    'phase.3-1': 'Phase 3-1 · 场景建模',
    'phase.3-2-api': 'Phase 3-2 · API 设计',
    'phase.3-2-db': 'Phase 3-2 · 数据库设计',
    'phase.3-3a': 'Phase 3-3a · 测试用例设计（单元 + 场景）',
    'phase.3-3b': 'Phase 3-3b · API 编排测试',
    'phase.3-4': 'Phase 3-4 · 代码实现',
    'phase.3-5': 'Phase 3-5 · 测试验收（verify）',
    'status.modules': '模块',
    'status.activeProposals': '活跃变更提案',
    'status.activeChange': '活跃变更',
    'status.proposalStepLabel': '当前步骤',
    'status.proposalStep.writing': '填写提案 — 请完善 proposal.md 和 tasks.md',
    'status.proposalStep.implementing': '待实现 — 按 tasks.md 开始编码',
    'status.proposalStep.in-progress': '实现中 — 继续完成实现，完成后明确授权执行 merge',
    'status.proposalStep.ready-to-merge': '可合并 — 明确授权执行 merge，再明确授权执行归档',
    'status.allDone': '所有阶段已完成！运行 `openlogos verify` 查看测试验收结果。',
    'status.allDoneHint': '   → 或运行 `openlogos launch` 开始迭代开发',
    'status.suggestNext': '建议下一步：{label}',
    'suggest.phase1': '对 AI 说：「帮我写需求文档」',
    'suggest.phase2': '对 AI 说：「基于需求文档做产品设计」',
    'suggest.phase3-0': '对 AI 说：「帮我设计技术架构」',
    'suggest.phase3-1': '对 AI 说：「帮我画 S01 的时序图」',
    'suggest.phase3-2-api': '对 AI 说：「帮我设计 API」',
    'suggest.phase3-2-db': '对 AI 说：「帮我设计数据库」',
    'suggest.phase3-3a': '对 AI 说：「帮我设计测试用例」',
    'suggest.phase3-3b': '对 AI 说：「帮我设计编排测试」',
    'suggest.phase3-4': '对 AI 说：「请按 Phase 3 Step 4 执行代码实现」',
    'suggest.phase3-5': '运行测试后执行 `openlogos verify`',
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
    'verify.gatePass': 'Gate 3.5：PASS',
    'verify.gateFail': 'Gate 3.5：FAIL',
    'verify.gateFailCoverage': 'Gate 3.5：FAIL（覆盖不完整）',
    'verify.failedCases': '失败用例：',
    'verify.uncoveredCases': '未覆盖用例（{count}）：',
    'verify.reportPath': '报告：{path}',
    'verify.noResults': '未找到测试结果文件：{path}\n请先运行测试，再重试。',
    'verify.noCases': '未找到测试用例规格文件（logos/resources/test/）。\n请先完成测试设计（Step 3a）。',
    'verify.checklistTitle': '设计时覆盖度（Layer 1）',
    'verify.checklistSummary': '覆盖度校验：{checked}/{total} 项确认',
    'verify.checklistUnchecked': '未确认项（{count}）：',
    'verify.gateFailChecklist': 'Gate 3.5：FAIL（设计时覆盖度校验未通过）',
    'verify.acTitle': '验收条件追溯（Layer 3）',
    'verify.acSummary': '验收追溯：{passed}/{total} 个验收条件通过',
    'verify.acFailed': '未通过的验收条件（{count}）：',
    'verify.gateFailAc': 'Gate 3.5：FAIL（验收条件追溯未完全通过）',

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
    'change.moduleNotFoundHint': '运行 `openlogos module list` 查看可用模块。',

    // merge
    'merge.summary': '合并摘要：',
    'merge.proposal': '  - 变更提案：{slug}',
    'merge.deltaCount': '  - Delta 文件：{count} 个',
    'merge.aiHint': '对 AI 说：「读取 logos/changes/{slug}/MERGE_PROMPT.md 并执行合并」',
    'merge.archiveHint': '合并完成后，按更新后的规格实现代码，再运行 `openlogos verify` 验收。验收通过后，明确授权执行 `openlogos archive {slug}` 归档提案。',

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

    // next
    'next.title': '下一步',
    'next.createChange': '修改代码前必须先创建变更提案',
    'next.createChangeDetail': '运行 `openlogos change <slug>` 创建变更提案并激活 guard。',
    'next.fillProposal': '填写活跃变更的 proposal.md 和 tasks.md',
    'next.fillProposalDetail': '对 AI 说：「帮我填写变更提案 {slug}」— AI 将分析影响范围并完善提案。',
    'next.startCoding': '按 tasks.md 开始编码实现',
    'next.startCodingDetail': '对 AI 说：「执行 logos/changes/{slug}/tasks.md 中的任务」— 实现代码并编写测试。',
    'next.continueImpl': '继续实现并运行测试',
    'next.continueImplDetail': '所有任务完成后，明确授权执行 `openlogos merge {slug}` 生成合并指令。',
    'next.merge': '合并并归档变更提案',
    'next.mergeDetail': '明确授权执行 `openlogos merge {slug}`，按更新后的规格实现代码，运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive {slug}`。',
    'next.launch': '激活变更管理，开始迭代开发',
    'next.phaseDetail': '当前阶段：{phase}',

    // archive
    'archive.done': '✓ 变更提案 \'{slug}\' 已归档。',
    'archive.path': '  logos/changes/{slug}/ → logos/changes/archive/{slug}/',
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
  'phase.3-2-api', 'phase.3-2-db', 'phase.3-3a', 'phase.3-3b',
  'phase.3-4', 'phase.3-5',
] as const;

export const SUGGEST_KEYS: Record<string, string> = {
  'phase.1': 'suggest.phase1',
  'phase.2': 'suggest.phase2',
  'phase.3-0': 'suggest.phase3-0',
  'phase.3-1': 'suggest.phase3-1',
  'phase.3-2-api': 'suggest.phase3-2-api',
  'phase.3-2-db': 'suggest.phase3-2-db',
  'phase.3-3a': 'suggest.phase3-3a',
  'phase.3-3b': 'suggest.phase3-3b',
  'phase.3-4': 'suggest.phase3-4',
  'phase.3-5': 'suggest.phase3-5',
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

## 变更类型
[需求级 / 设计级 / 接口级 / 代码级]

## 变更范围
- 影响的需求文档：[列表]
- 影响的功能规格：[列表]
- 影响的业务场景：[列表]
- 影响的 API：[列表]
- 影响的 DB 表：[列表]
- 影响的编排测试：[列表]

## 变更概述
[用 1-3 段话概述具体改什么]
`;
  }
  return `# Change Proposal: ${slug}
${meta}
## Reason
[Why is this change needed? Which requirement/feedback/bug triggered it?]

## Change Type
[Requirements / Design / Interface / Code]

## Scope
- Affected requirements: [list]
- Affected feature specs: [list]
- Affected scenarios: [list]
- Affected APIs: [list]
- Affected DB tables: [list]
- Affected orchestration tests: [list]

## Summary
[Describe what will change in 1-3 paragraphs]
`;
}

export function tasksTemplate(locale: Locale): string {
  if (locale === 'zh') {
    return `# 实现任务

## Phase 1: 文档变更
- [ ] 更新需求文档的场景和验收条件
- [ ] 更新产品设计文档的功能规格

## Phase 2: 设计变更
- [ ] 更新原型
- [ ] 更新场景时序图
- [ ] 更新 API YAML
- [ ] 更新 DB DDL

## Phase 3: 编排与代码
- [ ] 更新 API 编排测试用例
- [ ] 实现代码变更
`;
  }
  return `# Implementation Tasks

## Phase 1: Document Changes
- [ ] Update requirements scenarios and acceptance criteria
- [ ] Update product design feature specs

## Phase 2: Design Changes
- [ ] Update prototypes
- [ ] Update scenario sequence diagrams
- [ ] Update API YAML
- [ ] Update DB DDL

## Phase 3: Orchestration & Code
- [ ] Update API orchestration test cases
- [ ] Implement code changes
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
