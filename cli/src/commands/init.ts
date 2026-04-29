import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, readdirSync, chmodSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { type Locale, t, conventionsForYaml, conventionsForAgentsMd } from '../i18n.js';

export type AiTool = 'claude-code' | 'opencode' | 'codex' | 'cursor' | 'other' | 'all';

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

function detectAiToolFromEnv(): AiTool {
  if (process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDE_CODE) return 'claude-code';
  return 'claude-code';
}

async function chooseLocale(): Promise<Locale> {
  if (!isTTY()) {
    console.error('Error: --locale is required in non-interactive mode.');
    console.error('');
    console.error('Usage: openlogos init --locale <en|zh> [--ai-tool <claude-code|opencode|codex|cursor|other|all>] [name]');
    console.error('');
    console.error('Ask the user to choose a language first:');
    console.error('  --locale en    English');
    console.error('  --locale zh    中文');
    process.exit(1);
  }

  console.log('\nChoose language / 选择语言:');
  console.log('  1. English (default)');
  console.log('  2. 中文\n');

  const answer = await askQuestion('Your choice [1/2] (default: 1): ');
  return answer === '2' ? 'zh' : 'en';
}

async function chooseAiTool(locale: Locale): Promise<AiTool> {
  if (!isTTY()) return detectAiToolFromEnv();

  console.log(`\n${t(locale, 'init.aiToolHeader')}`);
  console.log(t(locale, 'init.aiToolClaudeCode'));
  console.log(t(locale, 'init.aiToolOpenCode'));
  console.log(t(locale, 'init.aiToolCodex'));
  console.log(t(locale, 'init.aiToolCursor'));
  console.log(t(locale, 'init.aiToolOther'));
  console.log(t(locale, 'init.aiToolAll') + '\n');

  const answer = await askQuestion(t(locale, 'init.aiToolPrompt'));
  if (answer === '2') return 'opencode';
  if (answer === '3') return 'codex';
  if (answer === '4') return 'cursor';
  if (answer === '5') return 'other';
  if (answer === '6') return 'all';
  return 'claude-code';
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
  'code-implementor',
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
  'code-implementor': { en: 'Code and test code generation with spec fidelity (Step 4)', zh: '基于规格链的代码与测试代码生成（Step 4）' },
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

export function findSpecSource(): string | null {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  const packageSpec = join(currentDir, '..', '..', 'spec');
  if (existsSync(packageSpec)) return packageSpec;

  const devSpec = join(currentDir, '..', '..', '..', 'spec');
  if (existsSync(devSpec)) return devSpec;

  return null;
}

export function findOpenCodePluginTemplateSource(): string | null {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  // npm package layout: <pkg>/dist/commands/init.js → <pkg>/opencode-plugin-template/
  const packageTemplate = join(currentDir, '..', '..', 'opencode-plugin-template');
  if (existsSync(packageTemplate)) return packageTemplate;

  // dev layout: cli/src/commands/init.ts → <repo>/plugin-opencode/template/
  const devTemplate = join(currentDir, '..', '..', '..', 'plugin-opencode', 'template');
  if (existsSync(devTemplate)) return devTemplate;

  return null;
}

export function findCodexPluginTemplateSource(): string | null {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  // npm package layout: <pkg>/dist/commands/init.js → <pkg>/codex-plugin-template/
  const packageTemplate = join(currentDir, '..', '..', 'codex-plugin-template');
  if (existsSync(packageTemplate)) return packageTemplate;

  // dev layout: cli/src/commands/init.ts → <repo>/plugin-codex/
  const devTemplate = join(currentDir, '..', '..', '..', 'plugin-codex');
  if (existsSync(devTemplate)) return devTemplate;

  return null;
}

function mergeCodexConfig(root: string): { created: boolean; updated: boolean } {
  const configDir = join(root, '.codex');
  const configPath = join(configDir, 'config.toml');

  const pluginBlock = `\n[plugins.openlogos]\nenabled = true\n`;
  const hookBlock = `\n[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = ".codex-plugin/hooks/session-start.sh"\ntimeout = 5\nasync = false\nstatusMessage = "Loading OpenLogos phase context..."\n`;

  mkdirSync(configDir, { recursive: true });

  if (!existsSync(configPath)) {
    writeFileSync(configPath, pluginBlock + hookBlock);
    return { created: true, updated: true };
  }

  const existing = readFileSync(configPath, 'utf-8');
  let content = existing;
  let changed = false;
  const hasPluginBlock = content.includes('[plugins.openlogos]');
  const hasOpenLogosHook = content.includes('command = ".codex-plugin/hooks/session-start.sh"');

  if (!hasPluginBlock) {
    content += pluginBlock;
    changed = true;
  }
  if (!hasOpenLogosHook) {
    content += hookBlock;
    changed = true;
  }

  if (changed) {
    writeFileSync(configPath, content);
  }
  return { created: false, updated: changed };
}

export function deployCodexPlugin(root: string, locale: Locale = 'en'): { target: string; config: { created: boolean; updated: boolean } } | null {
  const source = findCodexPluginTemplateSource();
  if (!source || !existsSync(source)) return null;

  const pluginDir = join(root, '.codex-plugin');
  const hooksDir = join(pluginDir, 'hooks');
  mkdirSync(hooksDir, { recursive: true });

  const pluginJsonSrc = join(source, 'plugin.json');
  const hookSrc = join(source, 'session-start.sh');

  if (!existsSync(pluginJsonSrc) || !existsSync(hookSrc)) return null;

  copyFileSync(pluginJsonSrc, join(pluginDir, 'plugin.json'));
  const hookDest = join(hooksDir, 'session-start.sh');
  copyFileSync(hookSrc, hookDest);
  try { chmodSync(hookDest, 0o755); } catch { /* ignore on platforms that don't support chmod */ }

  const configResult = mergeCodexConfig(root);

  const targetLabel = locale === 'zh'
    ? '.codex-plugin/ + .codex/config.toml'
    : '.codex-plugin/ + .codex/config.toml';

  return { target: targetLabel, config: configResult };
}

function mergeOpenCodeConfig(root: string) {
  const configPath = join(root, 'opencode.json');
  const defaultConfig: Record<string, unknown> = {
    '$schema': 'https://opencode.ai/config.json',
    permission: {
      bash: 'ask',
      edit: 'ask',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      skill: 'allow',
    },
  };

  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return { created: true, updated: true };
  }

  let changed = false;
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    // invalid json: keep file intact and skip merge
    return { created: false, updated: false };
  }

  if (!data['$schema']) {
    data['$schema'] = 'https://opencode.ai/config.json';
    changed = true;
  }

  const permission = (data.permission && typeof data.permission === 'object' && !Array.isArray(data.permission))
    ? data.permission as Record<string, unknown>
    : {};
  const defaults = defaultConfig.permission as Record<string, unknown>;

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in permission)) {
      permission[key] = value;
      changed = true;
    }
  }

  data.permission = permission;

  if (changed) {
    writeFileSync(configPath, JSON.stringify(data, null, 2));
  }
  return { created: false, updated: changed };
}

export function deployOpenCodePlugin(root: string, locale: Locale = 'en'): { target: string; config: { created: boolean; updated: boolean }; commandCount: number } | null {
  const source = findOpenCodePluginTemplateSource();
  if (!source || !existsSync(source)) return null;

  const pluginTargetDir = join(root, '.opencode', 'plugins');
  mkdirSync(pluginTargetDir, { recursive: true });

  const sourceFile = join(source, 'openlogos.js');
  if (!existsSync(sourceFile)) return null;

  copyFileSync(sourceFile, join(pluginTargetDir, 'openlogos.js'));
  const configResult = mergeOpenCodeConfig(root);

  let commandCount = 0;
  const commandsSourceDir = join(source, 'commands');
  if (existsSync(commandsSourceDir)) {
    const commandsTargetDir = join(root, '.opencode', 'commands');
    mkdirSync(commandsTargetDir, { recursive: true });
    for (const file of readdirSync(commandsSourceDir).filter(f => f.endsWith('.md'))) {
      copyFileSync(join(commandsSourceDir, file), join(commandsTargetDir, file));
      commandCount++;
    }
  }

  return {
    target: locale === 'zh' ? '.opencode/plugins/openlogos.js + opencode.json' : '.opencode/plugins/openlogos.js + opencode.json',
    config: configResult,
    commandCount,
  };
}

export function deploySpecs(root: string): { count: number } | null {
  const source = findSpecSource();
  if (!source || !existsSync(source)) return null;

  const targetDir = join(root, 'logos', 'spec');
  mkdirSync(targetDir, { recursive: true });

  const files = readdirSync(source).filter(f => f.endsWith('.md') || f.endsWith('.json'));
  for (const file of files) {
    copyFileSync(join(source, file), join(targetDir, file));
  }

  return { count: files.length };
}

export function generatePolicyMdc(locale: Locale, isLaunched: boolean = false): string {
  const langSection = locale === 'zh'
    ? `## ⚠️ 语言策略（最高优先级）

本项目的文档语言为 **中文**（配置于 \`logos/logos.config.json\` → \`locale: "zh"\`）。

**你的所有输出——包括生成的文档、代码注释、回复消息——必须使用中文。**
即使 Skill 文件使用其他语言编写，你的输出也必须是中文。
违反此规则将导致产出不可用。`
    : `## ⚠️ Language Policy (Highest Priority)

This project's document language is **English** (configured in \`logos/logos.config.json\` → \`locale: "en"\`).

**ALL your output — including generated documents, code comments, and responses — MUST be in English.**
Even if Skill files are written in another language, your output MUST be in English.
Violating this rule will render the output unusable.`;

  const changeMgmtSection = isLaunched
    ? (locale === 'zh'
      ? `## ⛔ 变更管理（强制执行）

本项目使用 \`logos/.openlogos-guard\` 锁文件来追踪活跃变更。
- **有 guard 文件** → 可以修改代码，但只能在该提案范围内修改
- **无 guard 文件** → **禁止修改任何源代码**，必须先运行 \`openlogos change <slug>\`

### 行为约束
- 发现 bug/问题时：只输出分析和方案，**禁止直接修改代码**
- 修改代码前：先确认 guard 文件存在且修改在提案范围内
- 唯一例外：纯 typo 修复、\`.gitignore\`/\`README.md\` 等非方法论文件`
      : `## ⛔ Change Management (Enforced)

This project uses \`logos/.openlogos-guard\` lock file to track active changes.
- **Guard file exists** → you may modify code, but only within the scope of that proposal
- **No guard file** → **modifying source code is FORBIDDEN** — run \`openlogos change <slug>\` first

### Behavioral Constraints
- When you discover a bug/issue: only output analysis and proposed fix — do NOT modify code directly
- Before modifying code: verify the guard file exists and changes are within the proposal scope
- Only exception: pure typo fixes, \`.gitignore\`/\`README.md\` and other non-methodology files`)
    : (locale === 'zh'
      ? `## 变更管理（当前：初始开发期）

本项目处于 **初始开发阶段**（\`logos/logos.config.json\` → \`lifecycle: "initial"\`）。

在初始开发期：
- 按照 Phase 1 → 2 → 3 的顺序逐步**创建**文档，无需变更提案
- 使用 \`openlogos status\` 查看当前进度和下一步建议
- 首轮开发完成后，运行 \`openlogos launch\` 激活变更管理`
      : `## Change Management (Current: Initial Development)

This project is in the **initial development phase** (\`logos/logos.config.json\` → \`lifecycle: "initial"\`).

During initial development:
- Follow the Phase 1 → 2 → 3 progression to CREATE documents — no change proposals needed
- Use \`openlogos status\` to check progress and get next-step suggestions
- After the first full cycle is complete, run \`openlogos launch\` to activate change management`);

  return `---
description: "OpenLogos — Project Policy: Language & Change Management (always active)"
alwaysApply: true
---

${langSection}

${changeMgmtSection}
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
  isLaunched: boolean = false,
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
    writeFileSync(join(targetDir, 'openlogos-policy.mdc'), generatePolicyMdc(locale, isLaunched));
    return { target: '.cursor/rules/', count };
  }

  if (aiTool === 'codex') {
    const targetDir = join(root, '.agents', 'skills');
    for (const name of SKILL_NAMES) {
      const skillDir = join(targetDir, name);
      mkdirSync(skillDir, { recursive: true });
      const srcPath = resolveSkillFile(source, name, locale);
      if (srcPath) {
        copyFileSync(srcPath, join(skillDir, 'SKILL.md'));
        count++;
      }
    }
    return { target: '.agents/skills/', count };
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
  if (aiTool === 'all') return true;
  if (aiTool === 'cursor') return target === 'agents';
  if (aiTool === 'claude-code') return target === 'claude';
  if (aiTool === 'opencode') return target === 'agents';
  if (aiTool === 'codex') return target === 'agents';
  return true;
}

function skillBasePath(aiTool: AiTool | undefined, target: 'agents' | 'claude' | undefined): string {
  if (aiTool === 'codex' && target === 'agents') {
    return '.agents/skills';
  }
  return 'logos/skills';
}

function generateActiveSkillsSection(locale: Locale, aiTool?: AiTool, target?: 'agents' | 'claude'): string {
  let section = '';
  const basePath = skillBasePath(aiTool, target);
  for (const name of SKILL_NAMES) {
    const desc = SKILL_DESCRIPTIONS[name]?.[locale] ?? SKILL_DESCRIPTIONS[name]?.en ?? name;
    section += `- \`${basePath}/${name}/SKILL.md\` — ${desc}\n`;
  }
  return section;
}

function skillPath(name: string, aiTool?: AiTool, target?: 'agents' | 'claude'): string {
  return `${skillBasePath(aiTool, target)}/${name}/SKILL.md`;
}

function generatePhaseDetectionPlain(locale: Locale): string {
  if (locale === 'zh') {
    return `Phase 检测逻辑：
- \`logos/resources/prd/1-product-requirements/\` 为空 → 建议 Phase 1（prd-writer）
- 需求存在但 \`2-product-design/\` 为空 → 建议 Phase 2（product-designer）
- 设计存在但 \`3-technical-plan/1-architecture/\` 为空 → 建议 Phase 3 Step 0（architecture-designer）
- 架构存在但 \`3-technical-plan/2-scenario-implementation/\` 为空 → 建议 Phase 3 Step 1（scenario-architect）
- 场景存在但 \`logos/resources/api/\` 为空 → 建议 Phase 3 Step 2（api-designer + db-designer）
- API 存在但 \`logos/resources/test/\` 为空 → 建议 Phase 3 Step 3a（test-writer）
- 测试用例存在但 \`logos/resources/scenario/\` 为空 → 建议 Phase 3 Step 3b（test-orchestrator，仅 API 项目）
- 编排测试存在但 \`logos/resources/implementation/\` 为空 → 建议 Phase 3 Step 4（code-implementor）
- 代码已生成但 \`logos/resources/verify/\` 为空 → 建议 Phase 3 Step 5（运行测试后 \`openlogos verify\`）

文件命名规范（模块前缀）：
- 所有设计文档遵循 \`<module>-<序号>-<类型>.md\` 格式，初始项目默认使用 \`core-\` 前缀
- 场景实现文件：\`<module>-SXX-<slug>.md\`（如 \`core-S01-cli-init.md\`）
- 测试用例文件：\`<module>-SXX-test-cases.md\`（如 \`core-S01-test-cases.md\`）
- 场景编号全局唯一，由 \`logos-project.yaml\` 的 \`scenario_counter.next_id\` 维护，严禁不同模块从 S01 重新开始
- 多模块状态：\`openlogos status\` 聚合展示所有模块（in-progress 置顶）；\`openlogos next\` 单模块直接建议，多模块并列列出，无 in-progress 时提示 \`module add\``;
  }
  return `Phase detection logic:
- \`logos/resources/prd/1-product-requirements/\` is empty → suggest Phase 1 (prd-writer)
- requirements exist but \`2-product-design/\` is empty → suggest Phase 2 (product-designer)
- design exists but \`3-technical-plan/1-architecture/\` is empty → suggest Phase 3 Step 0 (architecture-designer)
- architecture exists but \`3-technical-plan/2-scenario-implementation/\` is empty → suggest Phase 3 Step 1 (scenario-architect)
- scenarios exist but \`logos/resources/api/\` is empty → suggest Phase 3 Step 2 (api-designer + db-designer)
- API exists but \`logos/resources/test/\` is empty → suggest Phase 3 Step 3a (test-writer)
- test cases exist but \`logos/resources/scenario/\` is empty → suggest Phase 3 Step 3b (test-orchestrator, API projects only)
- orchestration tests exist but \`logos/resources/implementation/\` is empty → suggest Phase 3 Step 4 (code-implementor)
- code generated but \`logos/resources/verify/\` is empty → suggest Phase 3 Step 5 (run tests then \`openlogos verify\`)

File naming convention (module prefix):
- All design documents follow \`<module>-<number>-<type>.md\` format; default module is \`core-\` prefix
- Scenario implementation files: \`<module>-SXX-<slug>.md\` (e.g. \`core-S01-cli-init.md\`)
- Test case files: \`<module>-SXX-test-cases.md\` (e.g. \`core-S01-test-cases.md\`)
- Scenario numbers are globally unique, maintained by \`scenario_counter.next_id\` in \`logos-project.yaml\`; never restart from S01 for a new module
- Multi-module status: \`openlogos status\` shows all modules (in-progress first); \`openlogos next\` gives direct suggestion for single module, lists all for multiple, prompts \`module add\` when none in-progress`;
}

function generatePhaseDetectionWithSkills(locale: Locale, aiTool?: AiTool, target?: 'agents' | 'claude'): string {
  if (locale === 'zh') {
    return `Phase 检测逻辑（检测到对应阶段时，**必须先读取** Skill 文件并按其步骤执行）：
- \`logos/resources/prd/1-product-requirements/\` 为空 → Phase 1 → **读取 \`${skillPath('prd-writer', aiTool, target)}\` 并按其步骤执行**
- 需求存在但 \`2-product-design/\` 为空 → Phase 2 → **读取 \`${skillPath('product-designer', aiTool, target)}\` 并按其步骤执行**
- 设计存在但 \`3-technical-plan/1-architecture/\` 为空 → Phase 3 Step 0 → **读取 \`${skillPath('architecture-designer', aiTool, target)}\` 并按其步骤执行**
- 架构存在但 \`3-technical-plan/2-scenario-implementation/\` 为空 → Phase 3 Step 1 → **读取 \`${skillPath('scenario-architect', aiTool, target)}\` 并按其步骤执行**
- 场景存在但 \`logos/resources/api/\` 为空 → Phase 3 Step 2 → **读取 \`${skillPath('api-designer', aiTool, target)}\` 和 \`${skillPath('db-designer', aiTool, target)}\` 并按其步骤执行**
- API 存在但 \`logos/resources/test/\` 为空 → Phase 3 Step 3a → **读取 \`${skillPath('test-writer', aiTool, target)}\` 并按其步骤执行**
- 测试用例存在但 \`logos/resources/scenario/\` 为空 → Phase 3 Step 3b → **读取 \`${skillPath('test-orchestrator', aiTool, target)}\` 并按其步骤执行**（仅 API 项目）
- 编排测试存在但 \`logos/resources/implementation/\` 为空 → Phase 3 Step 4 → **读取 \`${skillPath('code-implementor', aiTool, target)}\` 并按其步骤执行**（完成后可用 \`${skillPath('code-reviewer', aiTool, target)}\` 进行代码审查）
- 代码已生成但 \`logos/resources/verify/\` 为空 → Phase 3 Step 5（运行测试后 \`openlogos verify\`）

文件命名规范（模块前缀）：
- 所有设计文档遵循 \`<module>-<序号>-<类型>.md\` 格式，初始项目默认使用 \`core-\` 前缀
- 场景实现文件：\`<module>-SXX-<slug>.md\`（如 \`core-S01-cli-init.md\`）
- 测试用例文件：\`<module>-SXX-test-cases.md\`（如 \`core-S01-test-cases.md\`）
- 场景编号全局唯一，由 \`logos-project.yaml\` 的 \`scenario_counter.next_id\` 维护，严禁不同模块从 S01 重新开始
- 多模块状态：\`openlogos status\` 聚合展示所有模块（in-progress 置顶）；\`openlogos next\` 单模块直接建议，多模块并列列出，无 in-progress 时提示 \`module add\``;
  }
  return `Phase detection logic (**when a phase is detected, you MUST read the corresponding Skill file and follow its steps**):
- \`logos/resources/prd/1-product-requirements/\` is empty → Phase 1 → **read \`${skillPath('prd-writer', aiTool, target)}\` and follow its steps**
- requirements exist but \`2-product-design/\` is empty → Phase 2 → **read \`${skillPath('product-designer', aiTool, target)}\` and follow its steps**
- design exists but \`3-technical-plan/1-architecture/\` is empty → Phase 3 Step 0 → **read \`${skillPath('architecture-designer', aiTool, target)}\` and follow its steps**
- architecture exists but \`3-technical-plan/2-scenario-implementation/\` is empty → Phase 3 Step 1 → **read \`${skillPath('scenario-architect', aiTool, target)}\` and follow its steps**
- scenarios exist but \`logos/resources/api/\` is empty → Phase 3 Step 2 → **read \`${skillPath('api-designer', aiTool, target)}\` and \`${skillPath('db-designer', aiTool, target)}\` and follow their steps**
- API exists but \`logos/resources/test/\` is empty → Phase 3 Step 3a → **read \`${skillPath('test-writer', aiTool, target)}\` and follow its steps**
- test cases exist but \`logos/resources/scenario/\` is empty → Phase 3 Step 3b → **read \`${skillPath('test-orchestrator', aiTool, target)}\` and follow its steps** (API projects only)
- orchestration tests exist but \`logos/resources/implementation/\` is empty → Phase 3 Step 4 → **read \`${skillPath('code-implementor', aiTool, target)}\` and follow its steps** (after completion, use \`${skillPath('code-reviewer', aiTool, target)}\` for code review)
- code generated but \`logos/resources/verify/\` is empty → Phase 3 Step 5 (run tests then \`openlogos verify\`)

File naming convention (module prefix):
- All design documents follow \`<module>-<number>-<type>.md\` format; default module is \`core-\` prefix
- Scenario implementation files: \`<module>-SXX-<slug>.md\` (e.g. \`core-S01-cli-init.md\`)
- Test case files: \`<module>-SXX-test-cases.md\` (e.g. \`core-S01-test-cases.md\`)
- Scenario numbers are globally unique, maintained by \`scenario_counter.next_id\` in \`logos-project.yaml\`; never restart from S01 for a new module
- Multi-module status: \`openlogos status\` shows all modules (in-progress first); \`openlogos next\` gives direct suggestion for single module, lists all for multiple, prompts \`module add\` when none in-progress`;
}

function generateStep4ExecutionRules(locale: Locale): string {
  if (locale === 'zh') {
    return `Step 4 执行规则（大任务）：
1. 大任务可按场景/子模块分批实现，但每一批必须闭环
2. 每一批必须同时包含：业务代码 + UT/ST 测试代码 + OpenLogos reporter
3. 输出代码前，先列出本批覆盖的 UT/ST 用例 ID，并确保与 \`logos/resources/test/*.md\` 对齐
4. 不允许将全部测试推迟到最终批次统一补写

Step 4 分批执行提示词（可直接复用）：
- \`请按 Phase 3 Step 4 执行本次实现。若任务较大可分批，但每批必须同时交付：（1）业务代码，（2）对应 UT/ST 测试代码，（3）写入 logos/resources/verify/test-results.jsonl 的 OpenLogos reporter。输出代码前请先列出本批覆盖的 UT/ST 用例 ID。\``;
  }

  return `Step 4 execution rules (large tasks):
1. Large implementation can be split by scenario/module, but each batch must be closed-loop
2. Each batch must include business code + UT/ST test code + OpenLogos reporter
3. Before generating code, list the UT/ST case IDs covered in this batch and keep IDs aligned with \`logos/resources/test/*.md\`
4. Do not postpone all tests to the final batch

Ready-to-use prompt for Step 4 batch execution:
- \`Please execute Phase 3 Step 4 for this scope. If the task is large, split into batches, but each batch must deliver: (1) business code, (2) matching UT/ST test code, (3) OpenLogos reporter writing to logos/resources/verify/test-results.jsonl. Before outputting code, list the UT/ST IDs covered in this batch.\``;
}

function generateDocumentPostEditVerify(locale: Locale): string {
  if (locale === 'zh') {
    return `## 文档修改后的验证（强制）

每次**写入或修改** Markdown / 文本类规格文档（例如 \`logos/resources/\`、\`logos/changes/\`、\`logos/spec/\` 或项目根 \`spec/\` 下的 \`.md\`，以及根目录 \`AGENTS.md\` / \`CLAUDE.md\`）后：

1. **必须**用当前环境可用的方式**从磁盘重新读取**本次修改涉及的片段（例如 Read 工具、或终端 \`sed\` / \`rg\`），向用户展示**文件中的实际原文**（可省略无关段落并标注 \`...\`）。
2. **禁止**仅以自然语言概括「已改为……」作为唯一交付物，而不附带可对照的原文佐证。
3. **例外**：纯 typo 或单字符标点修改时，至少读回**受影响的那一行**，或展示等价的 diff 片段。

**目的**：避免工具声称已保存、但实际未落盘或路径错误导致内容「丢失」而不自知。
`;
  }

  return `## Document Edit Verification (Required)

After every **write or modify** operation on Markdown / text specification files (e.g. \`.md\` under \`logos/resources/\`, \`logos/changes/\`, \`logos/spec/\` or project-root \`spec/\`, plus root \`AGENTS.md\` / \`CLAUDE.md\`):

1. You **MUST** re-read the affected span **from disk** using whatever means the environment provides (e.g. Read tool, or terminal \`sed\` / \`rg\`), and show the user the **actual file text** (you may omit unrelated parts with \`...\`).
2. You **MUST NOT** deliver only a prose summary like "it now says…" without verifiable on-disk excerpts.
3. **Exception**: for pure typos or single-character punctuation fixes, at minimum re-read and show **the affected line** or an equivalent diff hunk.

**Rationale**: avoid silent failures when the model believes the file was saved but the write did not land or the wrong path was used.
`;
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
  'logos/resources/implementation',
  'logos/resources/verify',
  'logos/resources/reference',
  'logos/changes',
  'logos/changes/archive',
];

/** @deprecated use isLaunched: boolean instead */
export type Lifecycle = 'initial' | 'active';

export function createLogosConfig(name: string, locale: Locale, aiTool: AiTool = 'cursor'): string {
  const aiToolValue: AiTool | AiTool[] = aiTool === 'all'
    ? ['claude-code', 'opencode', 'codex', 'cursor']
    : aiTool;
  return JSON.stringify({
    name,
    locale,
    aiTool: aiToolValue,
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
      implementation: {
        label: { en: 'Implementation', zh: '实现清单' },
        path: './resources/implementation',
        pattern: '**/*.md',
      },
      verify: {
        label: { en: 'Verify Reports', zh: '验收报告' },
        path: './resources/verify',
        pattern: '**/*.{jsonl,md}',
      },
      changes: {
        label: { en: 'Change Proposals', zh: '变更提案' },
        path: './changes',
        pattern: '**/*.{md,json}',
      },
    },
    sourceRoots: {
      src: ['src'],
      test: ['test'],
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

scenario_counter:
  next_id: 1

modules:
  - id: core
    name: ${locale === 'zh' ? '核心功能' : 'Core'}
    lifecycle: initial
    # skip_phases: [api, scenario]   # 由 architecture-designer Skill 在技术选型后填写
    # 可选值: api（无 HTTP API）, database（无数据库）, scenario（无 API 编排测试）

resource_index: []

${conventionsForYaml(locale)}
`;
}

export function createAgentsMd(locale: Locale, aiTool?: AiTool, target?: 'agents' | 'claude', isLaunched: boolean = false): string {
  const includeSkills = aiTool && target ? shouldIncludeActiveSkills(aiTool, target) : false;

  const langPolicy = locale === 'zh'
    ? `## ⚠️ 语言策略（最高优先级）

本项目的文档语言为 **中文**（配置于 \`logos/logos.config.json\` → \`locale: "zh"\`）。

**你的所有输出——包括生成的文档、代码注释、回复消息——必须使用中文。**
即使 Skill 文件使用其他语言编写，你的输出也必须是中文。
违反此规则将导致产出不可用。
`
    : `## ⚠️ Language Policy (Highest Priority)

This project's document language is **English** (configured in \`logos/logos.config.json\` → \`locale: "en"\`).

**ALL your output — including generated documents, code comments, and responses — MUST be in English.**
Even if Skill files are written in another language, your output MUST be in English.
Violating this rule will render the output unusable.
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
6. All generated test code must include an OpenLogos reporter (see logos/spec/test-results.md)

## Interaction Guidelines
When the user's request is vague or they ask "what should I do next":
1. Scan \`logos/resources/\` to determine the current project phase
2. Suggest the specific next step based on what's missing
3. Provide a ready-to-use prompt the user can directly say
4. Never start generating documents without confirming key information

${includeSkills ? generatePhaseDetectionWithSkills(locale, aiTool, target) : generatePhaseDetectionPlain(locale)}

${generateStep4ExecutionRules(locale)}

${generateDocumentPostEditVerify(locale)}
`;

  if (includeSkills) {
    const skillAutoLoadInstr = locale === 'zh'
      ? `**重要**：当你识别到当前 Phase 后，必须先读取对应的 Skill 文件（使用上方 Phase 检测逻辑中指定的路径），按 Skill 中定义的步骤逐步执行。不要跳过 Skill 文件直接生成内容。\n`
      : `**IMPORTANT**: When you identify the current Phase, you MUST first read the corresponding Skill file (using the path specified in the Phase detection logic above) and follow its steps sequentially. Do NOT skip the Skill file and generate content directly.\n`;

    content += `
## Active Skills
${skillAutoLoadInstr}
${generateActiveSkillsSection(locale, aiTool, target)}`;
  }

  const changeMgmt = isLaunched
    ? (locale === 'zh'
      ? `## ⛔ 变更管理（强制执行）

### Guard 机制
本项目使用 \`logos/.openlogos-guard\` 锁文件来追踪活跃变更。
- **有 guard 文件** → 可以修改代码，但 **只能在该提案范围内** 修改
- **无 guard 文件** → **禁止修改任何源代码**，必须先运行 \`openlogos change <slug>\`

### 变更流程
1. 运行 \`openlogos change <slug>\` 创建提案（自动写入 guard 文件）
2. 使用 change-writer Skill 填写 \`proposal.md\` + \`tasks.md\`
3. **等待用户确认后** 再开始产出 delta
4. delta 产出完成后提醒用户明确授权运行 \`openlogos merge <slug>\`
5. merge 完成后 AI 自动 commit 规格文档（告知用户，无需确认）
6. 按合并后的规格实现代码，完成后 AI 自动 commit 代码（告知用户，无需确认）
7. 提醒用户运行 \`openlogos verify\` 验收
8. 验收通过后提醒用户明确授权运行 \`openlogos archive <slug>\`（自动删除 guard 文件）
9. archive 完成后 AI 自动 commit 归档（告知用户，无需确认）
10. 提醒用户确认是否执行 \`git push\`（人类确认点）

**\`openlogos merge\`、\`openlogos verify\`、\`openlogos archive\` 和 \`git push\` 是人类确认点。** AI 未经用户明确授权不得自行执行；用户明确要求执行（包括使用对应 slash command）时，AI 可以代为执行。不得在"顺手完成流程"、"按流程走完"等隐式场景中自动触发。

### 行为约束
- **发现 bug/问题时**：只输出分析和修复方案，**禁止直接修改代码**，等待用户决定是否创建变更提案
- **修改代码前**：先确认 guard 文件存在且当前修改在提案范围内
- **唯一例外**：纯 typo 修复（不改变语义）、\`.gitignore\`/\`README.md\` 等非方法论文件

**违反此规则将破坏项目的变更可追溯性。**
`
      : `## ⛔ Change Management (Enforced)

### Guard Mechanism
This project uses \`logos/.openlogos-guard\` lock file to track active changes.
- **Guard file exists** → you may modify code, but **only within the scope of that proposal**
- **No guard file** → **modifying source code is FORBIDDEN** — run \`openlogos change <slug>\` first

### Change Workflow
1. Run \`openlogos change <slug>\` to create a proposal (automatically writes guard file)
2. Fill in \`proposal.md\` + \`tasks.md\` using the change-writer Skill
3. **Wait for user approval** before producing any delta
4. After delta is complete, remind the user to explicitly authorize running \`openlogos merge <slug>\`
5. After merge, AI automatically commits spec documents (inform user, no confirmation needed)
6. Implement code per the updated specs; AI automatically commits code when done (inform user, no confirmation needed)
7. Remind the user to run \`openlogos verify\` for acceptance
8. After verification passes, remind the user to explicitly authorize running \`openlogos archive <slug>\` (auto-removes guard file)
9. After archive, AI automatically commits the archive (inform user, no confirmation needed)
10. Remind the user to confirm whether to run \`git push\` (human confirmation point)

**\`openlogos merge\`, \`openlogos verify\`, \`openlogos archive\`, and \`git push\` are human confirmation points.** AI must not execute them without explicit user authorization. When the user explicitly requests execution (including via the corresponding slash commands), AI may execute them. Must not be triggered implicitly in scenarios like "continue" or "follow the process".

### Behavioral Constraints
- **When you discover a bug/issue**: only output analysis and proposed fix — **do NOT modify code directly** — wait for the user to decide whether to create a change proposal
- **Before modifying code**: verify the guard file exists and your changes are within the proposal scope
- **Only exception**: pure typo fixes (no semantic change), \`.gitignore\`/\`README.md\` and other non-methodology files

**Violating this rule will break the project's change traceability.**
`)
    : (locale === 'zh'
      ? `## 变更管理（当前：初始开发期）

本项目正处于首轮开发阶段，按 Phase 推进即可，无需变更提案。
首轮开发完成后运行 \`openlogos launch\` 激活变更管理。
`
      : `## Change Management (Current: Initial Development)

This project is in its first development cycle — follow the Phase progression, no change proposals needed.
After the first cycle is complete, run \`openlogos launch\` to activate change management.
`);

  const cliRule = locale === 'zh'
    ? `## ⚠️ openlogos CLI 规则

运行任何 \`openlogos\` 命令之前，**必须先 cd 到项目根目录**（即 \`logos/logos.config.json\` 所在目录）。
在子目录（如 \`src/\`、\`src-tauri/\`）下直接运行会导致 \`logos.config.json not found\` 错误。

正确写法：
\`\`\`bash
cd <项目根目录> && openlogos <command>
\`\`\`
`
    : `## ⚠️ openlogos CLI Rule

Before running any \`openlogos\` command, you **MUST cd to the project root** (the directory containing \`logos/logos.config.json\`).
Running from a subdirectory (e.g. \`src/\`, \`src-tauri/\`) will cause a \`logos.config.json not found\` error.

Correct usage:
\`\`\`bash
cd <project-root> && openlogos <command>
\`\`\`
`;

  content += `
${changeMgmt}
${cliRule}
## Conventions
${conventionsForAgentsMd(locale)}
`;

  return content;
}

export async function init(name?: string, options?: { locale?: string; aiTool?: string }) {
  const root = process.cwd();

  if (existsSync(join(root, 'logos', 'logos.config.json'))) {
    console.error('Error: logos/logos.config.json already exists in current directory.');
    console.error('This directory has already been initialized as an OpenLogos project.');
    process.exit(1);
  }

  const locale: Locale = options?.locale === 'zh' ? 'zh' : options?.locale === 'en' ? 'en' : await chooseLocale();
  const aiTool: AiTool = options?.aiTool === 'claude-code' ? 'claude-code' : options?.aiTool === 'opencode' ? 'opencode' : options?.aiTool === 'codex' ? 'codex' : options?.aiTool === 'cursor' ? 'cursor' : options?.aiTool === 'other' ? 'other' : options?.aiTool === 'all' ? 'all' : await chooseAiTool(locale);
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

  writeFileSync(join(root, 'AGENTS.md'), createAgentsMd(locale, aiTool, 'agents', false));
  console.log(`  ✓ AGENTS.md`);

  writeFileSync(join(root, 'CLAUDE.md'), createAgentsMd(locale, aiTool, 'claude', false));
  console.log(`  ✓ CLAUDE.md`);

  const deployTools: AiTool[] = aiTool === 'all' ? ['claude-code', 'opencode', 'codex', 'cursor'] : [aiTool];

  for (const tool of deployTools) {
    const deployResult = deploySkills(root, tool, locale, false);
    if (deployResult && deployResult.count > 0) {
      console.log(`  ✓ ${t(locale, 'init.skillsDeployed', { count: String(deployResult.count), target: deployResult.target })}`);
    }
  }

  if (aiTool === 'opencode' || aiTool === 'all') {
    const pluginResult = deployOpenCodePlugin(root, locale);
    if (pluginResult) {
      console.log(`  ✓ ${t(locale, 'init.opencodePluginDeployed', { target: pluginResult.target })}`);
      if (pluginResult.config.created) {
        console.log(`  ✓ ${t(locale, 'init.opencodeConfigCreated')}`);
      } else if (pluginResult.config.updated) {
        console.log(`  ✓ ${t(locale, 'init.opencodeConfigUpdated')}`);
      }
      if (pluginResult.commandCount > 0) {
        console.log(`  ✓ ${t(locale, 'init.opencodeCommandsDeployed', { count: String(pluginResult.commandCount) })}`);
      }
    }
  }

  if (aiTool === 'codex' || aiTool === 'all') {
    const codexResult = deployCodexPlugin(root, locale);
    if (codexResult) {
      console.log(`  ✓ ${t(locale, 'init.codexPluginDeployed', { target: codexResult.target })}`);
      if (codexResult.config.created) {
        console.log(`  ✓ ${t(locale, 'init.codexConfigCreated')}`);
      } else if (codexResult.config.updated) {
        console.log(`  ✓ ${t(locale, 'init.codexConfigUpdated')}`);
      }
    }
  }

  const specResult = deploySpecs(root);
  if (specResult && specResult.count > 0) {
    console.log(`  ✓ ${specResult.count} specs deployed to logos/spec/`);
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

  if (aiTool === 'claude-code' || aiTool === 'all') {
    const pluginMsg = locale === 'zh'
      ? `💡 Claude Code 用户推荐安装原生插件以获得最佳体验：
  /plugin marketplace add miniidealab/openlogos
  /plugin install openlogos@miniidealab-openlogos`
      : `💡 Claude Code users: install the native plugin for the best experience:
  /plugin marketplace add miniidealab/openlogos
  /plugin install openlogos@miniidealab-openlogos`;
    console.log(pluginMsg + '\n');
  }
}
