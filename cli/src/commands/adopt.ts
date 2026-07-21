import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  type AiTool,
  parseAiTool,
  detectProjectName,
  createLogosConfig,
  createAdoptLogosProject,
  chooseAiTool,
  DIRECTORIES,
  ensureVerifyPreRunConfig,
  printVerifyPreRunBackfillResult,
  deployAiToolAssets,
  deploySpecs,
  expandAiTools,
  writeInstructionFiles,
} from './init.js';
import type { Locale } from '../i18n.js';

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
  console.log('✓ 写入 logos-project.yaml（bootstrap: adopted, lifecycle: launched）');
  console.log('✓ 标记待建现状基线（baseline_seed_state: required）');

  writeInstructionFiles(root, locale, aiTool, true);
  console.log('✓ 写入 AGENTS.md / CLAUDE.md');

  const deployTools = expandAiTools(aiTool);
  deployAiToolAssets(root, deployTools, locale, true, 'deployed');
  const specResult = deploySpecs(root);
  if (specResult && specResult.count > 0) {
    console.log(`✓ ${specResult.count} specs deployed to logos/spec/`);
  }

  console.log('\n🎉 已有项目接入完成！\n');
  console.log('项目已进入存量项目接入模式（bootstrap: adopted）：');
  console.log('  · OpenLogos 基础设施已完整初始化');
  console.log('  · Initial 文档基线已跳过，不强制要求');
  console.log('  · 模块生命周期直接设为 launched');
  console.log('  · 现状基线待建立（baseline_seed_state: required）\n');
  console.log('建议的下一步：逆向建立现状基线（种子基线，非权威意图）');
  console.log('  由 AI 会话/driver 逆向扫描代码库，产出 system-map + 场景候选清单，');
  console.log('  每份产物带 provenance 标记（reverse-engineered / verified: false）。');
  console.log('  存量代码 grandfather 豁免，可信边界随后续 change 触碰而前移。\n');
  // 能力降级语义（F2）：adopt 只做确定性初始化并写入 baseline_seed_state: required；
  // 绝不启动 AI、不产逆向内容、不声称基线已建立。逆向扫描由 AI 会话/driver 检测该状态后派发 brownfield-adopter 完成。
  if (!isTTY()) {
    console.log('⚠ 未检测到可用的 AI 会话来逆向建立现状基线。');
    console.log('  现状基线仍待建立（baseline_seed_state: required）。');
    console.log('  请在支持 brownfield-adopter 的 AI 会话中继续，或稍后重试。\n');
  }
}
