/**
 * environment-deploy 切片 3：script 方式部署——版本通道、提案通道与回滚（S42）。
 *
 * 覆盖 UT-S42-01、UT-S42-03～UT-S42-07、UT-S42-12、UT-S42-14、UT-S42-15、ST-S42-01、ST-S42-02
 *（logos/resources/test/core-S42-test-cases.md）。规范源：spec/environments.md §11、spec/cli-json-output.md
 *「`openlogos deploy --format json`」。
 * 全部在一次性临时 git 项目中构造：tag v1 / v2 各带一版部署脚本与 payload，HEAD 在 v2 之后另有提交；
 * 部署脚本把注入的环境变量、工作目录 HEAD、脚本版本与 payload 写入发布目录（PUBLISH_DIR），以此取证「脚本是否运行、在哪个版本运行」。
 * 除 UT-S42-15（进程内调用 deploy 并注入写入失败）外，均走真实 CLI 入口 cli/dist/index.js。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import {
  captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject, takeExitCode, writeLoopPass,
} from './helpers.js';
import { DEPLOY_LEDGER_REL, DEPLOY_LOCKS_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';
import { deploy, DEPLOY_WORK_REL, publishExclusive, staleLockGatePath } from '../src/commands/deploy.js';
import { createStreamMasker } from '../src/lib/deploy-runner.js';
import { writeDeployCompletion } from '../src/commands/deploy-done.js';

// 本文件用例全部驱动真实子进程（git、CLI 入口、部署脚本 / 合并事务），单独运行单条 0.5～7.4s；全量 verify 与
// S19 真实 npm pack / install 等重型用例并发时整体放慢 3～4 倍，超过全局 10s 而误报超时（proposal-default-environment
// loop 1：UT-S42-12、ST-S42-01、UT-S09-442）。超时只放宽本文件，断言不变。
vi.setConfig({ testTimeout: 60_000 });

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SLUG = 'ship-it';
const REPORT_REL = 'logos/resources/verify/deployment-report.md';
const RESULT_REL = 'logos/resources/verify/smoke-results.jsonl';
const PROPOSAL = [
  '# 变更提案：ship-it', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：生产',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
].join('\n');
const TASKS = ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布', '- [ ] 验证'].join('\n');

/**
 * 部署脚本（POSIX sh）。行为由 DEPLOY_BEHAVIOR 控制：fail → 退出码 3；sleep → 启动一个子进程后休眠；
 * hold → 休眠 3 秒后成功（用于并发）；其余 → 成功。每次启动先在 starts.txt 追加一行，成功时写 last.txt 并追加 all.txt。
 */
const SCRIPT = (version: string) => `#!/bin/sh
mkdir -p "$PUBLISH_DIR"
echo "start $OPENLOGOS_DEPLOY_ID" >> "$PUBLISH_DIR/starts.txt"
echo "deploying ${version} token=$PROD_TOKEN ab=$AB"
echo "stderr token=$PROD_TOKEN" >&2
# 多行密钥分两次写出（跨两次 data 事件）：两段拼起来恰为已声明的 MULTI_SECRET
if [ -n "$MULTI_A" ]; then printf 'multi=%s\n' "$MULTI_A"; sleep 0.3; printf '%s\n' "$MULTI_B"; printf 'err=%s\n%s\n' "$MULTI_A" "$MULTI_B" >&2; fi
case "$DEPLOY_BEHAVIOR" in
  fail) echo "boom"; exit 3 ;;
  sleep) sleep 60 & echo $! > "$PUBLISH_DIR/child.pid"; echo $$ > "$PUBLISH_DIR/script.pid"; sleep 60 ;;
  hold) sleep 3 ;;
esac
{
  echo "ref=$OPENLOGOS_DEPLOY_REF"
  echo "channel=$OPENLOGOS_DEPLOY_CHANNEL"
  echo "env=$OPENLOGOS_DEPLOY_ENV"
  echo "id=$OPENLOGOS_DEPLOY_ID"
  echo "head=$(git rev-parse HEAD)"
  echo "script=${version}"
  echo "payload=$(cat payload.txt)"
  echo "args=$*"
  echo "pwd=$(pwd -P)"
} > "$PUBLISH_DIR/last.txt"
cat "$PUBLISH_DIR/last.txt" >> "$PUBLISH_DIR/all.txt"
`;

/**
 * smoke runner（ST-S42-02）：读注入的 OPENLOGOS_SMOKE_ENV 写 target_environment。
 */
const RUNNER = `
const fs = require('fs'); const path = require('path');
const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;
const out = '${RESULT_REL}';
fs.mkdirSync(path.dirname(out), { recursive: true });
const rows = ['SMOKE-core-01', 'SMOKE-core-02'].map(id => ({ id, status: 'pass', timestamp: new Date().toISOString(), target_environment: env }));
fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\\n') + '\\n');
`;

let root: string;
let cleanup: () => void;
let publish: string;
let tags: { v1: string; v2: string; head: string };

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

interface DeployEnvCfg {
  workdir?: 'in-place';
  timeout_sec?: number;
  secrets?: string[];
  args?: string[];
}

/** 登记表：test 未配置 deploy；prod / staging 为 script 方式。 */
function registry(prod: DeployEnvCfg = {}): string {
  const envs: Array<Record<string, unknown>> = [
    { id: 'test', name: 'Test', tier: 'test', aliases: ['测试'] },
    {
      id: 'prod', name: 'Production', tier: 'prod', aliases: ['生产'],
      ...(prod.secrets ? { secrets: prod.secrets } : {}),
      deploy: {
        mode: 'script', script: 'deploy/run.sh', args: prod.args ?? ['{env}', '{ref_short}', '{deploy_id}'],
        ...(prod.workdir ? { workdir: prod.workdir } : {}), ...(prod.timeout_sec ? { timeout_sec: prod.timeout_sec } : {}),
      },
    },
    { id: 'staging', name: 'Staging', tier: 'staging', deploy: { mode: 'script', script: 'deploy/run.sh' } },
  ];
  return stringifyYaml({ schema_version: 1, environments: envs }, { lineWidth: 0 });
}

interface SetupOpts {
  registry?: string | false;
  proposal?: boolean;
  verified?: boolean;
  report?: boolean;
}

/**
 * 临时 git 项目：v1、v2 两个 tag 各带一版脚本与 payload，HEAD 在 v2 之后另有一次提交（payload=head）。
 * 登记表与运行态目录被 .gitignore 忽略（登记表是免立案的运维配置，修改它不应使工作区变脏）。
 */
function setup(opts: SetupOpts = {}): void {
  scaffoldProject(root, { locale: 'en' });
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  cfg.smoke = { result_path: RESULT_REL, sandbox_mode: 'off', command: 'node tools/runner.js' };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }, { lineWidth: 0 }));
  put('logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-01 | a |\n| SMOKE-core-02 | b |\n');
  put('tools/runner.js', RUNNER);
  if (opts.report) put(REPORT_REL, '# Deployment Report\n\nhistory\n');
  if (opts.registry !== false) put(ENV_REGISTRY_REL, opts.registry ?? registry());
  if (opts.proposal) {
    const dir = join(root, 'logos/changes', SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), PROPOSAL);
    writeFileSync(join(dir, 'tasks.md'), TASKS);
    if (opts.verified !== false) {
      writeFileSync(join(dir, 'VERIFY_PASS'), '');
      writeLoopPass(dir);
    }
    put('logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core', createdAt: new Date().toISOString() }));
  }
  put('.gitignore', `logos/.openlogos-runtime/\n${ENV_REGISTRY_REL}\n`);
  git(['init', '-q']);
  git(['config', 'user.name', 't']);
  git(['config', 'user.email', 't@example.invalid']);
  const commitVersion = (version: string) => {
    put('deploy/run.sh', SCRIPT(version));
    chmodSync(join(root, 'deploy/run.sh'), 0o755);
    put('payload.txt', `${version}\n`);
    git(['add', '-A']);
    git(['commit', '-qm', version]);
    return git(['rev-parse', 'HEAD']);
  };
  const v1 = commitVersion('v1');
  git(['tag', 'v1']);
  const v2 = commitVersion('v2');
  git(['tag', 'v2']);
  const head = commitVersion('head');
  tags = { v1, v2, head };
}

function cli(args: string[], env: Record<string, string | undefined> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: 'utf-8', timeout: 120_000, env: { ...process.env, PUBLISH_DIR: publish, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function deployJson(args: string[], env: Record<string, string | undefined> = {}): { status: number | null; data: any; error: any; stdout: string; stderr: string } {
  const r = cli(['deploy', ...args, '--format', 'json'], env);
  let data = null;
  let error = null;
  try { data = JSON.parse(r.stdout).data; } catch { /* 失败路径无 stdout */ }
  try { error = JSON.parse(r.stderr).error; } catch { /* 成功路径无 stderr envelope */ }
  return { ...r, data, error };
}

function ledger(): Array<Record<string, any>> {
  const p = join(root, DEPLOY_LEDGER_REL);
  return existsSync(p) ? readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}

function envShow(env: string): any {
  const r = cli(['env', 'show', env, '--format', 'json']);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout).data;
}

function published(file = 'last.txt'): Record<string, string> {
  const text = readFileSync(join(publish, file), 'utf-8');
  return Object.fromEntries(text.trim().split('\n').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

const starts = () => (existsSync(join(publish, 'starts.txt')) ? readFileSync(join(publish, 'starts.txt'), 'utf-8').trim().split('\n').length : 0);

/** 项目全部文件（含运行态目录，不含 .git 元数据）的 SHA-256 清单。 */
function treeHash(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git' || name === '.git-hidden') continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { out.push(`D ${p.slice(root.length)}`); walk(p); }
      else out.push(`F ${p.slice(root.length)} ${createHash('sha256').update(readFileSync(p)).digest('hex')} ${st.mode & 0o777}`);
    }
  };
  walk(root);
  return out.join('\n');
}

const proposalDir = () => join(root, 'logos/changes', SLUG);
const pidGone = (pid: number) => { try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; } };

async function waitFor(cond: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  publish = `${root}-publish`;
});
afterEach(() => {
  rmSync(publish, { recursive: true, force: true });
  cleanup();
});

describe('S42 script 方式部署 — 单元测试（environment-deploy 切片 3）', () => {
  it('UT-S42-01: 前置与参数拒绝零执行零写入', () => {
    const expectRejected = (args: string[], code: string, label: string) => {
      const before = treeHash();
      const r = deployJson(args);
      expect(r.status, `${label}: ${r.stderr}`).toBe(1);
      expect(r.error?.code, label).toBe(code);
      expect(r.stdout, `${label} 无成功输出`).toBe('');
      expect(existsSync(publish), `${label} 部署脚本未运行`).toBe(false);
      expect(treeHash(), `${label} 项目与运行态目录不变`).toBe(before);
    };

    setup({ registry: false });
    expectRejected(['--env', 'prod', '--ref', 'v1'], 'ENV_REGISTRY_NOT_FOUND', '① 无登记表');
    put(ENV_REGISTRY_REL, 'schema_version: 2\nenvironments: []\n');
    expectRejected(['--env', 'prod', '--ref', 'v1'], 'ENV_REGISTRY_INVALID', '② 登记表非法');
    put(ENV_REGISTRY_REL, registry().replace('tier: staging', 'tier: stage'));
    expectRejected(['--env', 'prod', '--ref', 'v1'], 'ENV_REGISTRY_INVALID', '② 登记表字段非法');
    put(ENV_REGISTRY_REL, registry().replace('script: deploy/run.sh', 'run: ./deploy.sh'));
    expectRejected(['--env', 'prod', '--ref', 'v1'], 'ENV_REGISTRY_INVALID', '② deploy 含命令字段');
    put(ENV_REGISTRY_REL, stringifyYaml({
      schema_version: 1,
      environments: [
        { id: 'test', name: 'Test', tier: 'test' },
        { id: 'prod', name: 'Production', tier: 'prod', deploy: { mode: 'script', script: 'deploy/run.sh' } },
      ],
    }));
    expectRejected(['--ref', 'v1'], 'ENV_REQUIRED', '③ 未传 --env');
    expectRejected(['--env', 'staging', '--ref', 'v1'], 'ENV_UNKNOWN', '④ --env 解析不到');
    expectRejected(['--env', 'test', '--ref', 'v1'], 'DEPLOY_NOT_CONFIGURED', '⑤ 未配置 deploy');
    renameSync(join(root, '.git'), join(root, '.git-hidden'));
    expectRejected(['--env', 'prod', '--ref', 'v1'], 'DEPLOY_GIT_REQUIRED', '⑥ 非 git 仓库');
    renameSync(join(root, '.git-hidden'), join(root, '.git'));
    expectRejected(['--env', 'prod', '--ref', 'v1', '--rollback'], 'DEPLOY_ARGS_CONFLICT', '⑦ --ref 与 --rollback 同传');
    expectRejected(['--env', 'prod'], 'DEPLOY_REF_REQUIRED', '⑧ 版本通道两者都缺');
    expectRejected(['--env', 'prod', '--ref', 'nosuch'], 'ENV_REF_UNRESOLVED', '⑨ --ref 无法解析');
    expectRejected(['--env', 'prod', '--complete', 'x', '--ref', 'v1'], 'DEPLOY_ARGS_CONFLICT', '⑩ --complete 与 --ref 同传');
    expectRejected(['--env', 'prod', '--ref', 'v1', '--channel', 'other'], 'DEPLOY_ARGS_CONFLICT', '--channel 非法');

    // 对照：同一夹具上合法参数确实会执行
    const ok = deployJson(['--env', 'prod', '--ref', 'v1']);
    expect(ok.status, ok.stderr).toBe(0);
    expect(starts()).toBe(1);
  });

  it('UT-S42-03: script 在请求 commit 的隔离工作树中执行', () => {
    setup();
    writeFileSync(join(root, 'payload.txt'), 'uncommitted\n'); // 工作区有未提交改动
    const r = deployJson(['--env', 'prod', '--ref', 'v1']);
    expect(r.status, r.stderr).toBe(0);
    const out = published();
    expect(out.ref).toBe(tags.v1);
    expect(out.head, '工作树 HEAD 为 v1').toBe(tags.v1);
    expect(out.script, '执行的是 v1 那一版脚本').toBe('v1');
    expect(out.payload, '不含未提交改动').toBe('v1');
    expect(out.channel).toBe('version');
    expect(out.env).toBe('prod');
    expect(out.args).toBe(`prod ${tags.v1.slice(0, 12)} ${r.data.deploy_id}`);
    expect(out.pwd).toContain(`${DEPLOY_WORK_REL}/${r.data.deploy_id}`);

    const rows = ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'deploy', environment: 'prod', channel: 'version', mode: 'script', result: 'done', slug: null,
      ref: tags.v1, ref_requested: tags.v1, ref_source: 'explicit', ref_input: 'v1', rollback: false, rollback_from: null,
      failure_reason: null, deploy_id: r.data.deploy_id, log_path: r.data.log_path,
    });
    expect(r.data).toMatchObject({
      status: 'done', environment: 'prod', channel: 'version', mode: 'script', ref: tags.v1, ref_source: 'explicit',
      ref_requested: tags.v1, ledger_written: true, proposal: null, ci: null,
    });
    expect(existsSync(join(root, DEPLOY_WORK_REL, r.data.deploy_id)), '工作树已移除').toBe(false);
    expect(git(['worktree', 'list', '--porcelain']).split('\n').filter(l => l.startsWith('worktree ')), '无残留工作树').toHaveLength(1);
    expect(readFileSync(join(root, 'payload.txt'), 'utf-8'), '当前工作区未被改动').toBe('uncommitted\n');
    expect(existsSync(join(root, DEPLOY_LOCKS_REL, 'prod.lock')), '锁已释放').toBe(false);
  });

  it('UT-S42-04: in-place 约束', () => {
    setup({ registry: registry({ workdir: 'in-place' }) });
    // ① HEAD 等于请求 commit 且工作区干净
    const ok = deployJson(['--env', 'prod', '--ref', 'HEAD']);
    expect(ok.status, ok.stderr).toBe(0);
    const out = published();
    expect(out.head).toBe(tags.head);
    expect(out.pwd).toBe(resolve(git(['rev-parse', '--show-toplevel'])));
    expect(starts()).toBe(1);
    // ② HEAD 不等于请求 commit
    const before = treeHash();
    const r2 = deployJson(['--env', 'prod', '--ref', 'v1']);
    expect(r2.status).toBe(1);
    expect(r2.error.code).toBe('DEPLOY_WORKTREE_MISMATCH');
    expect(treeHash()).toBe(before);
    // ③ 工作区有改动
    writeFileSync(join(root, 'payload.txt'), 'dirty\n');
    const before3 = treeHash();
    const r3 = deployJson(['--env', 'prod', '--ref', 'HEAD']);
    expect(r3.status).toBe(1);
    expect(r3.error.code).toBe('DEPLOY_WORKTREE_MISMATCH');
    expect(treeHash()).toBe(before3);
    expect(starts(), '②③ 零执行').toBe(1);
    expect(ledger()).toHaveLength(1);

    // ④ HEAD 一致、已跟踪文件干净，但有未被忽略的未跟踪文件（code-r1 F4）：同样 DEPLOY_WORKTREE_MISMATCH、零执行
    git(['checkout', '--', 'payload.txt']);
    put('public/extra.js', 'console.log("not in the commit");\n');
    const before4 = treeHash();
    const r4 = deployJson(['--env', 'prod', '--ref', 'HEAD']);
    expect(r4.status).toBe(1);
    expect(r4.error.code).toBe('DEPLOY_WORKTREE_MISMATCH');
    expect(treeHash()).toBe(before4);
    expect(starts(), '④ 零执行').toBe(1);
    expect(ledger(), '④ 账本不变').toHaveLength(1);
    // 被 gitignore 排除的文件（登记表、运行态目录）不影响；移除未跟踪文件后恢复可部署
    rmSync(join(root, 'public'), { recursive: true });
    expect(deployJson(['--env', 'prod', '--ref', 'HEAD']).status).toBe(0);
    expect(starts()).toBe(2);
  });

  it('UT-S42-05: 脚本失败与超时', async () => {
    // timeout_sec 同样约束开头那次应当成功的部署：2s 在全量 verify 负载下会被正常部署本身耗尽（release-0-16-7 重新验收误报），
    // 放宽到 8s；sleep 夹具休眠 60s，② 的超时分支仍必然触发
    setup({ registry: registry({ timeout_sec: 8 }) });
    expect(deployJson(['--env', 'prod', '--ref', 'v1']).status).toBe(0);
    const currentBefore = envShow('prod').current_ref;
    expect(currentBefore).toBe(tags.v1);

    // ① 脚本以 3 退出
    const r1 = deployJson(['--env', 'prod', '--ref', 'v2'], { DEPLOY_BEHAVIOR: 'fail' });
    expect(r1.status).toBe(1);
    expect(r1.error.code).toBe('DEPLOY_FAILED');
    expect(r1.error.details).toMatchObject({
      exit_code: 3, timed_out: false, failure_reason: 'exit-code', environment: 'prod', channel: 'version', mode: 'script',
      ref_requested: tags.v2, ledger_written: true, deployed: false, unwritten_record: null, ci: null,
    });
    expect(existsSync(join(root, r1.error.details.log_path)), '日志存在').toBe(true);
    expect(readFileSync(join(root, r1.error.details.log_path), 'utf-8')).toContain('boom');
    expect(r1.error.details.output_tail).toContain('boom');
    expect(ledger().pop()).toMatchObject({ result: 'failed', ref: null, ref_source: 'unknown', failure_reason: 'exit-code', deploy_id: r1.error.details.deploy_id });
    expect(envShow('prod').current_ref, 'current_ref 不变').toBe(currentBefore);

    // ② 启动子进程后休眠超过 timeout_sec
    const r2 = deployJson(['--env', 'prod', '--ref', 'v2'], { DEPLOY_BEHAVIOR: 'sleep' });
    expect(r2.status).toBe(1);
    expect(r2.error.code).toBe('DEPLOY_FAILED');
    expect(r2.error.details).toMatchObject({ timed_out: true, failure_reason: 'timeout', exit_code: null });
    const scriptPid = Number(readFileSync(join(publish, 'script.pid'), 'utf-8'));
    const childPid = Number(readFileSync(join(publish, 'child.pid'), 'utf-8'));
    await waitFor(() => pidGone(scriptPid) && pidGone(childPid), 5000);
    expect(pidGone(scriptPid), '脚本已终止').toBe(true);
    expect(pidGone(childPid), '子进程已终止').toBe(true);
    expect(ledger().pop()).toMatchObject({ result: 'failed', ref: null, failure_reason: 'timeout' });
    expect(existsSync(join(root, r2.error.details.log_path))).toBe(true);
    expect(envShow('prod').current_ref).toBe(currentBefore);
    expect(existsSync(join(root, DEPLOY_LOCKS_REL, 'prod.lock')), '锁已释放').toBe(false);
  });

  it('UT-S42-06: 密钥缺失与遮盖', () => {
    setup({ registry: registry({ secrets: ['PROD_TOKEN', 'AB'] }) });
    // ① 不导出 PROD_TOKEN
    const before = treeHash();
    const r1 = deployJson(['--env', 'prod', '--ref', 'v1'], { PROD_TOKEN: undefined, AB: 'xy' });
    expect(r1.status).toBe(1);
    expect(r1.error.code).toBe('DEPLOY_SECRETS_MISSING');
    expect(r1.error.details).toEqual({ missing: ['PROD_TOKEN'] });
    expect(r1.stderr).not.toContain('xy');
    expect(existsSync(publish), '零执行').toBe(false);
    expect(treeHash()).toBe(before);

    // ② 导出后部署：JSON 尾部与日志遮盖长值，长度不足 4 的值不替换
    const env = { PROD_TOKEN: 's3cr3t-value', AB: 'xy' };
    const r2 = deployJson(['--env', 'prod', '--ref', 'v1'], env);
    expect(r2.status, r2.stderr).toBe(0);
    const log = readFileSync(join(root, r2.data.log_path), 'utf-8');
    for (const [label, text] of [['output_tail', r2.data.output_tail], ['log', log], ['stdout', r2.stdout], ['stderr', r2.stderr]] as const) {
      expect(text, label).not.toContain('s3cr3t-value');
    }
    expect(r2.data.output_tail).toContain('token=***');
    expect(r2.data.output_tail).toContain('ab=xy');
    expect(log).toContain('stderr token=***');

    // 文本模式：实时输出同样遮盖
    const r3 = cli(['deploy', '--env', 'prod', '--ref', 'v1'], env);
    expect(r3.status, r3.stderr).toBe(0);
    expect(r3.stdout + r3.stderr).not.toContain('s3cr3t-value');
    expect(r3.stdout).toContain('token=***');
    expect(r3.stderr).toContain('stderr token=***');
  });

  it('UT-S42-06: 含换行的已声明密钥跨行、跨数据块同样遮盖（code-r1 F1）', () => {
    setup({ registry: registry({ secrets: ['PROD_TOKEN', 'AB', 'MULTI_SECRET'] }) });
    const env = {
      PROD_TOKEN: 's3cr3t-value', AB: 'xy', MULTI_SECRET: 'alphaSECRET\nbetaSECRET', MULTI_A: 'alphaSECRET', MULTI_B: 'betaSECRET',
    };
    const r = deployJson(['--env', 'prod', '--ref', 'v1'], env);
    expect(r.status, r.stderr).toBe(0);
    const log = readFileSync(join(root, r.data.log_path), 'utf-8');
    for (const [label, text] of [['output_tail', r.data.output_tail], ['log', log], ['stdout', r.stdout], ['stderr', r.stderr]] as const) {
      expect(text, label).not.toContain('alphaSECRET');
      expect(text, label).not.toContain('betaSECRET');
    }
    expect(log).toContain('multi=***');
    expect(log).toContain('err=***');
    expect(r.data.output_tail).toContain('multi=***');
    // 文本模式回显
    const t = cli(['deploy', '--env', 'prod', '--ref', 'v1'], env);
    expect(t.status, t.stderr).toBe(0);
    expect(t.stdout + t.stderr).not.toContain('alphaSECRET');
    expect(t.stdout + t.stderr).not.toContain('betaSECRET');
    expect(t.stdout).toContain('multi=***');

    // 流式遮盖：任意位置切成两块、逐字符喂入，输出都不含原值，且与一次性遮盖结果相同；短值不替换
    const secret = 'alphaSECRET\nbetaSECRET';
    const text = `a ${secret} b ${secret}\nxy s3cr3t-value end`;
    const expected = `a *** b ***\nxy *** end`;
    for (let cut = 0; cut <= text.length; cut++) {
      const m = createStreamMasker([secret, 's3cr3t-value', 'xy']);
      const out = m.push(text.slice(0, cut)) + m.push(text.slice(cut)) + m.end();
      expect(out, `cut=${cut}`).toBe(expected);
    }
    const m = createStreamMasker([secret]);
    expect([...text].map(c => m.push(c)).join('') + m.end()).toBe(`a *** b ***\nxy s3cr3t-value end`);
  });

  it('UT-S42-07: 回滚', () => {
    setup();
    expect(deployJson(['--env', 'prod', '--ref', 'v1']).status).toBe(0);
    expect(deployJson(['--env', 'prod', '--ref', 'v2']).status).toBe(0);
    const r = deployJson(['--env', 'prod', '--rollback']);
    expect(r.status, r.stderr).toBe(0);
    expect(published().script).toBe('v1');
    expect(r.data).toMatchObject({ rollback: true, rollback_from: tags.v2, channel: 'version', ref: tags.v1, ref_requested: tags.v1 });
    expect(ledger().pop()).toMatchObject({ rollback: true, rollback_from: tags.v2, channel: 'version', ref: tags.v1, result: 'done', slug: null });
    const view = envShow('prod');
    expect(view.current_ref).toBe(tags.v1);
    expect(view.previous_ref).toBe(tags.v2);

    expect(deployJson(['--env', 'prod', '--rollback', '--channel', 'proposal']).error.code).toBe('DEPLOY_ARGS_CONFLICT');

    // 另一用例：只有一次成功部署
    rmSync(join(root, DEPLOY_LEDGER_REL));
    expect(deployJson(['--env', 'prod', '--ref', 'v1']).status).toBe(0);
    const startsBefore = starts();
    const before = treeHash();
    const m = deployJson(['--env', 'prod', '--rollback']);
    expect(m.status).toBe(1);
    expect(m.error.code).toBe('DEPLOY_ROLLBACK_TARGET_MISSING');
    expect(starts(), '零执行').toBe(startsBefore);
    expect(treeHash()).toBe(before);
  });

  it('UT-S42-12: 本地锁并发与遗留回收', async () => {
    setup();
    // ① 第一次部署运行中（脚本休眠）
    const first = spawn(process.execPath, [CLI, 'deploy', '--env', 'prod', '--ref', 'v1', '--format', 'json'], {
      cwd: root, env: { ...process.env, PUBLISH_DIR: publish, DEPLOY_BEHAVIOR: 'hold' },
    });
    let firstOut = '';
    first.stdout.on('data', c => { firstOut += c; });
    const firstDone = new Promise<number | null>(res => first.on('close', code => res(code)));
    await waitFor(() => starts() === 1 && existsSync(join(root, DEPLOY_LOCKS_REL, 'prod.lock')));
    const second = deployJson(['--env', 'prod', '--ref', 'v2']);
    expect(second.status).toBe(1);
    expect(second.error.code).toBe('DEPLOY_IN_PROGRESS');
    const holder = second.error.details.holder;
    expect(holder).toMatchObject({ mode: 'script', unresolved: false, run_id: null, run_url: null });
    expect(typeof holder.deploy_id).toBe('string');
    expect(typeof holder.pid).toBe('number');
    expect(starts(), '第二次零执行').toBe(1);
    expect(await firstDone, '第一次照常完成').toBe(0);
    expect(JSON.parse(firstOut).data.deploy_id).toBe(holder.deploy_id);
    expect(ledger()).toHaveLength(1);

    // ② 锁文件记录的 pid 已不存在：遗留锁被回收
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf-8' });
    put(`${DEPLOY_LOCKS_REL}/prod.lock`, JSON.stringify({ pid: Number(dead.stdout), deploy_id: 'stale', mode: 'script', started_at: '2026-10-15T00:00:00.000Z' }));
    const r = deployJson(['--env', 'prod', '--ref', 'v2']);
    expect(r.status, r.stderr).toBe(0);
    expect(published().script).toBe('v2');
    expect(existsSync(join(root, DEPLOY_LOCKS_REL, 'prod.lock')), '锁已释放').toBe(false);
  });

  it('UT-S42-12: 两个回收者竞争同一遗留锁：后者不得删除先取得者的新锁，最多一个执行部署（code-r2 F2）', async () => {
    setup();
    const lockFile = join(root, DEPLOY_LOCKS_REL, 'prod.lock');
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf-8' });
    put(`${DEPLOY_LOCKS_REL}/prod.lock`, JSON.stringify({ pid: Number(dead.stdout), deploy_id: 'stale', mode: 'script', started_at: '2026-10-15T00:00:00.000Z' }));

    // A（本进程内）观察到遗留锁后暂停；B（独立进程）在此期间回收同一遗留锁、取得新锁并开始部署（脚本休眠 3 秒持锁）
    let b: ReturnType<typeof spawn> | null = null;
    let bOut = '';
    let bDone: Promise<number | null> | null = null;
    let bLock = '';
    const con = captureConsole();
    const restoreCwd = mockCwd(root);
    const exitSpy = mockProcessExit();
    const prevPublish = process.env.PUBLISH_DIR;
    process.env.PUBLISH_DIR = publish;
    let exit = 0;
    try {
      await deploy('json', { env: 'prod', ref: 'v1' }, {
        afterStaleLockObserved: () => {
          if (b) return;
          b = spawn(process.execPath, [CLI, 'deploy', '--env', 'prod', '--ref', 'v2', '--format', 'json'], {
            cwd: root, env: { ...process.env, PUBLISH_DIR: publish, DEPLOY_BEHAVIOR: 'hold' },
          });
          b.stdout!.on('data', c => { bOut += c; });
          bDone = new Promise(res => b!.on('close', code => res(code)));
          // 同步等待 B 已回收遗留锁、写出自己的锁并启动部署脚本
          const until = Date.now() + 15_000;
          while (Date.now() < until) {
            const text = existsSync(lockFile) ? readFileSync(lockFile, 'utf-8') : '';
            if (text.includes(`"pid":${b.pid}`) && starts() === 1) { bLock = text; break; }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
          }
          expect(bLock, 'B 已取得新锁').not.toBe('');
        },
      });
      exit = Number(takeExitCode() ?? 0);
    } catch (error) {
      const m = /^process\.exit\((\d+)\)$/.exec((error as Error).message);
      if (!m) throw error;
      takeExitCode();
      exit = Number(m[1]);
    } finally {
      if (prevPublish === undefined) delete process.env.PUBLISH_DIR; else process.env.PUBLISH_DIR = prevPublish;
      exitSpy.mockRestore();
      restoreCwd();
      con.restore();
    }
    // A 恢复后不得删除 B 的新锁，而是报告 B 占用、零执行
    expect(exit, 'A 被拒绝').toBe(1);
    expect(con.logs, 'A 无成功输出').toEqual([]);
    const err = JSON.parse(con.errors[0]).error;
    expect(err.code).toBe('DEPLOY_IN_PROGRESS');
    expect(err.details.holder).toMatchObject({ pid: (b as unknown as { pid: number }).pid, mode: 'script', unresolved: false });
    expect(readFileSync(lockFile, 'utf-8'), 'B 的锁未被 A 删除或替换').toBe(bLock);
    expect(await bDone, 'B 照常完成').toBe(0);
    expect(JSON.parse(bOut).data.deploy_id).toBe(err.details.holder.deploy_id);
    expect(starts(), '只有 B 执行了部署').toBe(1);
    expect(published().script).toBe('v2');
    expect(ledger()).toHaveLength(1);
    expect(existsSync(lockFile), 'B 结束后释放锁').toBe(false);
    expect(readdirSync(join(root, DEPLOY_LOCKS_REL)).filter(n => n.includes('.reclaim-')), '回收闸门已清理').toEqual([]);
  });

  it('UT-S42-12: 回收闸门的持有者身份未知时不跨代回收，只有确认持有者已退出才续用下一代闸门（code-r3 F2）', () => {
    setup();
    const lockFile = join(root, DEPLOY_LOCKS_REL, 'prod.lock');
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf-8' });
    const staleLock = JSON.stringify({ pid: Number(dead.stdout), deploy_id: 'stale', mode: 'script', started_at: '2026-10-15T00:00:00.000Z' });
    put(`${DEPLOY_LOCKS_REL}/prod.lock`, staleLock);
    const gate0 = staleLockGatePath(lockFile, 0)!;
    const gate1 = staleLockGatePath(lockFile, 1)!;
    const rejected = (label: string) => {
      const r = deployJson(['--env', 'prod', '--ref', 'v1']);
      expect(r.status, label).toBe(1);
      expect(r.error.code, label).toBe('DEPLOY_IN_PROGRESS');
      expect(starts(), `${label} 零执行`).toBe(0);
      expect(readFileSync(lockFile, 'utf-8'), `${label} 遗留锁未被删除`).toBe(staleLock);
      expect(existsSync(gate1), `${label} 未跨代创建下一代闸门`).toBe(false);
      expect(ledger(), `${label} 账本不变`).toEqual([]);
    };

    // ① 第 0 代闸门已存在但持有者身份尚未写入（另一回收者 A 正处于闸门初始化窗口）：B 不得把它当作已退出而跨代
    writeFileSync(gate0, '');
    rejected('① 空闸门');
    expect(readFileSync(gate0, 'utf-8'), '① 闸门未被改动').toBe('');
    // 不完整的持有者记录同样按未知处理
    writeFileSync(gate0, '{"pid":');
    rejected('① 不完整闸门');

    // ② 闸门持有者存活（A 在回收临界区内）：同样等待后拒绝
    writeFileSync(gate0, `${JSON.stringify({ pid: process.pid, token: 'a' })}\n`);
    rejected('② 存活持有者');

    // ③ 已确认闸门持有者退出：不删除残留闸门，改用下一代闸门回收遗留锁，部署正常执行
    writeFileSync(gate0, `${JSON.stringify({ pid: Number(dead.stdout), token: 'a' })}\n`);
    const ok = deployJson(['--env', 'prod', '--ref', 'v1']);
    expect(ok.status, ok.stderr).toBe(0);
    expect(starts()).toBe(1);
    expect(existsSync(gate0), '③ 残留闸门保留').toBe(true);
    expect(existsSync(gate1), '③ 下一代闸门用后清理').toBe(false);
    expect(existsSync(lockFile), '③ 部署结束释放锁').toBe(false);
  });

  it('UT-S42-12: 锁与回收闸门原子发布：目标已存在时不覆盖，发布即带完整内容（code-r3 F2）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openlogos-publish-'));
    try {
      const target = join(dir, 'gate');
      publishExclusive(target, '{"pid":1,"token":"first"}\n');
      expect(readFileSync(target, 'utf-8')).toBe('{"pid":1,"token":"first"}\n');
      expect(() => publishExclusive(target, '{"pid":2,"token":"second"}\n')).toThrow(expect.objectContaining({ code: 'EEXIST' }));
      expect(readFileSync(target, 'utf-8'), '已存在的内容不被覆盖').toBe('{"pid":1,"token":"first"}\n');
      expect(readdirSync(dir), '临时文件已清理').toEqual(['gate']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('UT-S42-14: 提案通道首次部署与失败不落标', () => {
    // ① 脚本成功
    setup({ proposal: true });
    expect(existsSync(join(root, REPORT_REL))).toBe(false);
    const r = deployJson(['--env', 'prod']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.data).toMatchObject({ channel: 'proposal', ref_input: 'HEAD', ref_requested: tags.head, ref: tags.head, ledger_written: true });
    expect(r.data.proposal).toMatchObject({
      slug: SLUG, marker_path: `logos/changes/${SLUG}/DEPLOY_DONE`, deploy_tasks_checked: 2, deploy_tasks_total: 2,
      deployment_report_path: REPORT_REL, next_step: 'ready-to-smoke',
    });
    expect(published().channel).toBe('proposal');
    const report = readFileSync(join(root, REPORT_REL), 'utf-8');
    expect(report).toContain(r.data.deploy_id);
    expect(report).toContain(`ref_requested: ${tags.head}`);
    expect(report).toContain(`ref: ${tags.head}`);
    expect(report).toMatch(/Result: done/);
    expect(readFileSync(join(proposalDir(), 'tasks.md'), 'utf-8')).toContain('- [x] 发布\n- [x] 验证');
    const doneMarker = JSON.parse(readFileSync(join(proposalDir(), 'DEPLOY_DONE'), 'utf-8'));
    const rows = ledger();
    expect(rows, '账本只多一条').toHaveLength(1);
    expect(doneMarker.deploy_id).toBe(rows[0].deploy_id);
    expect(doneMarker).toMatchObject({ environment: 'prod', ref: tags.head, ref_source: 'explicit' });
    expect(rows[0]).toMatchObject({ channel: 'proposal', slug: SLUG, result: 'done', deploy_id: r.data.deploy_id });

    // ② 脚本失败（全新夹具）
    rmSync(publish, { recursive: true, force: true });
    cleanup();
    ({ root, cleanup } = makeTempRoot());
    setup({ proposal: true });
    const f = deployJson(['--env', 'prod'], { DEPLOY_BEHAVIOR: 'fail' });
    expect(f.status).toBe(1);
    expect(f.error.code).toBe('DEPLOY_FAILED');
    expect(f.error.details).toMatchObject({ channel: 'proposal', failure_reason: 'exit-code', exit_code: 3 });
    const failedReport = readFileSync(join(root, REPORT_REL), 'utf-8');
    expect(failedReport).toContain(f.error.details.deploy_id);
    expect(failedReport).toMatch(/Result: failed（exit-code 3）/);
    expect(readFileSync(join(proposalDir(), 'tasks.md'), 'utf-8'), '[deploy] 未勾选').toBe(TASKS);
    expect(existsSync(join(proposalDir(), 'DEPLOY_DONE'))).toBe(false);
    expect(ledger()).toEqual([expect.objectContaining({ result: 'failed', channel: 'proposal', slug: SLUG, ref: null })]);

    // ③ verify 未通过（全新夹具）
    rmSync(publish, { recursive: true, force: true });
    cleanup();
    ({ root, cleanup } = makeTempRoot());
    setup({ proposal: true, verified: false });
    const before = treeHash();
    const v = deployJson(['--env', 'prod', '--channel', 'proposal']);
    expect(v.status).toBe(1);
    expect(v.error.code).toBe('VERIFY_NOT_PASSED');
    expect(existsSync(publish), '零执行').toBe(false);
    expect(treeHash()).toBe(before);
  });

  it('UT-S42-15: 部署成功而记录失败', async () => {
    const runInProcess = async (args: Parameters<typeof deploy>[1], hooks: Parameters<typeof deploy>[2]) => {
      const con = captureConsole();
      const restoreCwd = mockCwd(root);
      const exitSpy = mockProcessExit();
      const prevPublish = process.env.PUBLISH_DIR;
      process.env.PUBLISH_DIR = publish;
      try {
        let exit: number;
        try {
          await deploy('json', args, hooks);
          exit = Number(takeExitCode() ?? 0);
        } catch (error) {
          const m = /^process\.exit\((\d+)\)$/.exec((error as Error).message);
          if (!m) throw error; // 未捕获异常直接让用例失败
          takeExitCode();
          exit = Number(m[1]);
        }
        return { exit, logs: [...con.logs], errors: [...con.errors] };
      } finally {
        if (prevPublish === undefined) delete process.env.PUBLISH_DIR; else process.env.PUBLISH_DIR = prevPublish;
        exitSpy.mockRestore();
        restoreCwd();
        con.restore();
      }
    };

    // 提案通道：写 DEPLOY_DONE 时失败 → 按快照恢复 tasks.md、旧 smoke 标记与旧 DEPLOY_DONE，撤销本次账本行
    setup({ proposal: true });
    const oldMarker = '{"deploy_id":"old","environment":"prod","ref":null,"ref_source":"unknown","recorded_at":"2026-10-14T00:00:00.000Z"}\n';
    writeFileSync(join(proposalDir(), 'DEPLOY_DONE'), oldMarker);
    writeFileSync(join(proposalDir(), 'SMOKE_FAIL'), 'old-fail');
    const r1 = await runInProcess({ env: 'prod', channel: 'proposal' }, {
      completion: input => writeDeployCompletion({
        ...input, writeMarker: () => { throw Object.assign(new Error('EIO: injected marker write failure'), { code: 'EIO' }); },
      }),
    });
    expect(r1.exit).toBe(1);
    expect(r1.logs).toEqual([]);
    expect(r1.errors).toHaveLength(1);
    const e1 = JSON.parse(r1.errors[0]).error;
    expect(e1.code).toBe('DEPLOY_RECORD_FAILED');
    expect(e1.details).toMatchObject({ deployed: true, channel: 'proposal', ref_requested: tags.head, ledger_written: false });
    expect(typeof e1.details.deploy_id).toBe('string');
    expect(JSON.parse(e1.details.unwritten_record)).toMatchObject({ deploy_id: e1.details.deploy_id, ref: tags.head, result: 'done' });
    expect(e1.message).toContain('EIO');
    expect(starts(), '脚本确已执行').toBe(1);
    expect(readFileSync(join(proposalDir(), 'tasks.md'), 'utf-8'), 'tasks.md 恢复').toBe(TASKS);
    expect(readFileSync(join(proposalDir(), 'SMOKE_FAIL'), 'utf-8'), '旧 smoke 标记恢复').toBe('old-fail');
    expect(readFileSync(join(proposalDir(), 'DEPLOY_DONE'), 'utf-8'), '旧 DEPLOY_DONE 恢复').toBe(oldMarker);
    expect(ledger(), '本次账本行已撤销').toEqual([]);

    // 版本通道：账本追加失败
    rmSync(publish, { recursive: true, force: true });
    cleanup();
    ({ root, cleanup } = makeTempRoot());
    setup();
    const r2 = await runInProcess({ env: 'prod', ref: 'v1' }, {
      appendLedger: () => { throw Object.assign(new Error('ENOSPC: injected ledger append failure'), { code: 'ENOSPC' }); },
    });
    expect(r2.exit).toBe(1);
    expect(r2.logs).toEqual([]);
    const e2 = JSON.parse(r2.errors[0]).error;
    expect(e2.code).toBe('DEPLOY_RECORD_FAILED');
    expect(e2.details).toMatchObject({ deployed: true, channel: 'version', ref: tags.v1, ref_requested: tags.v1, ledger_written: false });
    expect(JSON.parse(e2.details.unwritten_record)).toMatchObject({ deploy_id: e2.details.deploy_id, ref: tags.v1, slug: null });
    expect(published().script).toBe('v1');
    expect(ledger()).toEqual([]);
    expect(existsSync(join(root, DEPLOY_LOCKS_REL, 'prod.lock')), '锁已释放').toBe(false);
  });
});

describe('S42 script 方式部署 — 场景测试（environment-deploy 切片 3）', () => {
  it('ST-S42-01: script 版本通道、回滚与环境视图', async () => {
    setup();
    const r1 = deployJson(['--env', 'staging', '--ref', 'v1']);
    expect(r1.status, r1.stderr).toBe(0);
    expect(published().payload).toBe('v1');
    const r2 = deployJson(['--env', 'staging', '--ref', 'v2']);
    expect(r2.status, r2.stderr).toBe(0);
    expect(published().payload).toBe('v2');

    const view = envShow('staging');
    expect(view).toMatchObject({ current_ref: tags.v2, previous_ref: tags.v1, deploy_mode: 'script', deploy_in_progress: null });
    expect(view.last_deploy).toMatchObject({ deploy_id: r2.data.deploy_id, channel: 'version', mode: 'script', result: 'done', slug: null });

    const rb = deployJson(['--env', 'staging', '--rollback']);
    expect(rb.status, rb.stderr).toBe(0);
    expect(rb.data).toMatchObject({ rollback: true, rollback_from: tags.v2, ref: tags.v1 });
    expect(published().payload).toBe('v1');

    const st = cli(['status', '--format', 'json']);
    expect(st.status, st.stderr).toBe(0);
    const status = JSON.parse(st.stdout);
    const fromStatus = status.data.environments.find((e: any) => e.id === 'staging');
    const shown = envShow('staging');
    // env show 把 id / name / tier 放在 environment 对象中，其余视图字段在顶层
    const flat = { ...shown, id: shown.environment.id, name: shown.environment.name, tier: shown.environment.tier };
    expect(fromStatus).toEqual(Object.fromEntries(Object.keys(fromStatus).map(k => [k, flat[k]])));
    expect(fromStatus).toMatchObject({ current_ref: tags.v1, previous_ref: tags.v2, deploy_mode: 'script' });

    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const ajv = new Ajv2020({ strict: false, allowUnionTypes: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(REPO, 'spec', 'schema', 'status.schema.json'), 'utf-8')));
    expect(validate(status.data), JSON.stringify(validate.errors)).toBe(true);
  });

  it('ST-S42-02: 提案通道部署后 smoke 得到已验证事实', () => {
    setup({ proposal: true });
    const d = deployJson(['--env', 'staging']);
    expect(d.status, d.stderr).toBe(0);
    expect(d.data.channel).toBe('proposal');
    expect(readFileSync(join(root, REPORT_REL), 'utf-8')).toContain(d.data.deploy_id);
    expect(existsSync(join(proposalDir(), 'DEPLOY_DONE'))).toBe(true);

    const s1 = cli(['smoke', '--env', 'staging', '--format', 'json']);
    expect(s1.status, s1.stderr).toBe(0);
    const ev = JSON.parse(s1.stdout).data.environment_evidence;
    expect(ev).toMatchObject({ target: 'staging', deploy_id: d.data.deploy_id, ref: tags.head, verified: true, deploy_env_confirmed: true });
    expect(ledger().filter(l => l.kind === 'smoke').pop()).toMatchObject({ deploy_id: d.data.deploy_id, verified: true, result: 'pass' });

    const v = deployJson(['--env', 'staging', '--ref', 'v1', '--channel', 'version']);
    expect(v.status, v.stderr).toBe(0);

    const snap = () => JSON.stringify({
      files: readdirSync(proposalDir()).sort(),
      ledger: readFileSync(join(root, DEPLOY_LEDGER_REL), 'utf-8'),
      results: readFileSync(join(root, RESULT_REL), 'utf-8'),
    });
    const before = snap();
    const s2 = cli(['smoke', '--env', 'staging', '--format', 'json']);
    expect(s2.status).toBe(1);
    const err = JSON.parse(s2.stderr).error;
    expect(err.code).toBe('SMOKE_DEPLOY_SUPERSEDED');
    expect(err.details.marker.deploy_id).toBe(d.data.deploy_id);
    expect(err.details.latest).toMatchObject({ deploy_id: v.data.deploy_id, channel: 'version', result: 'done', ref: tags.v1 });
    expect(snap(), '零副作用').toBe(before);
  });
});
