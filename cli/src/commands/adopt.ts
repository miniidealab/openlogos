import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  type AiTool,
  parseAiTool,
  detectProjectName,
  createLogosConfig,
  createAdoptLogosProject,
  createAgentsMd,
  chooseAiTool,
  ensureVerifyPreRunConfig,
  printVerifyPreRunBackfillResult,
  deployAiToolAssets,
  deploySpecs,
  expandAiTools,
  resolveDocsAiToolForTarget,
} from './init.js';
import type { Locale } from '../i18n.js';

const DIRECTORIES = [
  'logos/resources/prd/1-product-requirements',
  'logos/resources/prd/2-product-design/1-feature-specs',
  'logos/resources/prd/2-product-design/2-page-design',
  'logos/resources/prd/3-technical-plan/1-architecture',
  'logos/resources/prd/3-technical-plan/2-scenario-implementation',
  'logos/resources/prd/3-technical-plan/3-deployment',
  'logos/resources/api',
  'logos/resources/database',
  'logos/resources/test',
  'logos/resources/test/smoke',
  'logos/resources/scenario',
  'logos/resources/implementation',
  'logos/resources/verify',
  'logos/resources/reference',
  'logos/changes',
  'logos/changes/archive',
];

function isTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}

async function chooseLocale(): Promise<Locale> {
  if (!isTTY()) return 'zh';

  console.log('\nChoose language / 选择语言:');
  console.log('  1. 中文 (default)');
  console.log('  2. English\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return await new Promise<Locale>((resolve) => {
    rl.question('Your choice [1/2] (default: 1): ', (answer) => {
      rl.close();
      resolve(answer === '2' ? 'en' : 'zh');
    });
  });
}

function writeInstructionFiles(root: string, locale: Locale, rawAiTool: unknown) {
  writeFileSync(join(root, 'AGENTS.md'), createAgentsMd(locale, resolveDocsAiToolForTarget(rawAiTool, 'agents'), 'agents', true));
  writeFileSync(join(root, 'CLAUDE.md'), createAgentsMd(locale, resolveDocsAiToolForTarget(rawAiTool, 'claude'), 'claude', true));
}

function ensureDirectories(root: string) {
  for (const dir of DIRECTORIES) {
    const fullPath = join(root, dir);
    mkdirSync(fullPath, { recursive: true });
    const gitkeep = join(fullPath, '.gitkeep');
    if (!existsSync(gitkeep)) {
      writeFileSync(gitkeep, '');
    }
  }
}

function detectSourceLabel(root: string): string {
  if (existsSync(join(root, 'package.json'))) return 'package.json';
  if (existsSync(join(root, 'Cargo.toml'))) return 'Cargo.toml';
  if (existsSync(join(root, 'pyproject.toml'))) return 'pyproject.toml';
  return 'directory';
}

export async function adopt(name?: string, options?: { locale?: string; aiTool?: string }) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');
  const yamlPath = join(root, 'logos', 'logos-project.yaml');

  if (existsSync(configPath)) {
    console.error('✗ 该项目已初始化（logos/logos.config.json 已存在）');
    console.error('  若要重新配置，请先备份并删除 logos/ 目录。');
    process.exit(1);
  }

  const locale: Locale = options?.locale === 'en'
    ? 'en'
    : options?.locale === 'zh'
      ? 'zh'
      : await chooseLocale();

  let aiTool: AiTool;
  if (options?.aiTool !== undefined) {
    const parsedAiTool = parseAiTool(options.aiTool);
    if (!parsedAiTool) {
      console.error(`Error: unsupported AI tool "${options.aiTool}".`);
      console.error('Supported values: claude-code, opencode, codex, cursor, other, all');
      process.exit(1);
    }
    aiTool = parsedAiTool;
  } else {
    aiTool = await chooseAiTool(locale);
  }

  const detected = detectProjectName(root);
  const projectName = name?.trim() || detected.name;
  const sourceLabel = detectSourceLabel(root);

  console.log('\n$ openlogos adopt\n');
  console.log(`? 检测到已有项目：${projectName}（来自 ${sourceLabel}）`);
  console.log(`? 文档语言 (locale)：${locale}`);
  console.log(`? AI 工具：${aiTool}\n`);
  console.log('✓ 读取项目信息完成\n');

  ensureDirectories(root);
  console.log('✓ 创建 logos/ 标准目录结构');

  const config = JSON.parse(createLogosConfig(projectName, locale, aiTool)) as Record<string, unknown>;
  const verifyBackfill = ensureVerifyPreRunConfig(root, config);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✓ 写入 logos.config.json');
  printVerifyPreRunBackfillResult(locale, verifyBackfill, '');

  writeFileSync(yamlPath, createAdoptLogosProject(projectName, locale));
  console.log('✓ 写入 logos-project.yaml（bootstrap: skipped, lifecycle: launched）');

  writeInstructionFiles(root, locale, aiTool);
  console.log('✓ 写入 AGENTS.md / CLAUDE.md');

  const deployTools = expandAiTools(aiTool);
  deployAiToolAssets(root, deployTools, locale, true, 'deployed');
  const specResult = deploySpecs(root);
  if (specResult && specResult.count > 0) {
    console.log(`✓ ${specResult.count} specs deployed to logos/spec/`);
  }

  console.log('\n🎉 已有项目接入完成！\n');
  console.log('项目已进入快速接入模式（bootstrap: skipped）：');
  console.log('  · Phase 1~3 文档基线已跳过，不强制要求');
  console.log('  · 模块生命周期直接设为 launched\n');
  console.log('建议的下一步：先补充项目基线文档');
  console.log('  → openlogos change add-baseline-docs');
  console.log('  在变更提案中逐步补写需求、架构、场景、测试用例，');
  console.log('  把 TDD 思想贯彻到每一次迭代中。\n');
}
