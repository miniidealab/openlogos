#!/usr/bin/env node
/**
 * 把本仓可共享的 verify.requirements 声明（scripts/repo-verify-requirements.json）应用到真实项目配置
 * logos/logos.config.json（verify-self-sufficient-cases，评审 code-r2 F4）。
 *
 * 根目录 logos/ 按 .gitignore 只留本机、不入库；CI 等干净检出没有项目配置，ST-S13-43 要读的检查声明因此缺失。
 * 本脚本由 cli 的 `npm test` 前置钩子（pretest）调用，在检出目录中：
 *   - 配置不存在：只用可共享声明建立最小配置 { verify: { requirements: { checks } } }（不写任何本机专属路径）；
 *   - 配置存在：按 name 补齐缺少的检查；同名而命令不同视为本机配置与可共享声明漂移，报错退出 1、不改写；
 *   - 已齐全：不写文件（本机已有完整配置时零改动）。
 * 用法：node scripts/apply-repo-verify-requirements.mjs [仓库根，默认为本脚本上一级目录]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function applyRepoVerifyRequirements(repoRoot) {
  const decl = JSON.parse(readFileSync(join(repoRoot, 'scripts', 'repo-verify-requirements.json'), 'utf8'));
  const wanted = Array.isArray(decl.checks) ? decl.checks : [];
  const configPath = join(repoRoot, 'logos', 'logos.config.json');
  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({ verify: { requirements: { checks: wanted } } }, null, 2)}\n`);
    return { action: 'created', added: wanted.map(c => c.name) };
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const verify = (config.verify ??= {});
  const requirements = (verify.requirements ??= {});
  const checks = (requirements.checks ??= []);
  const added = [];
  for (const check of wanted) {
    const existing = checks.find(c => c && c.name === check.name);
    if (!existing) { checks.push({ ...check }); added.push(check.name); continue; }
    if (existing.command !== check.command) {
      throw new Error(`logos/logos.config.json 的检查 ${check.name} 命令为 ${JSON.stringify(existing.command)}，与可共享声明 ${JSON.stringify(check.command)} 不一致；请人工对齐后重试`);
    }
  }
  if (added.length === 0) return { action: 'unchanged', added };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { action: 'updated', added };
}

function invokedAsEntry() {
  try { return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}

if (invokedAsEntry()) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  try {
    const r = applyRepoVerifyRequirements(root);
    if (r.action !== 'unchanged') console.log(`repo verify.requirements ${r.action}: ${r.added.join(', ')}`);
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
