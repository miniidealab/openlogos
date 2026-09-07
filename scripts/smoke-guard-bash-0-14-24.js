#!/usr/bin/env node
// SMOKE-core-195：0.14.24 guard-check Bash 写命令路径提取与逐路径管辖判定发布全链
// （安装态项目外 rm/cp/mkdir 放行 / 项目内拦截与安全白名单零回归 / 解析不出保守臂）
// + 固定 0.14.23 全外误拦缺陷复现对照 + 0.14.23↔0.14.24 roundtrip。
// guard 行为断言以 stdin JSON + env + cwd 驱动真实随包 guard-check，并同时捕获 stdout 与 stderr 两通道。
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SMOKE_ID = 'SMOKE-core-195';
const EXPECTED_VERSION = '0.14.24';
const ROLLBACK_VERSION = '0.14.23';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try { return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null; } catch { return null; }
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/guard-bash-smoke@1',
    ids: [SMOKE_ID],
    required_env: ['OPENLOGOS_GUARD_BASH_TARBALL', 'OPENLOGOS_GUARD_BASH_ROLLBACK_TARBALL'],
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

if (activeChange() !== 'fix-guard-check-bash-write-target-jurisdiction' && process.env.OPENLOGOS_GUARD_BASH_STAGING !== '1') {
  exitNotApplicable([SMOKE_ID], {
    reason: 'guard bash staging 未就绪：需活跃变更 fix-guard-check-bash-write-target-jurisdiction 或 OPENLOGOS_GUARD_BASH_STAGING=1',
    missing: ['OPENLOGOS_GUARD_BASH_STAGING', 'OPENLOGOS_GUARD_BASH_TARBALL'],
    environment: 'guard-bash-staging',
  });
}

const tarball = process.env.OPENLOGOS_GUARD_BASH_TARBALL;
const rollbackTarball = process.env.OPENLOGOS_GUARD_BASH_ROLLBACK_TARBALL;

function sanitize(value) {
  return String(value).replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>').slice(0, 4000);
}

function writeResult(status, startedAt, error, evidence = []) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id: SMOKE_ID, status, timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt, environment: 'guard-bash-staging', evidence,
  };
  if (error) record.error = sanitize(error);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function checked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot, env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8', timeout: options.timeout || 300000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} 失败：exit ${result.status}\n${result.stderr}`);
  }
  return result;
}

const work = mkdtempSync(join(tmpdir(), 'openlogos-guard-bash-smoke-'));

function installPrefix(file, name) {
  const prefix = join(work, `prefix-${name}`);
  mkdirSync(prefix, { recursive: true });
  checked('npm', ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', file]);
  return {
    entry: join(prefix, 'node_modules/@miniidealab/openlogos/dist/index.js'),
    pkgRoot: join(prefix, 'node_modules/@miniidealab/openlogos'),
  };
}

/** 以 stdin JSON + env + cwd 驱动项目内随包 guard-check（真实脚本、真实字节，双通道捕获）。 */
function runGuard(projDir, toolName, toolInput) {
  const env = { ...process.env };
  env.CLAUDE_PROJECT_DIR = projDir;
  const script = join(projDir, '.claude', 'openlogos', 'bin', 'guard-check');
  const result = spawnSync('bash', [script], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    cwd: projDir, encoding: 'utf8', timeout: 10000, env,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function initClaudeProject(entry, dir) {
  mkdirSync(dir, { recursive: true });
  checked(process.execPath, [entry, 'init', 'demo', '--locale', 'zh', '--ai-tool', 'claude-code'], { cwd: dir });
  // 置 launched（guard 硬闸只在 launched 生效）
  writeFileSync(join(dir, 'logos', 'logos-project.yaml'),
    'project:\n  name: "demo"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
  mkdirSync(join(dir, 'src'), { recursive: true });
  return dir;
}

/** 项目外目标目录（session scratchpad 形态与临时 HOME 下 ~/.claude 形态，不触真实 HOME）。 */
function externalDirs(name) {
  const scratch = join(work, `scratch-${name}`, 'session');
  const fakeHome = join(work, `home-${name}`);
  mkdirSync(scratch, { recursive: true });
  mkdirSync(join(fakeHome, '.claude', 'projects', 'demo', 'memory'), { recursive: true });
  return { scratch, memory: join(fakeHome, '.claude', 'projects', 'demo', 'memory', 'a.md') };
}

const startedAt = Date.now();
try {
  if (!tarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_GUARD_BASH_TARBALL'), { __skip: true });
  if (!rollbackTarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_GUARD_BASH_ROLLBACK_TARBALL'), { __skip: true });
  const evidence = [];

  // ① candidate identity（含随包 guard-check 路径提取新字节与 manifest 条目）
  const candidate = installPrefix(tarball, 'candidate');
  const version = checked(process.execPath, [candidate.entry, '--version']).stdout.trim();
  if (version !== EXPECTED_VERSION) throw new Error(`candidate 版本漂移：${version}`);
  const bundledGuard = readFileSync(join(candidate.pkgRoot, 'claude-plugin-template', 'bin', 'guard-check'), 'utf8');
  if (!bundledGuard.includes('fix-guard-check-bash-write-target-jurisdiction')) {
    throw new Error('随包 guard-check 缺 Bash 路径提取判定（旧字节）');
  }
  if (!bundledGuard.includes("'^(rm|cp|mv|mkdir|touch|chmod|chown) '")) {
    throw new Error('随包 guard-check 缺路径提取命令族模式（旧字节）');
  }
  const manifest = JSON.parse(readFileSync(join(candidate.pkgRoot, 'asset-manifest.json'), 'utf8'));
  const guardEntry = (manifest.plugins ?? []).find(item => item.path === 'claude-plugin-template/bin/guard-check');
  if (!guardEntry) throw new Error('asset-manifest 缺 guard-check 托管条目');
  const bundledSha = createHash('sha256').update(bundledGuard).digest('hex');
  if (guardEntry.sha256 !== bundledSha) throw new Error('asset-manifest guard-check 哈希与随包字节不一致');
  evidence.push(`candidate=${EXPECTED_VERSION} sha256:${sha256(tarball)}`);

  // ②③④ 在同一新项目上验证路径级管辖判定与项目内零回归
  const verifyFixes = (proj, label) => {
    const { scratch, memory } = externalDirs(label);
    // ② 项目外放行：全外路径实参的 rm/cp/mkdir → exit 0
    const externalCommands = [
      `rm -rf ${join(scratch, 'work')}`,
      `cp ${memory} ${join(scratch, 'copy.md')}`,
      `mkdir -p ${join(scratch, 'new', 'deep')}`,
      `touch ${join(scratch, 'stamp.txt')}`,
      `mv ${join(scratch, 'a.txt')} ${join(scratch, 'b.txt')}`,
    ];
    for (const command of externalCommands) {
      const external = runGuard(proj, 'Bash', { command });
      if (external.exitCode !== 0) throw new Error(`[${label}] 全外路径写命令被误拦：${command}（exit ${external.exitCode}）`);
    }
    // ③ 项目内拦截零回归：任一路径在内（含混合形态）→ exit 2 双通道；白名单/安全白名单/重定向不变
    for (const command of [
      `rm ${join(proj, 'src', 'app.ts')}`,
      `cp ${memory} ${join(proj, 'src', 'b.ts')}`,
    ]) {
      const blocked = runGuard(proj, 'Bash', { command });
      if (blocked.exitCode !== 2) throw new Error(`[${label}] 项目内路径写命令未被拦：${command}（exit ${blocked.exitCode}）`);
      const parsed = JSON.parse(blocked.stdout);
      if (typeof parsed.reason !== 'string' || !parsed.reason.includes('变更管理拦截')) {
        throw new Error(`[${label}] stdout JSON reason 结构漂移：${blocked.stdout.slice(0, 120)}`);
      }
      if (!blocked.stderr.includes('变更管理拦截') || !blocked.stderr.includes('openlogos change')) {
        throw new Error(`[${label}] 拦截 stderr 缺可操作指引：${JSON.stringify(blocked.stderr.slice(0, 120))}`);
      }
    }
    const whitelisted = runGuard(proj, 'Bash', { command: `touch ${join(proj, 'logos', 'changes', 'x', 'p.md')}` });
    if (whitelisted.exitCode !== 0) throw new Error(`[${label}] 白名单目标被拦：exit ${whitelisted.exitCode}`);
    const gitPush = runGuard(proj, 'Bash', { command: 'git push origin master' });
    if (gitPush.exitCode !== 0) throw new Error(`[${label}] git push 安全白名单被拦：exit ${gitPush.exitCode}`);
    const internalRedirect = runGuard(proj, 'Bash', { command: `node build.js > ${join(proj, 'src', 'out.log')}` });
    if (internalRedirect.exitCode !== 2) throw new Error(`[${label}] 项目内重定向判定回归：exit ${internalRedirect.exitCode}`);
    // ④ 解析不出保守臂：$VAR / $(…) / && 复合 → 维持拦截
    for (const command of [
      'rm -rf $SCRATCH/x',
      `rm $(cat ${join(scratch, 'list.txt')})`,
      `rm ${join(scratch, 'a.txt')} && rm ${join(scratch, 'b.txt')}`,
    ]) {
      const conservative = runGuard(proj, 'Bash', { command });
      if (conservative.exitCode !== 2) throw new Error(`[${label}] 解析不出形态被放行：${command}（exit ${conservative.exitCode}）`);
    }
    // 有提案（guard 文件在场）→ 放行
    writeFileSync(join(proj, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
    const withProposal = runGuard(proj, 'Bash', { command: `rm ${join(proj, 'src', 'app.ts')}` });
    if (withProposal.exitCode !== 0) throw new Error(`[${label}] 有提案仍被拦：exit ${withProposal.exitCode}`);
    rmSync(join(proj, 'logos', '.openlogos-guard'));
  };
  verifyFixes(initClaudeProject(candidate.entry, join(work, 'p-fix')), 'candidate');
  evidence.push('项目外放行 + 项目内拦截零回归 + 解析不出保守臂 通过');

  // ⑤ 0.14.23 对照：全外路径写命令必须复现误拦截（防断言空转）
  const rollback = installPrefix(rollbackTarball, 'rollback');
  const rollbackVersion = checked(process.execPath, [rollback.entry, '--version']).stdout.trim();
  if (rollbackVersion !== ROLLBACK_VERSION) throw new Error(`回滚版本漂移：${rollbackVersion}`);
  const contrast = initClaudeProject(rollback.entry, join(work, 'p-contrast'));
  const { scratch: contrastScratch } = externalDirs('contrast');
  for (const command of [
    `rm -rf ${join(contrastScratch, 'work')}`,
    `cp ${join(contrastScratch, 'a.txt')} ${join(contrastScratch, 'b.txt')}`,
  ]) {
    const oldExternal = runGuard(contrast, 'Bash', { command });
    if (oldExternal.exitCode !== 2) {
      throw new Error(`对照空转：0.14.23 全外路径写命令未误拦截（${command}，exit ${oldExternal.exitCode}），矩阵必须重写`);
    }
  }
  // 对照侧安全面一致：项目内拦截与安全白名单在 0.14.23 上同判（本次只放宽全外形态）
  const oldBlocked = runGuard(contrast, 'Bash', { command: `rm ${join(contrast, 'src', 'app.ts')}` });
  if (oldBlocked.exitCode !== 2) throw new Error(`对照异常：0.14.23 项目内写命令未被拦（exit ${oldBlocked.exitCode}）`);
  const oldGitPush = runGuard(contrast, 'Bash', { command: 'git push origin master' });
  if (oldGitPush.exitCode !== 0) throw new Error(`对照异常：0.14.23 git push 被拦（exit ${oldGitPush.exitCode}）`);
  evidence.push('0.14.23 全外误拦缺陷复现对照有效（项目内拦截与安全白名单同判）');

  // ⑥ roundtrip：0.14.23→0.14.24 恢复后 identity 与判定结论不变
  const restored = installPrefix(tarball, 'restore');
  const restoredVersion = checked(process.execPath, [restored.entry, '--version']).stdout.trim();
  if (restoredVersion !== EXPECTED_VERSION) throw new Error('roundtrip 恢复失败');
  verifyFixes(initClaudeProject(restored.entry, join(work, 'p-roundtrip')), 'roundtrip');
  evidence.push(`roundtrip ${ROLLBACK_VERSION}→${EXPECTED_VERSION} 无混装且判定结论不变`);

  writeResult('pass', startedAt, null, evidence);
  console.log(`✓ ${SMOKE_ID}`);
} catch (error) {
  if (error && error.__skip) {
    writeResult('skip', startedAt, error.message, []);
    console.log(`- ${SMOKE_ID} skip: ${error.message}`);
  } else {
    writeResult('fail', startedAt, error instanceof Error ? error.message : String(error), []);
    console.error(`✗ ${SMOKE_ID}: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
