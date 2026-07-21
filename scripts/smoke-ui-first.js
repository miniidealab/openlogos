#!/usr/bin/env node
/**
 * 发布后冒烟：proposal-ui-ux-first —— UI-first 契约随 npm 包分发后的关键行为。
 * SMOKE-core-38：openlogos change 生成的 proposal.md 注入「UI/UX 变更声明」段。
 * SMOKE-core-39：ui_impact 原型经 commitVerifiedPrototypes() 落入原型图文件夹（复用路径映射、非 merge-executor）。
 * SMOKE-core-40：guard plan 阶段写入 allowlist 仅放行 2-page-design/*.html。
 * SMOKE-core-41：无段标记 .md delta → openlogos merge 报错停下、不写 SPEC_MERGED（防静默覆盖）。
 *
 * 写 smoke-results.jsonl（OpenLogos smoke reporter）。
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const sha = (s) => createHash('sha256').update(s).digest('hex');

let smokeFailed = false;
function writeSmoke(id, status, error) {
  if (status === 'fail') smokeFailed = true;
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = { id, status, timestamp: new Date().toISOString(), scenario: 'ui-first' };
  if (error) record.error = String(error).slice(0, 500);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

function cliCommand() {
  if (process.env.OPENLOGOS_BIN) return { command: process.env.OPENLOGOS_BIN, baseArgs: [] };
  const distEntry = join(repoRoot, 'cli/dist/index.js');
  if (existsSync(distEntry)) return { command: process.execPath, baseArgs: [distEntry] };
  return { command: 'npx', baseArgs: ['-y', '@miniidealab/openlogos@latest'] };
}

function runCli(root, args) {
  const cli = cliCommand();
  const env = { ...process.env };
  delete env.OPENLOGOS_SMOKE_RESULT_PATH;
  return spawnSync(cli.command, [...cli.baseArgs, ...args], { cwd: root, encoding: 'utf-8', env });
}

function scaffold(root, { gui = false } = {}) {
  mkdirSync(join(root, 'logos', 'changes'), { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {} }, null, 2));
  const modLine = gui
    ? 'modules:\n  - id: core\n    name: core\n    lifecycle: launched\n    product_type: web\n'
    : 'modules:\n  - id: core\n    name: core\n    lifecycle: launched\n';
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), `project:\n  name: t\n${modLine}`);
}

function withTempProject(fn) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-smoke-uifirst-'));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

// SMOKE-core-38：change 注入「UI/UX 变更声明」段
try {
  withTempProject((root) => {
    scaffold(root);
    const res = runCli(root, ['change', 'ui-smoke']);
    const proposal = join(root, 'logos', 'changes', 'ui-smoke', 'proposal.md');
    if (res.status !== 0 || !existsSync(proposal)) throw new Error(`change failed: ${res.stderr || res.stdout}`);
    const content = readFileSync(proposal, 'utf-8');
    if (!/UI\/UX\s*变更声明/.test(content) || !content.includes('ui_impact')) {
      throw new Error('proposal.md missing UI/UX declaration section');
    }
    writeSmoke('SMOKE-core-38', 'pass');
  });
} catch (e) { writeSmoke('SMOKE-core-38', 'fail', e); }

// SMOKE-core-39：ui_impact 原型经 commitVerifiedPrototypes 落盘
try {
  withTempProject((root) => {
    scaffold(root, { gui: true });
    const slug = 'ui-land';
    const pdir = join(root, 'logos', 'changes', slug);
    mkdirSync(join(pdir, 'deltas', 'prd', '2-product-design', '2-page-design'), { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
    writeFileSync(join(pdir, 'proposal.md'),
      `# ${slug}\n\n## UI/UX 变更声明\n\n\`\`\`yaml\nui_impact: true\ndesign_system_mode: generated\npages:\n  - id: home\n    prototype: core-01-home.html\n    description: home\n\`\`\`\n`);
    const proto = join(pdir, 'deltas', 'prd', '2-product-design', '2-page-design', 'core-01-home.html');
    writeFileSync(proto, '<html>HOME</html>');
    writeFileSync(join(pdir, 'PLAN_APPROVED'), JSON.stringify({
      ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('<html>HOME</html>') },
    }));
    const res = runCli(root, ['merge', slug]);
    const landed = join(root, 'logos', 'resources', 'prd', '2-product-design', '2-page-design', 'core-01-home.html');
    if (res.status !== 0) throw new Error(`merge failed: ${res.stderr || res.stdout}`);
    if (!existsSync(landed)) throw new Error('prototype not landed in resources');
    if (sha(readFileSync(landed, 'utf-8')) !== sha('<html>HOME</html>')) throw new Error('landed hash mismatch');
    writeSmoke('SMOKE-core-39', 'pass');
  });
} catch (e) { writeSmoke('SMOKE-core-39', 'fail', e); }

// SMOKE-core-40：guard plan 阶段 allowlist（仅放行 2-page-design/*.html）
try {
  withTempProject((root) => {
    scaffold(root, { gui: true });
    const slug = 'ui-guard';
    const pdir = join(root, 'logos', 'changes', slug);
    mkdirSync(pdir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
    // plan 阶段（无 PLAN_APPROVED）：原型路径放行、非原型拒绝
    const guard = join(repoRoot, 'plugin', 'bin', 'guard-check');
    const call = (rel) => spawnSync('/bin/bash', [guard], {
      cwd: root, encoding: 'utf-8',
      env: { ...process.env, CLAUDE_TOOL_NAME: 'Write', CLAUDE_TOOL_INPUT: JSON.stringify({ file_path: join(root, rel) }) },
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(root, rel) } }),
    });
    const allow = call(`logos/changes/${slug}/deltas/prd/2-product-design/2-page-design/core-01-home.html`);
    const block = call(`logos/changes/${slug}/deltas/prd/2-product-design/1-feature-specs/core-01.md`);
    if (allow.status !== 0) throw new Error(`prototype write should be allowed, got ${allow.status}`);
    if (block.status !== 2) throw new Error(`non-prototype delta should be blocked (2), got ${block.status}`);
    writeSmoke('SMOKE-core-40', 'pass');
  });
} catch (e) { writeSmoke('SMOKE-core-40', 'fail', e); }

// SMOKE-core-41：无段标记 .md delta → merge 报错停下
try {
  withTempProject((root) => {
    scaffold(root);
    const slug = 'ui-badmd';
    const pdir = join(root, 'logos', 'changes', slug);
    mkdirSync(join(pdir, 'deltas', 'prd', '2-product-design', '1-feature-specs'), { recursive: true });
    writeFileSync(join(pdir, 'proposal.md'), '# bad');
    writeFileSync(join(pdir, 'deltas', 'prd', '2-product-design', '1-feature-specs', 'core-01-feature-specs.md'), '# 无段标记正文');
    const res = runCli(root, ['merge', slug]);
    if (res.status === 0) throw new Error('merge should have rejected markerless .md delta');
    if (existsSync(join(pdir, 'SPEC_MERGED'))) throw new Error('SPEC_MERGED must not be written');
    if (existsSync(join(pdir, 'MERGE_PROMPT.md'))) throw new Error('MERGE_PROMPT must not be generated');
    writeSmoke('SMOKE-core-41', 'pass');
  });
} catch (e) { writeSmoke('SMOKE-core-41', 'fail', e); }

function statusData(root) {
  const res = runCli(root, ['status', '--format', 'json']);
  const line = `${res.stdout}\n${res.stderr}`.split('\n').find(l => l.trim().startsWith('{'));
  if (!line) throw new Error(`no status JSON: ${res.stderr || res.stdout}`);
  return JSON.parse(line).data;
}

// SMOKE-core-42：双阶段发布状态 — capability 缺失 → 默认降级、status JSON 无 ui_prototype_render
try {
  withTempProject((root) => {
    scaffold(root, { gui: true });   // 无 .session-capabilities.json
    const data = statusData(root);
    const cap = data.capabilities && data.capabilities.ui_prototype_render;
    if (cap === true) throw new Error('capability should be absent (contract-ready degraded)');
    writeSmoke('SMOKE-core-42', 'pass');
  });
} catch (e) { writeSmoke('SMOKE-core-42', 'fail', e); }

// SMOKE-core-43：双阶段发布状态 — capability 就绪 → status JSON 与两源模板一致 surface
try {
  withTempProject((root) => {
    scaffold(root, { gui: true });
    writeFileSync(join(root, 'logos', '.session-capabilities.json'), JSON.stringify({ ui_prototype_render: true }));
    const data = statusData(root);
    if (!data.capabilities || data.capabilities.ui_prototype_render !== true) {
      throw new Error('status JSON should carry capabilities.ui_prototype_render=true');
    }
    // 两源模板上下文一致 surface
    for (const hook of [join(repoRoot, 'plugin', 'bin', 'openlogos-phase'), join(repoRoot, 'plugin-codex', 'session-start.sh')]) {
      const out = spawnSync('bash', [hook], { cwd: root, encoding: 'utf-8', env: { ...process.env } });
      const ctx = (() => { try { return JSON.parse(out.stdout).hookSpecificOutput.additionalContext; } catch { return `${out.stdout}${out.stderr}`; } })();
      if (!String(ctx).includes('ui_prototype_render=true')) throw new Error(`session template (${hook}) missing capability surface`);
    }
    writeSmoke('SMOKE-core-43', 'pass');
  });
} catch (e) { writeSmoke('SMOKE-core-43', 'fail', e); }

// F4：任一 smoke 失败 → 进程非零退出，令配置的 smoke.command 整体失败（不止写 fail 记录）。
process.exit(smokeFailed ? 1 : 0);
