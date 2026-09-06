#!/usr/bin/env node
// SMOKE-core-193：0.14.22 guard 两处修复发布全链（管辖边界：项目外路径放行 / 阻断 reason stderr 可见 /
// fail-closed stderr / 项目内零回归）+ 固定 0.14.21 误拦截与空 stderr 缺陷复现对照 + roundtrip。
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

const SMOKE_ID = 'SMOKE-core-193';
const EXPECTED_VERSION = '0.14.22';
const ROLLBACK_VERSION = '0.14.21';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try { return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null; } catch { return null; }
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/guard-fix-smoke@1',
    ids: [SMOKE_ID],
    required_env: ['OPENLOGOS_GUARD_FIX_TARBALL', 'OPENLOGOS_GUARD_FIX_ROLLBACK_TARBALL'],
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

if (activeChange() !== 'fix-guard-check-external-path-and-stderr' && process.env.OPENLOGOS_GUARD_FIX_STAGING !== '1') {
  exitNotApplicable([SMOKE_ID], {
    reason: 'guard fix staging 未就绪：需活跃变更 fix-guard-check-external-path-and-stderr 或 OPENLOGOS_GUARD_FIX_STAGING=1',
    missing: ['OPENLOGOS_GUARD_FIX_STAGING', 'OPENLOGOS_GUARD_FIX_TARBALL'],
    environment: 'guard-fix-staging',
  });
}

const tarball = process.env.OPENLOGOS_GUARD_FIX_TARBALL;
const rollbackTarball = process.env.OPENLOGOS_GUARD_FIX_ROLLBACK_TARBALL;

function sanitize(value) {
  return String(value).replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>').slice(0, 4000);
}

function writeResult(status, startedAt, error, evidence = []) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id: SMOKE_ID, status, timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt, environment: 'guard-fix-staging', evidence,
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

const work = mkdtempSync(join(tmpdir(), 'openlogos-guard-fix-smoke-'));

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
function runGuard(projDir, cwd, toolName, toolInput, projectDirEnv) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDirEnv) env.CLAUDE_PROJECT_DIR = projectDirEnv;
  const script = join(projDir, '.claude', 'openlogos', 'bin', 'guard-check');
  const result = spawnSync('bash', [script], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    cwd, encoding: 'utf8', timeout: 10000, env,
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

/** 在临时 HOME 形态目录下构造用户级 ~/.claude 记忆文件路径（不触真实 HOME）。 */
function externalMemoryPath(name) {
  const fakeHome = join(work, `home-${name}`);
  mkdirSync(fakeHome, { recursive: true });
  return join(fakeHome, '.claude', 'projects', 'demo', 'memory', 'a.md');
}

const startedAt = Date.now();
try {
  if (!tarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_GUARD_FIX_TARBALL'), { __skip: true });
  if (!rollbackTarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_GUARD_FIX_ROLLBACK_TARBALL'), { __skip: true });
  const evidence = [];

  // ① candidate identity（含随包 guard-check 新字节与 manifest 条目）
  const candidate = installPrefix(tarball, 'candidate');
  const version = checked(process.execPath, [candidate.entry, '--version']).stdout.trim();
  if (version !== EXPECTED_VERSION) throw new Error(`candidate 版本漂移：${version}`);
  const bundledGuard = readFileSync(join(candidate.pkgRoot, 'claude-plugin-template', 'bin', 'guard-check'), 'utf8');
  if (!bundledGuard.includes('Jurisdiction boundary')) throw new Error('随包 guard-check 缺管辖边界判定（旧字节）');
  if (!bundledGuard.includes(`printf '%b\\n' "$msg" >&2`)) throw new Error('随包 guard-check 缺 block() stderr 输出（旧字节）');
  const manifest = JSON.parse(readFileSync(join(candidate.pkgRoot, 'asset-manifest.json'), 'utf8'));
  const guardEntry = (manifest.plugins ?? []).find(item => item.path === 'claude-plugin-template/bin/guard-check');
  if (!guardEntry) throw new Error('asset-manifest 缺 guard-check 托管条目');
  const bundledSha = createHash('sha256').update(bundledGuard).digest('hex');
  if (guardEntry.sha256 !== bundledSha) throw new Error('asset-manifest guard-check 哈希与随包字节不一致');
  evidence.push(`candidate=${EXPECTED_VERSION} sha256:${sha256(tarball)}`);

  // ②③④ 在同一新项目上验证两处修复与项目内零回归
  const verifyFixes = (proj, label) => {
    // ② 管辖边界：项目外目标（临时 HOME 下 ~/.claude 形态路径、另一临时仓库绝对路径）→ exit 0 放行
    const memoryTarget = externalMemoryPath(label);
    const otherRepo = join(work, `repo-${label}`, 'src', 'x.ts');
    mkdirSync(dirname(otherRepo), { recursive: true });
    for (const target of [memoryTarget, otherRepo]) {
      const external = runGuard(proj, proj, 'Edit', { file_path: target }, proj);
      if (external.exitCode !== 0) throw new Error(`[${label}] 项目外目标被误拦：${target}（exit ${external.exitCode}）`);
    }
    // ③ 阻断 stderr 可见性：项目内源码 → exit 2 + stderr 含指引 + stdout JSON 结构不变
    const blocked = runGuard(proj, proj, 'Edit', { file_path: join(proj, 'src', 'app.ts') }, proj);
    if (blocked.exitCode !== 2) throw new Error(`[${label}] 项目内无提案 Edit 未被拦：exit ${blocked.exitCode}`);
    const parsed = JSON.parse(blocked.stdout);
    if (typeof parsed.reason !== 'string' || !parsed.reason.includes('变更管理拦截')) {
      throw new Error(`[${label}] stdout JSON reason 结构漂移：${blocked.stdout.slice(0, 120)}`);
    }
    if (!blocked.stderr.includes('变更管理拦截') || !blocked.stderr.includes('openlogos change')) {
      throw new Error(`[${label}] 拦截 stderr 缺可操作指引：${JSON.stringify(blocked.stderr.slice(0, 120))}`);
    }
    // ③ Step 0 fail-closed 两形态 → exit 2 且 stderr 非空
    const badVar = runGuard(proj, proj, 'Edit', { file_path: join(proj, 'src', 'app.ts') }, join(work, 'no-such-dir'));
    if (badVar.exitCode !== 2 || badVar.stderr.length === 0) {
      throw new Error(`[${label}] 变量坏目录 fail-closed stderr 缺失：exit ${badVar.exitCode}`);
    }
    const noVar = runGuard(proj, join(proj, 'src'), 'Edit', { file_path: join(proj, 'src', 'app.ts') }, null);
    if (noVar.exitCode !== 2 || noVar.stderr.length === 0) {
      throw new Error(`[${label}] 变量缺失非根 fail-closed stderr 缺失：exit ${noVar.exitCode}`);
    }
    // ④ 项目内零回归：白名单路径 / guard 文件在场 / git push 安全白名单
    const whitelisted = runGuard(proj, proj, 'Edit', { file_path: join(proj, 'logos', 'changes', 'x', 'p.md') }, proj);
    if (whitelisted.exitCode !== 0) throw new Error(`[${label}] 白名单路径被拦：exit ${whitelisted.exitCode}`);
    const gitPush = runGuard(proj, proj, 'Bash', { command: 'git push origin master' }, proj);
    if (gitPush.exitCode !== 0) throw new Error(`[${label}] git push 安全白名单被拦：exit ${gitPush.exitCode}`);
    writeFileSync(join(proj, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
    const withProposal = runGuard(proj, proj, 'Edit', { file_path: join(proj, 'src', 'app.ts') }, proj);
    if (withProposal.exitCode !== 0) throw new Error(`[${label}] 有提案仍被拦：exit ${withProposal.exitCode}`);
    rmSync(join(proj, 'logos', '.openlogos-guard'));
  };
  verifyFixes(initClaudeProject(candidate.entry, join(work, 'p-fix')), 'candidate');
  evidence.push('管辖边界放行 + 拦截 stderr 双通道 + fail-closed stderr + 项目内零回归 通过');

  // ⑤ 0.14.21 对照：误拦截与空 stderr 必须复现（防断言空转）
  const rollback = installPrefix(rollbackTarball, 'rollback');
  const rollbackVersion = checked(process.execPath, [rollback.entry, '--version']).stdout.trim();
  if (rollbackVersion !== ROLLBACK_VERSION) throw new Error(`回滚版本漂移：${rollbackVersion}`);
  const contrast = initClaudeProject(rollback.entry, join(work, 'p-contrast'));
  const contrastMemory = externalMemoryPath('contrast');
  const oldExternal = runGuard(contrast, contrast, 'Edit', { file_path: contrastMemory }, contrast);
  if (oldExternal.exitCode !== 2) {
    throw new Error(`对照空转：0.14.21 项目外目标未误拦截（exit ${oldExternal.exitCode}），矩阵必须重写`);
  }
  const oldBlocked = runGuard(contrast, contrast, 'Edit', { file_path: join(contrast, 'src', 'app.ts') }, contrast);
  if (oldBlocked.exitCode !== 2) throw new Error(`对照异常：0.14.21 项目内无提案 Edit 未被拦（exit ${oldBlocked.exitCode}）`);
  if (oldBlocked.stderr.length !== 0) {
    throw new Error(`对照空转：0.14.21 拦截 stderr 非空（${JSON.stringify(oldBlocked.stderr.slice(0, 80))}），矩阵必须重写`);
  }
  evidence.push('0.14.21 误拦截与空 stderr 缺陷复现对照有效');

  // ⑥ roundtrip：0.14.21→0.14.22 恢复后 identity 与两处修复结论不变
  const restored = installPrefix(tarball, 'restore');
  const restoredVersion = checked(process.execPath, [restored.entry, '--version']).stdout.trim();
  if (restoredVersion !== EXPECTED_VERSION) throw new Error('roundtrip 恢复失败');
  verifyFixes(initClaudeProject(restored.entry, join(work, 'p-roundtrip')), 'roundtrip');
  evidence.push(`roundtrip ${ROLLBACK_VERSION}→${EXPECTED_VERSION} 无混装且修复结论不变`);

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
