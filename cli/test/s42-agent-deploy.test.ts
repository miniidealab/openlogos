/**
 * environment-deploy 切片 5：agent 方式两段式与部署 skill 分发（S42）。
 *
 * 覆盖 UT-S42-11、UT-S42-17、ST-S42-04（logos/resources/test/core-S42-test-cases.md）。
 * 规范源：spec/environments.md §11.1、§11.3、§11.5；spec/cli-json-output.md「`openlogos deploy --format json`」。
 * agent 用例在一次性临时 git 项目中走真实 CLI 入口 cli/dist/index.js；分发用例只读本仓源文件、插件副本与
 * asset-manifest，并在临时目录中重跑 scripts/build-plugin-skills.sh 比对生成结果。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject, takeExitCode, writeLoopPass } from './helpers.js';
import { deploy } from '../src/commands/deploy.js';
import { DEPLOY_LEDGER_REL, DEPLOY_PENDING_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CLI_ROOT, '..');
const SLUG = 'ship-it';
const SECTION = '测试环境部署';
const PLAN_REL = 'logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md';
const REPORT_REL = 'logos/resources/verify/deployment-report.md';
const TASKS = ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布', '- [ ] 验证'].join('\n');

let root: string;
let cleanup: () => void;
let tags: { v1: string; head: string };

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function setup(opts: { proposal?: boolean } = {}): void {
  scaffoldProject(root, { locale: 'en' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }, { lineWidth: 0 }));
  put(ENV_REGISTRY_REL, stringifyYaml({
    schema_version: 1,
    environments: [
      { id: 'test', name: 'Test', tier: 'test', aliases: ['测试'], deploy: { mode: 'agent', plan_section: SECTION } },
      { id: 'prod', name: 'Production', tier: 'prod' },
    ],
  }));
  put(PLAN_REL, `# 部署方案\n\n## 生产部署\n\n略\n\n## ${SECTION}\n\n1. 按步骤部署到测试环境\n`);
  if (opts.proposal) {
    const dir = join(root, 'logos/changes', SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), [
      '# 变更提案：ship-it', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：测试',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
    ].join('\n'));
    writeFileSync(join(dir, 'tasks.md'), TASKS);
    writeFileSync(join(dir, 'VERIFY_PASS'), '');
    writeLoopPass(dir);
    put('logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core', createdAt: new Date().toISOString() }));
  }
  put('.gitignore', `logos/.openlogos-runtime/\n${ENV_REGISTRY_REL}\n`);
  git(['init', '-q']);
  git(['config', 'user.name', 't']);
  git(['config', 'user.email', 't@example.invalid']);
  put('payload.txt', 'v1\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'v1']);
  git(['tag', 'v1']);
  const v1 = git(['rev-parse', 'HEAD']);
  put('payload.txt', 'head\n');
  git(['commit', '-qam', 'head']);
  tags = { v1, head: git(['rev-parse', 'HEAD']) };
}

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf-8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function deployJson(args: string[]): { status: number | null; data: any; error: any; stderr: string } {
  const r = cli(['deploy', ...args, '--format', 'json']);
  let data = null;
  let error = null;
  try { data = JSON.parse(r.stdout).data; } catch { /* 失败路径无 stdout */ }
  try { error = JSON.parse(r.stderr).error; } catch { /* 成功路径无 stderr envelope */ }
  return { status: r.status, data, error, stderr: r.stderr };
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

const pendingPath = () => join(root, DEPLOY_PENDING_REL, 'test.json');
const proposalDir = () => join(root, 'logos/changes', SLUG);

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

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
});
afterEach(() => {
  cleanup();
});

describe('S42 agent 方式与部署 skill 分发 — 单元测试（environment-deploy 切片 5）', () => {
  it('UT-S42-11: agent 两段式', () => {
    setup();
    // ① 登记未决记录、返回部署方案位置与章节，账本无新增
    const r1 = deployJson(['--env', 'test', '--ref', 'v1']);
    expect(r1.status, r1.stderr).toBe(0);
    expect(r1.data).toMatchObject({
      status: 'awaiting-agent', environment: 'test', mode: 'agent', channel: 'version', ref_requested: tags.v1,
      ref: null, ledger_written: false, plan: { plan_path: PLAN_REL, plan_section: SECTION },
    });
    const deployId = r1.data.deploy_id;
    expect(typeof deployId).toBe('string');
    expect(ledger(), '账本无新增').toEqual([]);
    expect(JSON.parse(readFileSync(pendingPath(), 'utf-8'))).toMatchObject({ deploy_id: deployId, mode: 'agent', plan_section: SECTION, ref_requested: tags.v1 });
    expect(envShow('test').deploy_in_progress).toMatchObject({ deploy_id: deployId, mode: 'agent', unresolved: true });

    // ② 再次部署：环境被占用
    const r2 = deployJson(['--env', 'test', '--ref', 'v1']);
    expect(r2.status).toBe(1);
    expect(r2.error.code).toBe('DEPLOY_IN_PROGRESS');
    expect(r2.error.details.holder).toMatchObject({ deploy_id: deployId, mode: 'agent', unresolved: true });

    // ③ 错误 deploy_id
    const before = readFileSync(pendingPath(), 'utf-8');
    const r3 = deployJson(['--env', 'test', '--complete', 'not-the-id', '--result', 'done']);
    expect(r3.error.code).toBe('DEPLOY_PENDING_NOT_FOUND');
    expect(readFileSync(pendingPath(), 'utf-8')).toBe(before);
    expect(ledger()).toEqual([]);

    // ④ 正确 deploy_id：写入 mode=agent 记录并删除未决记录
    const r4 = deployJson(['--env', 'test', '--complete', deployId, '--result', 'done']);
    expect(r4.status, r4.stderr).toBe(0);
    expect(r4.data).toMatchObject({ status: 'done', deploy_id: deployId, mode: 'agent', ref: tags.v1, ref_source: 'explicit', ledger_written: true });
    expect(ledger()).toEqual([expect.objectContaining({
      deploy_id: deployId, mode: 'agent', result: 'done', ref: tags.v1, ref_source: 'explicit', ref_requested: tags.v1,
      channel: 'version', slug: null, failure_reason: null, duration_ms: null,
    })]);
    expect(existsSync(pendingPath()), '未决记录删除').toBe(false);
    expect(envShow('test')).toMatchObject({ current_ref: tags.v1, deploy_in_progress: null });

    // ⑤ 另一轮：--abandon 解除
    const r5 = deployJson(['--env', 'test', '--ref', 'HEAD']);
    expect(r5.data.status).toBe('awaiting-agent');
    const a5 = deployJson(['--env', 'test', '--abandon', r5.data.deploy_id]);
    expect(a5.status, a5.stderr).toBe(0);
    expect(a5.data).toMatchObject({ status: 'abandoned', deploy_id: r5.data.deploy_id, ledger_written: true });
    expect(ledger().pop()).toMatchObject({ deploy_id: r5.data.deploy_id, mode: 'agent', result: 'unknown', failure_reason: 'abandoned', ref: null });
    expect(existsSync(pendingPath()), '环境释放').toBe(false);
    expect(envShow('test')).toMatchObject({ current_ref: tags.v1, deploy_in_progress: null });

    // --result failed：只追加 failure_reason=agent-reported 的记录
    const r6 = deployJson(['--env', 'test', '--ref', 'HEAD']);
    const f6 = deployJson(['--env', 'test', '--complete', r6.data.deploy_id, '--result', 'failed']);
    expect(f6.status).toBe(1);
    expect(f6.error.code).toBe('DEPLOY_FAILED');
    expect(ledger().pop()).toMatchObject({ deploy_id: r6.data.deploy_id, mode: 'agent', result: 'failed', failure_reason: 'agent-reported', ref: null });
    expect(existsSync(pendingPath())).toBe(false);
    expect(envShow('test').current_ref).toBe(tags.v1);
  });

  it('UT-S42-17: 部署 skill 分发一致性', () => {
    const manifest = JSON.parse(readFileSync(join(CLI_ROOT, 'asset-manifest.json'), 'utf-8'));
    const generator = readFileSync(join(CLI_ROOT, 'scripts/build-asset-manifest.mjs'), 'utf-8');
    // 在临时目录中以仓库生成脚本重新生成插件副本，与已提交的副本逐字节比较
    const tmp = mkdtempSync(join(tmpdir(), 'openlogos-plugin-skills-'));
    try {
      mkdirSync(join(tmp, 'scripts'));
      cpSync(join(REPO, 'scripts/build-plugin-skills.sh'), join(tmp, 'scripts/build-plugin-skills.sh'));
      cpSync(join(REPO, 'skills'), join(tmp, 'skills'), { recursive: true });
      mkdirSync(join(tmp, 'plugin/skills'), { recursive: true });
      const r = spawnSync('bash', ['scripts/build-plugin-skills.sh'], { cwd: tmp, encoding: 'utf-8' });
      expect(r.status, r.stderr).toBe(0);
      for (const skill of ['deployment-designer', 'deployment-executor']) {
        const source = readFileSync(join(REPO, 'skills', skill, 'SKILL.md'));
        const copyPath = join(REPO, 'plugin/skills', skill, 'SKILL.md');
        expect(existsSync(copyPath), `${skill} 插件副本存在`).toBe(true);
        const copy = readFileSync(copyPath);
        expect(copy.equals(readFileSync(join(tmp, 'plugin/skills', skill, 'SKILL.md'))), `${skill} 副本与生成脚本输出一致`).toBe(true);
        // 副本 = 生成脚本注入的 frontmatter + 源文件原文（逐字节）
        const text = copy.toString('utf-8');
        const m = /^---\nname: ([^\n]+)\ndescription: "[^"\n]+"\n---\n\n/.exec(text);
        expect(m?.[1], `${skill} frontmatter`).toBe(skill);
        expect(copy.subarray(Buffer.byteLength(m![0])).equals(source), `${skill} 正文与源文件字节一致`).toBe(true);

        // asset-manifest 同时登记源 skill 与插件副本，哈希与当前文件一致
        const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
        const all = Object.values(manifest).filter(Array.isArray).flat() as Array<{ path: string; sha256: string }>;
        expect(all.find(e => e.path === `skills/${skill}/SKILL.md`)?.sha256, `${skill} 源登记`).toBe(sha(source));
        expect(all.find(e => e.path === `claude-plugin-template/skills/${skill}/SKILL.md`)?.sha256, `${skill} 插件副本登记`).toBe(sha(copy));
        expect(generator).toContain(`'skills/${skill}/SKILL.md'`);
        expect(generator).toContain(`'plugin/skills/${skill}/SKILL.md'`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('S42 agent 方式 — 复核修复（environment-deploy code-r1）', () => {
  it('UT-S42-12: 占用检查与持锁之间他人登记了 agent 未决记录：本次零执行、不覆盖原未决记录（code-r1 F2）', async () => {
    setup();
    // B：另一启动者在本次（A）通过占用检查之后、获取环境锁之前完成登记并释放锁
    const other = JSON.stringify({
      deploy_id: 'deploy-b', environment: 'test', mode: 'agent', provider: null, channel: 'version', slug: null,
      ref_input: 'v1', ref_requested: tags.v1, rollback: false, rollback_from: null, started_at: '2026-10-15T00:00:00.000Z',
      pid: 1, run_id: null, run_url: null, log_path: null, workflow: null, dispatch_ref: null, status_script: null,
      plan_section: SECTION, executed: `agent: ${SECTION}`, previous_ref: null,
    }) + '\n';
    const con = captureConsole();
    const restoreCwd = mockCwd(root);
    const exitSpy = mockProcessExit();
    let exit = 0;
    try {
      await deploy('json', { env: 'test', ref: 'HEAD' }, {
        beforeAcquire: () => {
          mkdirSync(dirname(pendingPath()), { recursive: true });
          writeFileSync(pendingPath(), other);
        },
      });
      exit = Number(takeExitCode() ?? 0);
    } catch (error) {
      const m = /^process\.exit\((\d+)\)$/.exec((error as Error).message);
      if (!m) throw error;
      takeExitCode();
      exit = Number(m[1]);
    } finally {
      exitSpy.mockRestore();
      restoreCwd();
      con.restore();
    }
    expect(exit).toBe(1);
    expect(con.logs).toEqual([]);
    const err = JSON.parse(con.errors[0]).error;
    expect(err.code).toBe('DEPLOY_IN_PROGRESS');
    expect(err.details.holder).toMatchObject({ deploy_id: 'deploy-b', mode: 'agent', unresolved: true });
    expect(readFileSync(pendingPath(), 'utf-8'), '原未决记录字节保留').toBe(other);
    expect(ledger()).toEqual([]);
    expect(existsSync(join(root, 'logos/.openlogos-runtime/deploy-locks/test.lock')), '本次的锁已释放').toBe(false);
  });
});

describe('S42 agent 方式与部署 skill 分发 — 场景测试（environment-deploy 切片 5）', () => {
  it('ST-S42-04: agent 方式提案通道', () => {
    setup({ proposal: true });
    // ① 提案处于 ready-to-deploy：默认提案通道，登记未决记录
    const r1 = deployJson(['--env', 'test']);
    expect(r1.status, r1.stderr).toBe(0);
    expect(r1.data).toMatchObject({ status: 'awaiting-agent', channel: 'proposal', mode: 'agent', ref_input: 'HEAD', ref_requested: tags.head });
    const deployId = r1.data.deploy_id;

    // ② 部署报告不存在：拒绝且不写任何文件
    const before = treeHash();
    const missing = deployJson(['--env', 'test', '--complete', deployId, '--result', 'done']);
    expect(missing.status).toBe(1);
    expect(missing.error.code).toBe('DEPLOYMENT_REPORT_MISSING');
    expect(treeHash(), '零写入').toBe(before);

    // ② 写部署报告后完成：写 DEPLOY_DONE、[deploy] 全勾、账本 mode=agent
    put(REPORT_REL, `# 部署报告\n\n测试环境已按「${SECTION}」部署。\n`);
    const reportBefore = readFileSync(join(root, REPORT_REL), 'utf-8');
    const r2 = cli(['deploy', '--env', 'test', '--complete', deployId, '--result', 'done']);
    expect(r2.status, r2.stderr).toBe(0);
    const marker = JSON.parse(readFileSync(join(proposalDir(), 'DEPLOY_DONE'), 'utf-8'));
    expect(marker).toMatchObject({ deploy_id: deployId, environment: 'test', ref: tags.head, ref_source: 'explicit' });
    expect(readFileSync(join(proposalDir(), 'tasks.md'), 'utf-8')).toContain('- [x] 发布\n- [x] 验证');
    expect(ledger()).toEqual([expect.objectContaining({ deploy_id: deployId, mode: 'agent', channel: 'proposal', slug: SLUG, result: 'done' })]);
    expect(readFileSync(join(root, REPORT_REL), 'utf-8'), 'agent 方式报告由执行者撰写，CLI 不追加').toBe(reportBefore);
    expect(existsSync(pendingPath())).toBe(false);

    // ③ 环境视图
    const view = envShow('test');
    expect(view.last_deploy).toMatchObject({ deploy_id: deployId, mode: 'agent', result: 'done', channel: 'proposal' });
    expect(view.current_ref).toBe(tags.head);
  });
});

// ───────────── 0.16.4 安装态 smoke runner 契约（SMOKE-core-254～257 由 runner 写入 smoke 结果账本） ─────────────

const RUNNER = join(REPO, 'scripts/smoke-environment-deploy-0-16-4.js');
const SMOKE_IDS = ['SMOKE-core-254', 'SMOKE-core-255', 'SMOKE-core-256', 'SMOKE-core-257'];

/** 在一次性「仓库根」中运行 runner：只放候选版本源文件与可选的制品 / 部署记录 / sync 副本。 */
function runRunner(opts: { version: string; tarball?: boolean; record?: boolean; env?: Record<string, string> }): { status: number | null; rows: any[]; stderr: string } {
  const fake = mkdtempSync(join(tmpdir(), 'openlogos-envdeploy-runner-'));
  try {
    mkdirSync(join(fake, 'cli/src/lib'), { recursive: true });
    writeFileSync(join(fake, 'cli/src/lib/local-release-candidate.ts'), `export const LOCAL_RELEASE_CANDIDATE_VERSION = '${opts.version}' as const;\n`);
    if (opts.tarball) writeFileSync(join(fake, `cli/miniidealab-openlogos-${opts.version}.tgz`), 'fake-tarball');
    if (opts.record) {
      mkdirSync(join(fake, 'logos/resources/verify'), { recursive: true });
      const sha = createHash('sha256').update('fake-tarball').digest('hex');
      writeFileSync(join(fake, 'logos/resources/verify/deployment-report.md'), `# 部署记录\n\n${opts.version} ${sha}\n`);
    }
    const resultPath = join(fake, 'out/smoke-results.jsonl');
    const env: Record<string, string | undefined> = { ...process.env, OPENLOGOS_SMOKE_RESULT_PATH: resultPath, ...opts.env };
    for (const k of ['OPENLOGOS_ENVDEPLOY_TARBALL', 'OPENLOGOS_TARBALL']) if (!opts.env?.[k]) delete env[k];
    const r = spawnSync(process.execPath, [RUNNER], { cwd: fake, encoding: 'utf-8', env, timeout: 300_000 });
    const rows = existsSync(resultPath) ? readFileSync(resultPath, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    return { status: r.status, rows, stderr: r.stderr ?? '' };
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
}

describe('0.16.4 安装态 smoke runner 契约（environment-deploy 切片 5）', { timeout: 300_000 }, () => {
  it('适用性：缺候选制品、部署记录或本仓 sync 时为全部四条写显式 skip，不标 platform-unavailable', () => {
    const cases: Array<[string, Parameters<typeof runRunner>[0], string]> = [
      ['候选版本早于 0.16.4', { version: '0.16.3', tarball: true, record: true }, 'candidate-tarball'],
      ['0.16.4 但无制品且未设环境变量', { version: '0.16.4' }, 'candidate-tarball'],
      ['有制品但部署记录未记载 SHA-256', { version: '0.16.4', tarball: true }, 'deployment-record'],
      ['制品与记录齐全但本仓未 sync', { version: '0.16.4', tarball: true, record: true }, 'repo-sync'],
    ];
    for (const [label, opts, missing] of cases) {
      const r = runRunner(opts);
      expect(r.status, `${label}: ${r.stderr}`).toBe(0);
      expect(r.rows.map(x => x.id), label).toEqual(SMOKE_IDS);
      for (const row of r.rows) {
        expect(row, label).toMatchObject({ status: 'skip', missing_requirements: [missing] });
        expect(row.reason_code, label).not.toBe('platform-unavailable');
      }
    }
  });

  it('自测隔离：注入入口须声明自测，自测结果不得写入正式账本', () => {
    const r1 = spawnSync(process.execPath, [RUNNER], {
      cwd: REPO, encoding: 'utf-8', env: { ...process.env, OPENLOGOS_ENVDEPLOY_SMOKE_ENTRY: CLI, OPENLOGOS_SMOKE_RESULT_PATH: join(tmpdir(), 'never.jsonl') },
    });
    expect(r1.status).toBe(2);
    const r2 = spawnSync(process.execPath, [RUNNER], {
      cwd: REPO, encoding: 'utf-8',
      env: { ...process.env, OPENLOGOS_ENVDEPLOY_SMOKE_SELF_TEST: '1', OPENLOGOS_ENVDEPLOY_SMOKE_ENTRY: CLI, OPENLOGOS_SMOKE_RESULT_PATH: '' },
    });
    expect(r2.status).toBe(2);
    const contract = spawnSync(process.execPath, [RUNNER, '--self-test'], { cwd: REPO, encoding: 'utf-8' });
    expect(JSON.parse(contract.stdout)).toMatchObject({ ids: SMOKE_IDS, public_release_commands: [], min_candidate_version: '0.16.4' });
  });

  it('自测：以本地构建为注入入口，安装态行为用例 255～257 通过', () => {
    const out = mkdtempSync(join(tmpdir(), 'openlogos-envdeploy-selftest-'));
    try {
      const resultPath = join(out, 'r.jsonl');
      spawnSync(process.execPath, [RUNNER], {
        cwd: REPO, encoding: 'utf-8', timeout: 300_000,
        env: { ...process.env, OPENLOGOS_ENVDEPLOY_SMOKE_SELF_TEST: '1', OPENLOGOS_ENVDEPLOY_SMOKE_ENTRY: CLI, OPENLOGOS_SMOKE_RESULT_PATH: resultPath },
      });
      const rows = readFileSync(resultPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
      expect(rows.map(r => r.id)).toEqual(SMOKE_IDS);
      for (const row of rows.filter(r => r.id !== 'SMOKE-core-254')) {
        expect(row.status, `${row.id}: ${row.detail}`).toBe('pass');
        expect(row.environment).toBe('self-test-injected-entry');
      }
      // 254 校验的是打包后的安装包（skills 在 prepack 时才复制进包）；本地构建入口只能证明其按行为断言、不会误报 pass 之外的结论
      expect(['pass', 'fail']).toContain(rows[0].status);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
