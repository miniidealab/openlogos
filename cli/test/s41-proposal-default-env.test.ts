/**
 * proposal-default-environment 单切片：登记表提案默认部署环境（S41）。
 *
 * 覆盖 UT-S41-20～UT-S41-23、ST-S41-06（logos/resources/test/core-S41-test-cases.md「七、提案默认部署环境测试」）。
 * 规范源：spec/environments.md §2.2、§7.2、§13；spec/cli-json-output.md「`env list`（data）」「`env show`（data）」；
 * 决策 C01～C09、D15，proposal delta-r1 F1。UT 以进程内调用驱动，ST-S41-06 与 status 断言走真实 CLI 入口
 * cli/dist/index.js。全部在一次性临时项目中构造。结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { captureConsole, makeTempRoot, scaffoldProject, takeExitCode } from './helpers.js';
import { ENV_REGISTRY_REL, loadEnvironmentRegistry } from '../src/lib/environments.js';
import { envCheck, envList, envShow } from '../src/commands/env.js';
// @ts-expect-error 夹具为 ESM .mjs（与基线生成脚本共用），无类型声明
import { observeGateFixtures } from './golden/s41-gate-zero-regression-fixture.mjs';
// @ts-expect-error 同上
import { REGISTRY_WITH_DEFAULT, observeDefaultEnvFixture } from './golden/s41-proposal-default-env-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const REPO = resolve(HERE, '../..');
const GATE_BASELINE = join(HERE, 'golden', 's41-gate-zero-regression-baseline.json');
const DEFAULT_BASELINE = join(HERE, 'golden', 's41-proposal-default-env-baseline.json');
const FIELD = 'proposal_default_env';
const DEPLOY_PLAN_REL = 'logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md';
const DEPLOY_KEYS = [
  'mode', 'script', 'args', 'workdir', 'timeout_sec', 'provider', 'workflow', 'workflow_ref', 'inputs',
  'poll_interval_sec', 'trigger_script', 'status_script', 'plan_section',
];

let root: string;
let cleanup: () => void;

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  scaffoldProject(root, { locale: 'en' });
});
afterEach(() => cleanup());

function put(rel: string, content: string, at: string = root): void {
  mkdirSync(dirname(join(at, rel)), { recursive: true });
  writeFileSync(join(at, rel), content);
}

/**
 * 登记表：test（aliases 含「测试」，无 deploy）、staging（deploy）、prod（deploy + promote_from + require_approval）。
 * top 为写在 schema_version 之后的顶层行；prodDeploy 覆盖 prod 的 deploy 映射。
 */
function registry(top: string[] = [], prodDeploy = '{mode: script, script: deploy/prod.sh}', at: string = root, secrets = false): void {
  put(ENV_REGISTRY_REL, [
    'schema_version: 1', ...top, 'environments:',
    '  - {id: test, name: Test, tier: test, aliases: [测试]}',
    '  - {id: staging, name: Staging, tier: staging, deploy: {mode: script, script: deploy/staging.sh}}',
    `  - {id: prod, name: Production, tier: prod, aliases: [生产], ${secrets ? 'secrets: [PROD_TOKEN], ' : ''}deploy: ${prodDeploy}, promote_from: staging, require_approval: true}`,
    '',
  ].join('\n'), at);
}

function runJson(fn: () => void): any {
  const con = captureConsole();
  try {
    fn();
    return JSON.parse(con.logs[con.logs.length - 1]).data;
  } finally {
    con.restore();
    takeExitCode();
  }
}

async function checkJson(at: string = root): Promise<{ exit: unknown; data: any }> {
  const con = captureConsole();
  try { await envCheck(undefined, {}, 'json', at); } finally { con.restore(); }
  return { exit: takeExitCode(), data: JSON.parse(con.logs[con.logs.length - 1]).data };
}

function textOf(fn: () => void): string {
  const con = captureConsole();
  try { fn(); } finally { con.restore(); takeExitCode(); }
  return con.logs.join('\n');
}

function cli(args: string[], at: string = root, env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: at, encoding: 'utf-8', timeout: 120_000, env: { ...process.env, NO_COLOR: '1', ...env } });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const fieldIssues = (issues: any[]) => issues.filter(i => i.field === FIELD);

describe('S41 提案默认部署环境 — 单元测试（proposal-default-environment）', () => {
  it('UT-S41-20: proposal_default_env 校验', async () => {
    const valid: Array<[string, string[], string | null]> = [
      ['① 指向未配置 deploy 的环境', [`${FIELD}: test`], 'test'],
      ['② 指向配置了晋级与审批门禁的环境', [`${FIELD}: prod`], 'prod'],
      ['③ null', [`${FIELD}: null`], null],
      ['④ 不写该字段', [], null],
    ];
    for (const [label, top, expected] of valid) {
      registry(top);
      const reg = loadEnvironmentRegistry(root);
      if (reg.state !== 'loaded') throw new Error(`${label}: registry not loaded`);
      expect(fieldIssues(reg.errors), `${label} 无 error`).toEqual([]);
      expect(fieldIssues(reg.warnings), `${label} 无 ENV_UNKNOWN_FIELD`).toEqual([]);
      expect(reg.errors, `${label} 登记表合法`).toEqual([]);
      expect(reg.proposalDefaultEnv, label).toBe(expected);
      const { exit, data } = await checkJson();
      expect(exit, `${label} env check 退出码`).toBeUndefined();
      expect(fieldIssues(data.errors), label).toEqual([]);
      expect(fieldIssues(data.warnings), label).toEqual([]);
    }

    const invalid: Array<[string, string, RegExp]> = [
      ['⑤ 未登记', `${FIELD}: stage`, /unregistered environment "stage"/],
      ['⑥ alias', `${FIELD}: 测试`, /not an alias or differently-cased id \(did you mean test\?\)/],
      ['⑦ 大小写不一致', `${FIELD}: Test`, /did you mean test\?/],
      ['⑧ 数字', `${FIELD}: 3`, /must be the id of a registered environment/],
      ['⑨ 数组', `${FIELD}: [test]`, /must be the id of a registered environment/],
    ];
    for (const [label, top, reason] of invalid) {
      registry([top]);
      const reg = loadEnvironmentRegistry(root);
      if (reg.state !== 'loaded') throw new Error(`${label}: registry not loaded`);
      const issues = fieldIssues(reg.errors);
      expect(issues, `${label} 恰好一条 ENV_FIELD_INVALID`).toHaveLength(1);
      expect(issues[0].code, label).toBe('ENV_FIELD_INVALID');
      expect(issues[0], `${label} 不带 environment`).not.toHaveProperty('environment');
      expect(issues[0].reason, label).toMatch(reason);
      expect(reg.proposalDefaultEnv, label).toBeNull();
      const { exit, data } = await checkJson();
      expect(exit, `${label} env check 退出码`).toBe(1);
      expect(data.ok, label).toBe(false);
      const out = fieldIssues(data.errors);
      expect(out.map((e: any) => e.code), label).toEqual(['ENV_FIELD_INVALID']);
      expect(out[0], label).not.toHaveProperty('environment');
      expect(out[0].message, `${label} 顶层字段文案不含空环境名`).toMatch(/^Registry field proposal_default_env is invalid/);
    }
  });

  it('UT-S41-21: env list 输出', async () => {
    // 配置时：data 顶层输出 proposal_default_env，文本模式只在该环境行后标注
    registry([`${FIELD}: test`]);
    const listed = runJson(() => envList('json', root));
    expect(listed[FIELD]).toBe('test');
    const en = textOf(() => envList('text', root)).split('\n');
    expect(en.find(l => l.startsWith('  test  '))).toBe('  test  Test  [test]  (proposal default)');
    expect(en.find(l => l.startsWith('  prod  '))).toBe('  prod  Production  [prod]');
    expect(en.filter(l => l.includes('(proposal default)'))).toHaveLength(1);

    const zh = makeTempRoot();
    try {
      scaffoldProject(zh.root, { locale: 'zh' });
      registry([`${FIELD}: test`], undefined, zh.root);
      const lines = textOf(() => envList('text', zh.root)).split('\n');
      expect(lines.find(l => l.startsWith('  test  '))).toBe('  test  Test  [test]  （提案默认）');
      expect(lines.filter(l => l.includes('提案默认'))).toHaveLength(1);
    } finally {
      zh.cleanup();
    }

    // env show / env check / status 不输出 proposal_default_env
    expect(runJson(() => envShow('test', 'json', root))).not.toHaveProperty(FIELD);
    expect((await checkJson()).data).not.toHaveProperty(FIELD);
    const status = cli(['status', '--format', 'json']);
    expect(status.stdout).not.toContain(`"${FIELD}"`);

    // 未配置时：data 不含该键，文本无标注
    registry([]);
    expect(runJson(() => envList('json', root))).not.toHaveProperty(FIELD);
    expect(textOf(() => envList('text', root))).not.toContain('(proposal default)');
    expect(runJson(() => envShow('test', 'json', root))).not.toHaveProperty(FIELD);
    expect((await checkJson()).data).not.toHaveProperty(FIELD);
  }, 60_000);

  it('UT-S41-22: change-writer 含默认环境规则与必须提问的负例', () => {
    const cw = readFileSync(join(REPO, 'skills/change-writer/SKILL.md'), 'utf-8');
    const dd = readFileSync(join(REPO, 'skills/deployment-designer/SKILL.md'), 'utf-8');
    const section = cw.slice(cw.indexOf('#### 部署决定与提案默认部署环境'));
    expect(section.length).toBeGreaterThan(100);
    const rules = [
      // 读取路径：env list 取默认值，env show 取实际部署引用，不解析登记表原文
      'openlogos env list --format json', 'openlogos env show <id> --format json', '不解析登记表原文',
      // 目标环境优先级：用户指定 → 登记表默认（source: policy）→ 维持必问
      '按用户原话，`source: user`', '`source: policy`', '**不再询问目标环境**', '维持必问',
      // 四种必须提问的负例
      'agent 方式的 `environment.deploy.plan_section` 在已合并部署方案中没有同名章节',
      '配置了 `deploy` 但 `current_ref` 为 null 且没有首次部署失败处置',
      '**未配置 `deploy`（即使 `current_ref` 非 null）且已合并方案没有该环境的回滚步骤**',
      '两者都没有（smoke 只会汇总已有结果，不产生本次新结果）',
      // 授权边界与字段归属
      '默认值不参与', '默认值不构成部署执行授权，也不构成公开发布授权', '不写入、不修改、不删除 `proposal_default_env`',
    ];
    for (const rule of rules) expect(section, `change-writer 含：${rule}`).toContain(rule);
    expect(dd).toContain('**只在用户明确指定时写入**');
    expect(dd).toContain('`proposal_default_env: <环境 id>`');

    // sync 部署到中文项目的副本与根 Skill 逐字节一致
    const tmp = mkdtempSync(join(tmpdir(), 'ol-s41-sync-zh-'));
    try {
      expect(spawnSync('git', ['init', '-q'], { cwd: tmp }).status).toBe(0);
      const init = cli(['init', '--locale', 'zh', '--ai-tool', 'other'], tmp);
      expect(init.status, init.stderr).toBe(0);
      const sync = cli(['sync'], tmp);
      expect(sync.status, sync.stderr).toBe(0);
      for (const name of ['change-writer', 'deployment-designer']) {
        const deployed = readFileSync(join(tmp, 'logos/skills', name, 'SKILL.md'));
        const source = readFileSync(join(REPO, 'skills', name, 'SKILL.md'));
        expect(deployed.equals(source), `${name} 逐字节一致`).toBe(true);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it('UT-S41-23: env show 输出实际部署引用（成对夹具）', () => {
    const secret = 's3cr3t-value-should-never-print';
    const prev = process.env.PROD_TOKEN;
    process.env.PROD_TOKEN = secret;
    try {
      const sectionExists = (title: string) => readFileSync(join(root, DEPLOY_PLAN_REL), 'utf-8')
        .split('\n').some(l => /^#{1,6} /.test(l) && l.replace(/^#{1,6} /, '').trim() === title);
      put(DEPLOY_PLAN_REL, '# 部署方案\n\n## 生产环境发布步骤\n\n1. 发布。\n');

      const show = (prodDeploy: string) => {
        registry([`${FIELD}: prod`], prodDeploy, root, true);
        const con = captureConsole();
        try { envShow('prod', 'json', root); } finally { con.restore(); takeExitCode(); }
        const raw = con.logs[con.logs.length - 1];
        return { raw, data: JSON.parse(raw).data };
      };

      const existing = show('{mode: agent, plan_section: 生产环境发布步骤}');
      const missing = show('{mode: agent, plan_section: 不存在的章节}');
      const script = show('{mode: script, script: deploy/prod.sh}');

      // ①② 成对夹具：只有 plan_section 不同，输出可区分，并据此在夹具部署方案中查验
      expect(existing.data.environment.deploy.mode).toBe('agent');
      expect(missing.data.environment.deploy.mode).toBe('agent');
      expect(existing.data.environment.deploy.plan_section).toBe('生产环境发布步骤');
      expect(missing.data.environment.deploy.plan_section).toBe('不存在的章节');
      expect(existing.data.environment.deploy).not.toEqual(missing.data.environment.deploy);
      expect(sectionExists(existing.data.environment.deploy.plan_section)).toBe(true);
      expect(sectionExists(missing.data.environment.deploy.plan_section)).toBe(false);
      // ③ script 引用
      expect(script.data.environment.deploy).toMatchObject({ mode: 'script', script: 'deploy/prod.sh', plan_section: null });

      for (const out of [existing, missing, script]) {
        // 字段集与登记表 deploy（§11.2）一一对应，不含命令字段；输出不含密钥值，secrets 只有变量名
        expect(Object.keys(out.data.environment.deploy).sort()).toEqual([...DEPLOY_KEYS].sort());
        expect(out.raw).not.toContain(secret);
        expect(out.data.environment.secrets).toEqual(['PROD_TOKEN']);
      }

      // 未配置 deploy 的环境：environment 不含 deploy 键，字段集与引入前一致
      registry([`${FIELD}: prod`]);
      const test = runJson(() => envShow('test', 'json', root));
      expect(Object.keys(test.environment)).toEqual(['id', 'name', 'tier', 'aliases', 'description', 'health', 'version', 'secrets']);
    } finally {
      if (prev === undefined) delete process.env.PROD_TOKEN; else process.env.PROD_TOKEN = prev;
    }
  });
});

describe('S41 提案默认部署环境 — 场景测试（proposal-default-environment）', () => {
  it('ST-S41-06: 默认环境端到端与未配置零回归、0.16.5 读取兼容', () => {
    // ① 夹具 A（无登记表）、B（有登记表、未写该字段、所有环境未配置 deploy）：输出、退出码、账本字节与提案目录
    //    与引入前基线逐字一致（复用 ST-S41-05 的夹具与 0.16.4 基线；两夹具的输出自 0.16.4 起未变，ST-S41-05 持续守护）
    const baseline = JSON.parse(readFileSync(GATE_BASELINE, 'utf-8'));
    const current = observeGateFixtures(CLI);
    for (const name of ['no-registry', 'registry-without-gates']) {
      expect(current[name], `${name} 与引入前基线逐字一致`).toEqual(baseline[name]);
      expect(JSON.stringify(current[name])).not.toContain(`"${FIELD}"`);
    }
    // env check：A 报 ENV_REGISTRY_NOT_FOUND；B 合法、无任何警告
    const a = makeTempRoot();
    try {
      scaffoldProject(a.root, { locale: 'en' });
      const r = cli(['env', 'check', '--format', 'json'], a.root);
      expect(r.status).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('ENV_REGISTRY_NOT_FOUND');
      put(ENV_REGISTRY_REL, 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test, aliases: [测试]}\n  - {id: prod, name: Production, tier: prod, aliases: [生产]}\n', a.root);
      const b = cli(['env', 'check', '--format', 'json'], a.root);
      expect(b.status, b.stderr).toBe(0);
      const bData = JSON.parse(b.stdout).data;
      expect(bData.errors).toEqual([]);
      expect(bData.warnings).toEqual([]);
      expect(b.stdout).not.toContain(`"${FIELD}"`);
    } finally {
      a.cleanup();
    }

    // ② 夹具 C（合法默认环境）：env check 退出码 0，env list 输出 proposal_default_env
    put(ENV_REGISTRY_REL, REGISTRY_WITH_DEFAULT);
    const c = cli(['env', 'check', '--format', 'json']);
    expect(c.status, c.stderr).toBe(0);
    expect(fieldIssues(JSON.parse(c.stdout).data.warnings)).toEqual([]);
    const cList = cli(['env', 'list', '--format', 'json']);
    expect(cList.status).toBe(0);
    expect(JSON.parse(cList.stdout).data[FIELD]).toBe('test');

    // ③ 夹具 D（指向未登记环境，且有可部署的活跃提案）：env check 报 ENV_FIELD_INVALID；
    //    deploy-done / smoke 以 ENV_REGISTRY_INVALID 零副作用拒绝（不写 marker、不写账本、不运行 smoke.command）
    const d = mkdtempSync(join(tmpdir(), 'ol-s41-default-invalid-'));
    try {
      const slug = 'ship-it';
      put('logos/logos.config.json', JSON.stringify({
        name: 'fixture', locale: 'en',
        documents: { test: { label: { en: 'Test' }, path: './resources/test', pattern: '**/*.md' } },
        smoke: { result_path: 'logos/resources/verify/smoke-results.jsonl', sandbox_mode: 'off', command: 'node tools/runner.js' },
      }, null, 2), d);
      put('logos/logos-project.yaml', 'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\ndeployment_gates:\n  core:\n    deployment_required: true\n    smoke_required: true\n', d);
      put('logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-01 | a |\n', d);
      put('tools/runner.js', "require('fs').writeFileSync('RUNNER_RAN', '1');\n", d);
      put('logos/resources/verify/deployment-report.md', '# Deployment Report\n\nok\n', d);
      put(ENV_REGISTRY_REL, `schema_version: 1\n${FIELD}: stage\nenvironments:\n  - {id: test, name: Test, tier: test}\n`, d);
      put(`logos/changes/${slug}/proposal.md`, [
        '# 变更提案：ship-it', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：test',
        '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
      ].join('\n'), d);
      put(`logos/changes/${slug}/tasks.md`, '# 实现任务\n\n## [code] 代码实现\n- [x] 改代码\n\n## [deploy] 部署任务\n- [ ] 发布\n', d);
      put(`logos/changes/${slug}/VERIFY_PASS`, '', d);
      put('logos/.openlogos-guard', JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-10-16T00:00:00.000Z' }), d);
      const gitEnv = { GIT_AUTHOR_NAME: 'f', GIT_AUTHOR_EMAIL: 'f@example.invalid', GIT_COMMITTER_NAME: 'f', GIT_COMMITTER_EMAIL: 'f@example.invalid' };
      for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-qm', 'fixture']]) {
        expect(spawnSync('git', args, { cwd: d, env: { ...process.env, ...gitEnv } }).status).toBe(0);
      }
      const snapshot = () => {
        const files: Record<string, string> = {};
        const walk = (rel: string) => {
          for (const entry of readdirSync(join(d, rel), { withFileTypes: true })) {
            const sub = rel ? `${rel}/${entry.name}` : entry.name;
            if (sub === '.git') continue;
            if (entry.isDirectory()) walk(sub);
            else files[sub] = createHash('sha256').update(readFileSync(join(d, sub))).digest('hex');
          }
        };
        walk('');
        return files;
      };

      const check = cli(['env', 'check', '--format', 'json'], d);
      expect(check.status).toBe(1);
      const checkErrors = fieldIssues(JSON.parse(check.stdout).data.errors);
      expect(checkErrors.map((e: any) => e.code)).toEqual(['ENV_FIELD_INVALID']);

      const rejects = (args: string[]) => {
        const before = snapshot();
        const r = cli(args, d);
        expect(r.status, args.join(' ')).toBe(1);
        expect(JSON.parse(r.stderr).error.code, args.join(' ')).toBe('ENV_REGISTRY_INVALID');
        expect(snapshot(), `${args[0]} 零副作用：文件集合与字节不变`).toEqual(before);
      };
      // deploy-done：提案前置已满足（verify 通过、需要部署、[deploy] 未勾），登记表非法即拒绝
      rejects(['deploy-done', '--env', 'test', '--ref', 'HEAD', '--format', 'json']);
      // smoke：登记表分类在 smoke 既有前置之后（spec/environments.md §4.2），先构造「已部署」状态再验证拒绝
      put(`logos/changes/${slug}/tasks.md`, '# 实现任务\n\n## [code] 代码实现\n- [x] 改代码\n\n## [deploy] 部署任务\n- [x] 发布\n', d);
      put(`logos/changes/${slug}/DEPLOY_DONE`, '', d);
      rejects(['smoke', '--env', 'test', '--format', 'json']);
      expect(existsSync(join(d, 'RUNNER_RAN')), '未运行 smoke.command').toBe(false);
      expect(readFileSync(join(d, `logos/changes/${slug}/DEPLOY_DONE`), 'utf-8'), 'DEPLOY_DONE 未被改写').toBe('');
      expect(existsSync(join(d, `logos/changes/${slug}/SMOKE_PASS`)) || existsSync(join(d, `logos/changes/${slug}/SMOKE_FAIL`))).toBe(false);
      expect(existsSync(join(d, 'logos/.openlogos-runtime/deployments.jsonl'))).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }

    // ④ 0.16.5 读取方（基线由 0.16.5 CLI 实测）：只多一条 ENV_UNKNOWN_FIELD（field=proposal_default_env），其余结果与 ② 一致
    const old = JSON.parse(readFileSync(DEFAULT_BASELINE, 'utf-8'));
    const now = observeDefaultEnvFixture(CLI);
    expect(old.steps.map((s: any) => s.exit)).toEqual([0, 0]);
    expect(now.steps.map((s: any) => s.exit)).toEqual([0, 0]);
    for (let i = 0; i < old.steps.length; i++) {
      const o = old.steps[i].stdout.data;
      const n = now.steps[i].stdout.data;
      expect(o.warnings, `${old.steps[i].args} 0.16.5 只多一条警告`).toEqual([
        { code: 'ENV_UNKNOWN_FIELD', message: 'Unknown field proposal_default_env (ignored).', field: FIELD },
      ]);
      expect(n.warnings).toEqual([]);
      const { warnings: _ow, ...oRest } = o;
      const { warnings: _nw, [FIELD]: added, ...nRest } = n;
      if (i === 1) expect(added).toBe('test'); else expect(added).toBeUndefined();
      expect(nRest, `${old.steps[i].args} 其余输出与 0.16.5 一致`).toEqual(oRest);
    }
  }, 300_000);
});
