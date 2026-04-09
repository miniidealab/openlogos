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
    'init.aiToolCursor': '  1. Cursor (default)',
    'init.aiToolClaudeCode': '  2. Claude Code',
    'init.aiToolOpenCode': '  3. OpenCode',
    'init.aiToolOther': '  4. Other',
    'init.aiToolPrompt': 'Your choice [1/2/3/4] (default: 1): ',
    'init.skillsDeployed': '{count} skills deployed to {target}',
    'init.skillsSynced': '{count} skills synced to {target}',
    'init.opencodePluginDeployed': 'OpenCode plugin deployed to {target}',
    'init.opencodePluginSynced': 'OpenCode plugin synced to {target}',
    'init.opencodeConfigCreated': 'opencode.json created with recommended permission defaults',
    'init.opencodeConfigUpdated': 'opencode.json merged with missing recommended permission defaults',
    'init.opencodeCommandsDeployed': 'OpenCode slash commands deployed to .opencode/commands/ ({count} files)',

    // status
    'phase.1': 'Phase 1 · Requirements (WHY)',
    'phase.2': 'Phase 2 · Product Design (WHAT)',
    'phase.3-0': 'Phase 3-0 · Architecture',
    'phase.3-1': 'Phase 3-1 · Scenario Modeling',
    'phase.3-2-api': 'Phase 3-2 · API Design',
    'phase.3-2-db': 'Phase 3-2 · Database Design',
    'phase.3-3a': 'Phase 3-3a · Test Case Design (Unit + Scenario)',
    'phase.3-3b': 'Phase 3-3b · API Orchestration Tests',
    'phase.3-5': 'Phase 3-5 · Test Acceptance (verify)',
    'status.activeProposals': 'Active Change Proposals',
    'status.allDone': 'All phases complete! Run `openlogos verify` to check test acceptance.',
    'status.allDoneHint': '   → Or tell AI: "Implement S01 according to specs"',
    'status.suggestNext': 'Suggested next step: {label}',
    'suggest.phase1': 'Tell AI: "Help me write requirements"',
    'suggest.phase2': 'Tell AI: "Do product design based on requirements"',
    'suggest.phase3-0': 'Tell AI: "Help me design the technical architecture"',
    'suggest.phase3-1': 'Tell AI: "Help me draw S01 sequence diagram"',
    'suggest.phase3-2-api': 'Tell AI: "Help me design the API"',
    'suggest.phase3-2-db': 'Tell AI: "Help me design the database"',
    'suggest.phase3-3a': 'Tell AI: "Help me design test cases"',
    'suggest.phase3-3b': 'Tell AI: "Help me design orchestration tests"',
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
    'change.step4': '  4. When done, run `openlogos merge {slug}` to generate merge instructions',

    // merge
    'merge.summary': 'Merge Summary:',
    'merge.proposal': '  - Change proposal: {slug}',
    'merge.deltaCount': '  - Delta files: {count}',
    'merge.aiHint': 'Tell AI: "Read logos/changes/{slug}/MERGE_PROMPT.md and execute merge"',
    'merge.archiveHint': 'After merge, run `openlogos archive {slug}` to archive the proposal.',

    // launch
    'launch.done': '✓ Change management activated! Lifecycle is now "active".',
    'launch.hint1': '  From now on, modifications to existing documents require a change proposal.',
    'launch.hint2': '  Run `openlogos change <slug>` to start a new change proposal.',
    'launch.rulesUpdated': 'AI rules updated in {target}',
    'launch.alreadyActive': 'Change management is already active (lifecycle: "active").',
    'launch.suggest': 'Run `openlogos launch` to activate change management for future iterations.',

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
    'init.aiToolCursor': '  1. Cursor（默认）',
    'init.aiToolClaudeCode': '  2. Claude Code',
    'init.aiToolOpenCode': '  3. OpenCode',
    'init.aiToolOther': '  4. 其他',
    'init.aiToolPrompt': '请选择 [1/2/3/4]（默认: 1）: ',
    'init.skillsDeployed': '{count} 个 Skills 已部署到 {target}',
    'init.skillsSynced': '{count} 个 Skills 已同步到 {target}',
    'init.opencodePluginDeployed': 'OpenCode 插件已部署到 {target}',
    'init.opencodePluginSynced': 'OpenCode 插件已同步到 {target}',
    'init.opencodeConfigCreated': '已创建 opencode.json，并写入推荐权限默认值',
    'init.opencodeConfigUpdated': '已为 opencode.json 补齐缺失的推荐权限默认值',
    'init.opencodeCommandsDeployed': 'OpenCode 斜杠命令已部署到 .opencode/commands/（{count} 个文件）',

    // status
    'phase.1': 'Phase 1 · 需求文档 (WHY)',
    'phase.2': 'Phase 2 · 产品设计 (WHAT)',
    'phase.3-0': 'Phase 3-0 · 技术架构',
    'phase.3-1': 'Phase 3-1 · 场景建模',
    'phase.3-2-api': 'Phase 3-2 · API 设计',
    'phase.3-2-db': 'Phase 3-2 · 数据库设计',
    'phase.3-3a': 'Phase 3-3a · 测试用例设计（单元 + 场景）',
    'phase.3-3b': 'Phase 3-3b · API 编排测试',
    'phase.3-5': 'Phase 3-5 · 测试验收（verify）',
    'status.activeProposals': '活跃变更提案',
    'status.allDone': '所有阶段已完成！运行 `openlogos verify` 查看测试验收结果。',
    'status.allDoneHint': '   → 或对 AI 说：「按 S01 的规格帮我实现」',
    'status.suggestNext': '建议下一步：{label}',
    'suggest.phase1': '对 AI 说：「帮我写需求文档」',
    'suggest.phase2': '对 AI 说：「基于需求文档做产品设计」',
    'suggest.phase3-0': '对 AI 说：「帮我设计技术架构」',
    'suggest.phase3-1': '对 AI 说：「帮我画 S01 的时序图」',
    'suggest.phase3-2-api': '对 AI 说：「帮我设计 API」',
    'suggest.phase3-2-db': '对 AI 说：「帮我设计数据库」',
    'suggest.phase3-3a': '对 AI 说：「帮我设计测试用例」',
    'suggest.phase3-3b': '对 AI 说：「帮我设计编排测试」',
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
    'change.step4': '  4. 完成后运行 `openlogos merge {slug}` 生成合并指令',

    // merge
    'merge.summary': '合并摘要：',
    'merge.proposal': '  - 变更提案：{slug}',
    'merge.deltaCount': '  - Delta 文件：{count} 个',
    'merge.aiHint': '对 AI 说：「读取 logos/changes/{slug}/MERGE_PROMPT.md 并执行合并」',
    'merge.archiveHint': '合并完成后，运行 `openlogos archive {slug}` 归档提案。',

    // launch
    'launch.done': '✓ 变更管理已激活！lifecycle 已切换为 "active"。',
    'launch.hint1': '  从现在起，修改已有文档必须先创建变更提案。',
    'launch.hint2': '  运行 `openlogos change <slug>` 创建新的变更提案。',
    'launch.rulesUpdated': 'AI 规则已更新到 {target}',
    'launch.alreadyActive': '变更管理已处于激活状态（lifecycle: "active"）。',
    'launch.suggest': '运行 `openlogos launch` 激活变更管理，开始迭代开发。',

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
  'phase.3-5',
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
  'phase.3-5': 'suggest.phase3-5',
};

// --- Long-form templates ---

export function proposalTemplate(locale: Locale, slug: string): string {
  if (locale === 'zh') {
    return `# 变更提案：${slug}

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
- [ ] 部署到测试环境
- [ ] 运行编排验收
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
- [ ] Deploy to test environment
- [ ] Run orchestration acceptance
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
8. 完成后提醒用户运行 \`openlogos archive ${slug}\`
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
8. Remind the user to run \`openlogos archive ${slug}\`
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
