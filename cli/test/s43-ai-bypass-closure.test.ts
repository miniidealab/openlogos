/**
 * environment-promotion-approval 切片 4：封堵 AI 绕道——deploy-done 受门拒绝、--auto 硬停与审批后续跑、生成指令硬红线（S43）。
 *
 * 覆盖 UT-S43-11、UT-S43-13、ST-S43-03、ST-S43-04（logos/resources/test/core-S43-test-cases.md）。
 * 规范源：spec/environments.md §12.6、§12.7；spec/change-management.md 硬红线（C03，D14）；spec/pretooluse-guard.md
 * 「已配置门禁的环境登记表」。一次性 git 项目，活跃提案处于 ready-to-deploy（VERIFY_PASS + LOOP_ITERS pass），
 * guard 判定以真实 plugin/bin/guard-check 与构造的 PreToolUse 输入执行；CLI 走真实入口 cli/dist/index.js。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, writeLoopPass } from './helpers.js';
import { DEPLOY_LEDGER_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const GUARD = resolve(HERE, '../../plugin/bin/guard-check');
const SLUG = 'ship-it';
const SCRIPT = `#!/bin/sh
mkdir -p "$PUBLISH_DIR"
echo "start $OPENLOGOS_DEPLOY_ENV $OPENLOGOS_DEPLOY_REF" >> "$PUBLISH_DIR/starts.txt"
`;
const SCRIPT_CFG = { mode: 'script', script: 'deploy/run.sh' };

let root: string;
let work: string;
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const proposalDir = () => join(root, 'logos/changes', SLUG);
const publish = () => join(work, 'publish');
const starts = (): string[] => (existsSync(join(publish(), 'starts.txt')) ? readFileSync(join(publish(), 'starts.txt'), 'utf-8').trim().split('\n') : []);

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** 一次性项目：test（无门、配置 deploy）与 prod（按参数配置门禁）；活跃提案处于 ready-to-deploy。 */
function setup(prodGate: Record<string, unknown>): void {
  const tmp = makeTempRoot();
  cleanups.push(tmp.cleanup);
  root = tmp.root;
  work = `${root}-work`;
  mkdirSync(work, { recursive: true });
  cleanups.push(() => rmSync(work, { recursive: true, force: true }));
  scaffoldProject(root, { locale: 'en' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }, { lineWidth: 0 }));
  put('logos/resources/verify/deployment-report.md', '# Deployment Report\n\nhistory\n');
  put(ENV_REGISTRY_REL, stringifyYaml({
    schema_version: 1,
    environments: [
      { id: 'staging', name: 'Staging', tier: 'staging', deploy: SCRIPT_CFG },
      { id: 'test', name: 'Test', tier: 'test', deploy: SCRIPT_CFG },
      { id: 'prod', name: 'Production', tier: 'prod', deploy: SCRIPT_CFG, ...prodGate },
    ],
  }, { lineWidth: 0 }));
  mkdirSync(proposalDir(), { recursive: true });
  writeFileSync(join(proposalDir(), 'proposal.md'), [
    '# 变更提案：ship-it', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：生产',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
  ].join('\n'));
  writeFileSync(join(proposalDir(), 'tasks.md'), ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布'].join('\n'));
  writeFileSync(join(proposalDir(), 'VERIFY_PASS'), '');
  writeLoopPass(proposalDir());
  put('logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core', createdAt: new Date().toISOString() }));
  put('.gitignore', `logos/.openlogos-runtime/\n${ENV_REGISTRY_REL}\n`);
  git(['init', '-q']);
  git(['config', 'user.name', 'Alice']);
  git(['config', 'user.email', 'alice@example.invalid']);
  put('deploy/run.sh', SCRIPT);
  chmodSync(join(root, 'deploy/run.sh'), 0o755);
  git(['add', '-A']);
  git(['commit', '-qm', 'v1']);
}

function json(args: string[]): { status: number | null; data: any; error: any; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args, '--format', 'json'], {
    cwd: root, encoding: 'utf-8', timeout: 120_000, env: { ...process.env, PUBLISH_DIR: publish() },
  });
  let data = null;
  let error = null;
  try { data = JSON.parse(r.stdout).data; } catch { /* 失败路径无 stdout */ }
  try { error = JSON.parse(r.stderr).error; } catch { /* 成功路径无 stderr envelope */ }
  return { status: r.status, data, error, stderr: r.stderr };
}

/** 当前活跃提案的 proposal_step（取自 openlogos next --format json）。 */
function proposalStep(): string | null {
  const r = json(['next']);
  expect(r.status, r.stderr).toBe(0);
  let found: string | null = null;
  const walk = (v: unknown) => {
    if (found !== null || v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'proposal_step' && typeof x === 'string') { found = x; return; }
      walk(x);
    }
  };
  walk(r.data);
  return found;
}

function guard(tool: string, toolInput: Record<string, unknown>, mode: string): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd: root, tool_name: tool, tool_input: toolInput, permission_mode: mode }),
    cwd: root, encoding: 'utf-8', timeout: 30_000, env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const sha = (rel: string) => (existsSync(join(root, rel)) ? createHash('sha256').update(readFileSync(join(root, rel))).digest('hex') : null);

/** deploy-done 拒绝时必须保持不变的文件：tasks.md、smoke 标记、DEPLOY_DONE 与账本。 */
function protectedState(): Record<string, string | null> {
  const files = ['tasks.md', 'DEPLOY_DONE', 'SMOKE_PASS', 'SMOKE_FAIL'].map(f => `logos/changes/${SLUG}/${f}`);
  return Object.fromEntries([...files, DEPLOY_LEDGER_REL].map(f => [f, sha(f)]));
}

/** 项目全部文件（含运行态目录，不含 .git）的 SHA-256 清单。 */
function treeHash(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { out.push(`D ${p.slice(root.length)}`); walk(p); }
      else out.push(`F ${p.slice(root.length)} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
    }
  };
  walk(root);
  return out.join('\n');
}

describe('S43 封堵 AI 绕道 — 单元测试（environment-promotion-approval 切片 4）', () => {
  it('UT-S43-11: deploy-done 对受门环境拒绝', () => {
    setup({ promote_from: 'staging', require_approval: true });
    expect(proposalStep()).toBe('ready-to-deploy');
    // ① 受门环境：DEPLOY_DONE_GATED_ENV，零写入
    const before = protectedState();
    const r1 = json(['deploy-done', '--env', 'prod', '--ref', 'HEAD']);
    expect(r1.status).toBe(1);
    expect(r1.error.code).toBe('DEPLOY_DONE_GATED_ENV');
    expect(r1.error).not.toHaveProperty('details');
    expect(r1.error.message).toContain('openlogos deploy --env prod');
    expect(protectedState()).toEqual(before);
    // 别名同样解析到受门环境；--ref 不可解析时也先报受门（判定在 --ref 解析之前）
    expect(json(['deploy-done', '--env', 'prod', '--ref', 'nosuch']).error.code).toBe('DEPLOY_DONE_GATED_ENV');
    expect(protectedState()).toEqual(before);
    // ② 未配置门的 test：与引入前行为一致（成功落标）
    const r2 = json(['deploy-done', '--env', 'test', '--ref', 'HEAD']);
    expect(r2.status, r2.stderr).toBe(0);
    expect(existsSync(join(proposalDir(), 'DEPLOY_DONE'))).toBe(true);

    // ③ prod 只写 require_approval: false（不是受门环境）：成功落标
    setup({ require_approval: false });
    const r3 = json(['deploy-done', '--env', 'prod', '--ref', 'HEAD']);
    expect(r3.status, r3.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(proposalDir(), 'DEPLOY_DONE'), 'utf-8')).environment).toBe('prod');
  }, 120_000);

  it('UT-S43-13: 生成指令硬红线条目', () => {
    const expectations: Record<'zh' | 'en', string[]> = {
      zh: ['目标环境要求审批而该版本未获审批，或晋级检查未通过', '任何模式、含 `--auto` 都不放行', '不得自行执行 `openlogos approve`', '不得加 `--force-promote`'],
      en: ['the target environment requires approval and this version has not been approved, or the promotion check has not passed',
        'never auto-passed in ANY mode, including `--auto`', 'must never run `openlogos approve` itself', 'add `--force-promote`'],
    };
    for (const locale of ['zh', 'en'] as const) {
      const tmp = makeTempRoot();
      cleanups.push(tmp.cleanup);
      const r = spawnSync(process.execPath, [CLI, 'init', 'p', '--locale', locale, '--ai-tool', 'claude-code'], { cwd: tmp.root, encoding: 'utf-8' });
      expect(r.status, r.stderr).toBe(0);
      // 硬红线位于 launched 项目的强制变更管理块：模块进入 launched 后经 sync 重新生成指令文件
      const yamlPath = join(tmp.root, 'logos/logos-project.yaml');
      writeFileSync(yamlPath, readFileSync(yamlPath, 'utf-8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
      const sync = spawnSync(process.execPath, [CLI, 'sync'], { cwd: tmp.root, encoding: 'utf-8' });
      expect(sync.status, sync.stderr).toBe(0);
      for (const file of ['AGENTS.md', 'CLAUDE.md']) {
        const text = readFileSync(join(tmp.root, file), 'utf-8');
        for (const phrase of expectations[locale]) expect(text, `${locale} ${file}: ${phrase}`).toContain(phrase);
        expect(text, `${locale} ${file}`).toContain('DEPLOY_APPROVAL_REQUIRED');
        expect(text, `${locale} ${file}`).toContain('DEPLOY_PROMOTION_UNVERIFIED');
      }
    }
  }, 120_000);
});

describe('S43 封堵 AI 绕道 — 场景测试（environment-promotion-approval 切片 4）', () => {
  it('ST-S43-03: --auto 停点与审批后续跑', () => {
    setup({ require_approval: true });
    expect(proposalStep()).toBe('ready-to-deploy');
    // ① 部署调用：等待审批，未写 DEPLOY_DONE，next 仍停在 ready-to-deploy
    const r1 = json(['deploy', '--env', 'prod']);
    expect(r1.status).toBe(1);
    expect(r1.error.code).toBe('DEPLOY_APPROVAL_REQUIRED');
    expect(r1.error.details.approve_command).toBe(`openlogos approve --env prod --ref ${git(['rev-parse', 'HEAD'])}`);
    expect(existsSync(join(proposalDir(), 'DEPLOY_DONE'))).toBe(false);
    expect(starts()).toEqual([]);
    expect(proposalStep()).toBe('ready-to-deploy');
    // ② 无人值守（bypassPermissions）下 AI 发起 approve 被 guard 阻断
    const g = guard('Bash', { command: 'openlogos approve --env prod --ref HEAD' }, 'bypassPermissions');
    expect(g.exitCode).toBe(2);
    expect(g.stdout).not.toContain('permissionDecision');
    // ③ 用户在终端执行 approve
    const a = json(['approve', '--env', 'prod', '--ref', 'HEAD']);
    expect(a.status, a.stderr).toBe(0);
    expect(a.data.created).toBe(true);
    // ④ 宿主重新驱动：部署成功、写 DEPLOY_DONE，进入 ready-to-smoke
    const r4 = json(['deploy', '--env', 'prod']);
    expect(r4.status, r4.stderr).toBe(0);
    expect(r4.data).toMatchObject({ status: 'done', channel: 'proposal', approval_id: a.data.approval_id });
    expect(r4.data.proposal.next_step).toBe('ready-to-smoke');
    expect(existsSync(join(proposalDir(), 'DEPLOY_DONE'))).toBe(true);
    expect(proposalStep()).toBe('ready-to-smoke');
    expect(starts().length).toBe(1);
  }, 180_000);

  it('ST-S43-04: 改门绕道被封堵', () => {
    setup({ promote_from: 'staging', require_approval: true });
    const registryBytes = sha(ENV_REGISTRY_REL);
    // ① Edit 删去 require_approval；② Bash rm —— guard exit 2，登记表字节不变
    const edit = guard('Edit', { file_path: join(root, ENV_REGISTRY_REL), old_string: 'require_approval: true', new_string: '' }, 'bypassPermissions');
    expect(edit.exitCode).toBe(2);
    expect(edit.stderr).toContain('部署门禁配置受保护');
    const rm = guard('Bash', { command: 'rm logos/environments.yaml' }, 'bypassPermissions');
    expect(rm.exitCode).toBe(2);
    expect(sha(ENV_REGISTRY_REL)).toBe(registryBytes);
    // ③ deploy-done 绕道：DEPLOY_DONE_GATED_ENV；④ 未审批的 deploy：DEPLOY_APPROVAL_REQUIRED（staging 已验证 HEAD，晋级检查通过）
    const head = git(['rev-parse', 'HEAD']);
    put(DEPLOY_LEDGER_REL, `${JSON.stringify({
      kind: 'smoke', environment: 'staging', slug: null, recorded_at: '2026-10-15T00:00:00.000Z', observed_head: head, observed_dirty: false,
      deploy_id: 'stg-1', ref: head, result: 'pass', env_evidence: 'declared', fresh_results: true, deploy_env_confirmed: true, verified: true,
    })}\n`);
    const before = treeHash();
    expect(json(['deploy-done', '--env', 'prod', '--ref', 'HEAD']).error.code).toBe('DEPLOY_DONE_GATED_ENV');
    const d = json(['deploy', '--env', 'prod', '--ref', head]);
    expect(d.status).toBe(1);
    expect(d.error.code).toBe('DEPLOY_APPROVAL_REQUIRED');
    // 全过程无部署脚本运行、无 DEPLOY_DONE，项目文件不变
    expect(treeHash()).toBe(before);
    expect(starts()).toEqual([]);
    expect(existsSync(join(proposalDir(), 'DEPLOY_DONE'))).toBe(false);
  }, 180_000);
});
