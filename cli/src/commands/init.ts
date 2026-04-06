import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { type Locale, t, conventionsForYaml, conventionsForAgentsMd } from '../i18n.js';

export type AiTool = 'cursor' | 'claude-code' | 'other';

type NameSource = 'argument' | 'package.json' | 'Cargo.toml' | 'pyproject.toml' | 'directory';

interface NameResult {
  name: string;
  source: NameSource;
}

export function readConfigName(root: string): NameResult | null {
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') {
        const name = pkg.name.replace(/^@[^/]+\//, '');
        return { name, source: 'package.json' };
      }
    } catch { /* ignore parse errors */ }
  }

  const cargoPath = join(root, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    try {
      const content = readFileSync(cargoPath, 'utf-8');
      const match = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
      if (match) return { name: match[1], source: 'Cargo.toml' };
    } catch { /* ignore */ }
  }

  const pyprojectPath = join(root, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    try {
      const content = readFileSync(pyprojectPath, 'utf-8');
      const match = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
      if (match) return { name: match[1], source: 'pyproject.toml' };
    } catch { /* ignore */ }
  }

  return null;
}

export function detectProjectName(root: string): NameResult {
  const configName = readConfigName(root);
  if (configName) return configName;
  return { name: basename(root), source: 'directory' };
}

function askQuestion(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function isTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}

async function resolveProjectName(locale: Locale, root: string, explicitName?: string): Promise<NameResult> {
  if (!explicitName) {
    return detectProjectName(root);
  }

  const configName = readConfigName(root);

  if (!configName || configName.name === explicitName) {
    return { name: explicitName, source: 'argument' };
  }

  console.log(`\n⚠ ${t(locale, 'init.nameConflict')}`);
  console.log(t(locale, 'init.nameChoice1', { name: explicitName }));
  console.log(t(locale, 'init.nameChoice2', { name: configName.name, source: configName.source }) + '\n');

  if (!isTTY()) {
    return { name: explicitName, source: 'argument' };
  }

  const answer = await askQuestion(t(locale, 'init.namePrompt'));

  if (answer === '2') {
    return configName;
  }
  return { name: explicitName, source: 'argument' };
}

async function chooseLocale(): Promise<Locale> {
  if (!isTTY()) return 'en';

  console.log('\nChoose language / 选择语言:');
  console.log('  1. English (default)');
  console.log('  2. 中文\n');

  const answer = await askQuestion('Your choice [1/2] (default: 1): ');
  return answer === '2' ? 'zh' : 'en';
}

async function chooseAiTool(locale: Locale): Promise<AiTool> {
  if (!isTTY()) return 'cursor';

  console.log(`\n${t(locale, 'init.aiToolHeader')}`);
  console.log(t(locale, 'init.aiToolCursor'));
  console.log(t(locale, 'init.aiToolClaudeCode'));
  console.log(t(locale, 'init.aiToolOther') + '\n');

  const answer = await askQuestion(t(locale, 'init.aiToolPrompt'));
  if (answer === '2') return 'claude-code';
  if (answer === '3') return 'other';
  return 'cursor';
}

export const SKILL_NAMES = [
  'project-init',
  'prd-writer',
  'product-designer',
  'architecture-designer',
  'scenario-architect',
  'api-designer',
  'db-designer',
  'test-writer',
  'test-orchestrator',
  'code-reviewer',
  'change-writer',
  'merge-executor',
] as const;

const SKILL_DESCRIPTIONS: Record<string, { en: string; zh: string }> = {
  'project-init': { en: 'Project initialization and structure setup', zh: '项目初始化与结构搭建' },
  'prd-writer': { en: 'Requirements document authoring', zh: '需求文档编写' },
  'product-designer': { en: 'Product design and prototyping', zh: '产品设计与原型' },
  'architecture-designer': { en: 'Technical architecture and technology selection', zh: '技术架构与技术选型' },
  'scenario-architect': { en: 'Business scenario modeling and sequence diagrams', zh: '业务场景建模与时序图' },
  'api-designer': { en: 'OpenAPI specification design', zh: 'OpenAPI 规格设计' },
  'db-designer': { en: 'Database schema design', zh: '数据库 Schema 设计' },
  'test-writer': { en: 'Unit test + scenario test case design (Step 3a, all projects)', zh: '单元测试 + 场景测试用例设计（Step 3a）' },
  'test-orchestrator': { en: 'API orchestration test design (Step 3b, API projects only)', zh: 'API 编排测试设计（Step 3b，仅 API 项目）' },
  'code-reviewer': { en: 'Code review and compliance checking', zh: '代码审查与规范检查' },
  'change-writer': { en: 'Change proposal writing and impact analysis', zh: '变更提案编写与影响分析' },
  'merge-executor': { en: 'Delta merge execution via MERGE_PROMPT.md', zh: '通过 MERGE_PROMPT.md 执行 Delta 合并' },
};

export function findSkillsSource(): string | null {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  // npm package layout: <pkg>/dist/commands/init.js → <pkg>/skills/
  const packageSkills = join(currentDir, '..', '..', 'skills');
  if (existsSync(packageSkills)) return packageSkills;

  // dev layout: cli/src/commands/init.ts → <repo>/skills/
  const devSkills = join(currentDir, '..', '..', '..', 'skills');
  if (existsSync(devSkills)) return devSkills;

  return null;
}

function generateChangeGuardMdc(locale: Locale): string {
  const body = locale === 'zh'
    ? `## OpenLogos 变更管理守卫

**在修改项目源代码或文档之前，必须遵循以下流程：**

1. 确认 \`logos/changes/\` 下是否已有对应的 active 变更提案
2. 如果没有，**立即停止编码**，先运行 \`openlogos change <slug>\` 创建提案
3. 按照 change-writer Skill 填写 \`proposal.md\` 和 \`tasks.md\`
4. 提案经用户 review 通过后才能开始代码实现
5. 实现完成后运行 \`openlogos merge <slug>\` 和 \`openlogos archive <slug>\`

### 例外情况
- 纯 typo 修复（不改变语义）
- 仅修改 \`.gitignore\`、\`README.md\` 等非方法论文件

### 违规检测
如果你发现自己正在修改 \`cli/src/\`、\`skills/\`、\`spec/\` 下的文件但没有活跃提案，请立即停止并提醒用户。`
    : `## OpenLogos Change Management Guard

**Before modifying any project source code or documents, you MUST follow this workflow:**

1. Check if there is an active change proposal under \`logos/changes/\`
2. If NOT, **stop coding immediately** and run \`openlogos change <slug>\` to create a proposal
3. Fill in \`proposal.md\` and \`tasks.md\` following the change-writer Skill
4. Only proceed with implementation after the user has reviewed and approved the proposal
5. After implementation, run \`openlogos merge <slug>\` and \`openlogos archive <slug>\`

### Exceptions
- Pure typo fixes (no semantic change)
- Changes to non-methodology files only (\`.gitignore\`, \`README.md\`, etc.)

### Violation Detection
If you find yourself modifying files under \`cli/src/\`, \`skills/\`, or \`spec/\` without an active proposal, stop immediately and remind the user.`;

  return `---
description: "OpenLogos — Change Management Guard (always active)"
alwaysApply: true
---

${body}
`;
}

function resolveSkillFile(sourceDir: string, skillName: string, locale: Locale): string | null {
  if (locale === 'en') {
    const enPath = join(sourceDir, skillName, 'SKILL.en.md');
    if (existsSync(enPath)) return enPath;
  }
  const defaultPath = join(sourceDir, skillName, 'SKILL.md');
  if (existsSync(defaultPath)) return defaultPath;
  return null;
}

export function deploySkills(
  root: string,
  aiTool: AiTool,
  locale: Locale = 'en',
  skillsSource?: string,
): { target: string; count: number } | null {
  const source = skillsSource ?? findSkillsSource();
  if (!source || !existsSync(source)) return null;

  let count = 0;

  if (aiTool === 'cursor') {
    const targetDir = join(root, '.cursor', 'rules');
    mkdirSync(targetDir, { recursive: true });
    for (const name of SKILL_NAMES) {
      const srcPath = resolveSkillFile(source, name, locale);
      if (srcPath) {
        const content = readFileSync(srcPath, 'utf-8');
        const desc = SKILL_DESCRIPTIONS[name]?.en ?? name;
        const mdc = `---\ndescription: "OpenLogos — ${desc}"\nalwaysApply: false\n---\n\n${content}`;
        writeFileSync(join(targetDir, `${name}.mdc`), mdc);
        count++;
      }
    }
    writeFileSync(join(targetDir, 'change-guard.mdc'), generateChangeGuardMdc(locale));
    return { target: '.cursor/rules/', count };
  }

  const targetDir = join(root, 'logos', 'skills');
  for (const name of SKILL_NAMES) {
    const skillDir = join(targetDir, name);
    mkdirSync(skillDir, { recursive: true });
    const srcPath = resolveSkillFile(source, name, locale);
    if (srcPath) {
      copyFileSync(srcPath, join(skillDir, 'SKILL.md'));
      count++;
    }
  }
  return { target: 'logos/skills/', count };
}

function shouldIncludeActiveSkills(aiTool: AiTool, target: 'agents' | 'claude'): boolean {
  if (aiTool === 'cursor') return target === 'agents';
  if (aiTool === 'claude-code') return target === 'claude';
  return true;
}

function generateActiveSkillsSection(locale: Locale): string {
  let section = '';
  for (const name of SKILL_NAMES) {
    const desc = SKILL_DESCRIPTIONS[name]?.[locale] ?? SKILL_DESCRIPTIONS[name]?.en ?? name;
    section += `- \`skills/${name}/\` — ${desc}\n`;
  }
  return section;
}

const DIRECTORIES = [
  'logos/resources/prd/1-product-requirements',
  'logos/resources/prd/2-product-design/1-feature-specs',
  'logos/resources/prd/2-product-design/2-page-design',
  'logos/resources/prd/3-technical-plan/1-architecture',
  'logos/resources/prd/3-technical-plan/2-scenario-implementation',
  'logos/resources/api',
  'logos/resources/database',
  'logos/resources/test',
  'logos/resources/scenario',
  'logos/resources/verify',
  'logos/changes',
  'logos/changes/archive',
];

export function createLogosConfig(name: string, locale: Locale, aiTool: AiTool = 'cursor'): string {
  return JSON.stringify({
    name,
    locale,
    aiTool,
    description: '',
    documents: {
      prd: {
        label: { en: 'Product Docs', zh: '产品文档' },
        path: './resources/prd',
        pattern: '**/*.{md,html,htm,pdf}',
      },
      api: {
        label: { en: 'API Docs', zh: 'API 文档' },
        path: './resources/api',
        pattern: '**/*.{yaml,yml,json}',
      },
      test: {
        label: { en: 'Test Cases', zh: '测试用例' },
        path: './resources/test',
        pattern: '**/*.md',
      },
      scenario: {
        label: { en: 'Scenarios', zh: '业务场景' },
        path: './resources/scenario',
        pattern: '**/*.json',
      },
      database: {
        label: { en: 'Database', zh: '数据库' },
        path: './resources/database',
        pattern: '**/*.sql',
      },
      verify: {
        label: { en: 'Verify Reports', zh: '验收报告' },
        path: './resources/verify',
        pattern: '**/*.{jsonl,md}',
      },
    },
    verify: {
      result_path: 'logos/resources/verify/test-results.jsonl',
    },
  }, null, 2);
}

export function createLogosProject(name: string, locale: Locale): string {
  return `project:
  name: "${name}"
  description: ""
  methodology: "OpenLogos"

tech_stack: {}

resource_index: []

${conventionsForYaml(locale)}
`;
}

export function createAgentsMd(locale: Locale, aiTool?: AiTool, target?: 'agents' | 'claude'): string {
  const includeSkills = aiTool && target ? shouldIncludeActiveSkills(aiTool, target) : false;

  const langPolicy = locale === 'zh'
    ? `## Language Policy
本项目的文档语言配置于 \`logos/logos.config.json\` 的 \`locale\` 字段（当前值：\`"zh"\`）。
- 所有生成的文档、注释和 AI 回复**必须使用中文**
- Skill 文件可能使用任何语言编写，但你的输出必须遵循 locale 设置
- 生成文档前请先检查 \`logos/logos.config.json\`
`
    : `## Language Policy
This project's document language is configured in \`logos/logos.config.json\` → \`locale\` field (current value: \`"en"\`).
- ALL generated documents, comments, and AI responses MUST be in **English**
- Skill files may be written in any language, but your output MUST follow the locale setting
- Check \`logos/logos.config.json\` before generating any document
`;

  let content = `# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read \`logos/logos-project.yaml\` first to understand the project resource index.

## Project Context
- Config: \`logos/logos.config.json\`
- Resource Index: \`logos/logos-project.yaml\`

${langPolicy}
## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)
6. All generated test code must include an OpenLogos reporter (see spec/test-results.md)

## Interaction Guidelines
When the user's request is vague or they ask "what should I do next":
1. Scan \`logos/resources/\` to determine the current project phase
2. Suggest the specific next step based on what's missing
3. Provide a ready-to-use prompt the user can directly say
4. Never start generating documents without confirming key information

Phase detection logic:
- \`logos/resources/prd/1-product-requirements/\` is empty → suggest Phase 1 (prd-writer)
- requirements exist but \`2-product-design/\` is empty → suggest Phase 2 (product-designer)
- design exists but \`3-technical-plan/1-architecture/\` is empty → suggest Phase 3 Step 0 (architecture-designer)
- architecture exists but \`3-technical-plan/2-scenario-implementation/\` is empty → suggest Phase 3 Step 1 (scenario-architect)
- scenarios exist but \`logos/resources/api/\` is empty → suggest Phase 3 Step 2 (api-designer + db-designer)
- API exists but \`logos/resources/test/\` is empty → suggest Phase 3 Step 3a (test-writer)
- test cases exist but \`logos/resources/scenario/\` is empty → suggest Phase 3 Step 3b (test-orchestrator, API projects only)
- All above exist → suggest Phase 3 Step 4 (code generation)
- code generated but \`logos/resources/verify/\` is empty → suggest Phase 3 Step 5 (run tests then \`openlogos verify\`)
`;

  if (includeSkills) {
    content += `
## Active Skills
${generateActiveSkillsSection(locale)}`;
  }

  const changeMgmt = locale === 'zh'
    ? `## ⚠️ 变更管理（必须遵守）

**修改任何源代码或 Skill 文件之前，必须先创建变更提案：**

1. 运行 \`openlogos change <slug>\` 创建提案目录
2. 使用 change-writer Skill 填写 \`proposal.md\` + \`tasks.md\`
3. 用户确认后再开始编码
4. 完成后运行 \`openlogos merge <slug>\` → \`openlogos archive <slug>\`

唯一例外：纯 typo 修复、README 等非方法论文件的修改。
**跳过此步骤将违反 OpenLogos 核心方法论。**
`
    : `## ⚠️ Change Management (Must Follow)

**Before modifying ANY source code or Skill files, you MUST create a change proposal first:**

1. Run \`openlogos change <slug>\` to create the proposal directory
2. Fill in \`proposal.md\` + \`tasks.md\` using the change-writer Skill
3. Only proceed with implementation after user approval
4. After completion, run \`openlogos merge <slug>\` → \`openlogos archive <slug>\`

Only exception: pure typo fixes and non-methodology files (README, .gitignore, etc.).
**Skipping this step violates the core OpenLogos methodology.**
`;

  content += `
${changeMgmt}
## Conventions
${conventionsForAgentsMd(locale)}
`;

  return content;
}

export async function init(name?: string) {
  const root = process.cwd();

  if (existsSync(join(root, 'logos', 'logos.config.json'))) {
    console.error('Error: logos/logos.config.json already exists in current directory.');
    console.error('This directory has already been initialized as an OpenLogos project.');
    process.exit(1);
  }

  const locale = await chooseLocale();
  const aiTool = await chooseAiTool(locale);
  const { name: projectName, source: nameSource } = await resolveProjectName(locale, root, name);

  const sourceLabel: Record<NameSource, string> = {
    'argument': '',
    'package.json': ' ← from package.json',
    'Cargo.toml': ' ← from Cargo.toml',
    'pyproject.toml': ' ← from pyproject.toml',
    'directory': ' ← from directory name',
  };

  console.log(`\n${t(locale, 'init.creating', { name: projectName, source: sourceLabel[nameSource] })}\n`);

  for (const dir of DIRECTORIES) {
    const fullPath = join(root, dir);
    mkdirSync(fullPath, { recursive: true });
    writeFileSync(join(fullPath, '.gitkeep'), '');
    console.log(`  ✓ ${dir}/`);
  }

  writeFileSync(join(root, 'logos', 'logos.config.json'), createLogosConfig(projectName, locale, aiTool));
  console.log(`  ✓ logos/logos.config.json`);

  writeFileSync(join(root, 'logos', 'logos-project.yaml'), createLogosProject(projectName, locale));
  console.log(`  ✓ logos/logos-project.yaml`);

  writeFileSync(join(root, 'AGENTS.md'), createAgentsMd(locale, aiTool, 'agents'));
  console.log(`  ✓ AGENTS.md`);

  writeFileSync(join(root, 'CLAUDE.md'), createAgentsMd(locale, aiTool, 'claude'));
  console.log(`  ✓ CLAUDE.md`);

  const deployResult = deploySkills(root, aiTool, locale);
  if (deployResult && deployResult.count > 0) {
    console.log(`  ✓ ${t(locale, 'init.skillsDeployed', { count: String(deployResult.count), target: deployResult.target })}`);
  }

  const isAutoDetected = nameSource !== 'argument';
  const nameHint = isAutoDetected
    ? `\n${t(locale, 'init.nameTip', { name: projectName, source: sourceLabel[nameSource] })}\n`
    : '';

  console.log(`\n${t(locale, 'init.done')}`);
  console.log(t(locale, 'init.step1'));
  if (nameHint) console.log(nameHint);
  console.log(t(locale, 'init.step2'));
  console.log(t(locale, 'init.step3') + '\n');
}
