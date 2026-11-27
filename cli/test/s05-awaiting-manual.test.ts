/**
 * S05 等待人工验收的 next 建议（smoke-manual-acceptance，切片 slice-03-accept-gate-waiting-archive）。
 *
 * 覆盖 UT-S05-58～UT-S05-66，对应场景 S05「等待人工验收的 next 建议」与 EX-5.6～EX-5.8，功能规格 §2.107.7～§2.107.9。
 * 全部用例在一次性 git 项目中构造（活跃提案已部署到开启人工验收的 prod，账本与标记按用例构造）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { readProposalManualState } from '../src/lib/proposal-manual-state.js';
import {
  LEDGER_REL, PROPOSAL_DIR, SLUG, acceptJson, cli, deployDone, head, ledgerDeploy, ledgerManual, ledgerRows, manualProject, nextJson, smokeJson,
} from './s46-manual-fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function waiting() {
  const root = manualProject(cleanups);
  const d = deployDone(root);
  const s = smokeJson(root);
  expect(s.out.data.gate.result).toBe('PENDING');
  return { root, d };
}

describe('S05 等待人工验收（smoke-manual-acceptance）', () => {
  it('UT-S05-58: pending 派生驻留态与建议', () => {
    const { root, d } = waiting();
    const n = nextJson(root).out.data;
    expect(n.proposal_step).toBe('awaiting-manual-acceptance');
    // 评审 code-r1 F2：结果不预填，占位符整体加引号
    expect(n.command).toBe(`openlogos accept --env prod --deploy ${d} --case SMOKE-core-901,ST-S01-05 --result '<pass 或 fail>'`);
    expect(n.command).not.toContain('|');
    expect(n.detail).toMatch(/only be recorded by a human|只能由人记录/);
    expect(n.detail).toMatch(/replace '<pass 或 fail>'|替换为 pass 或 fail/);
    // 按终端实际解析原样执行建议命令（shell 函数把 openlogos 指向构建产物）：未替换占位符时被拒绝、账本零写入
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('OPENLOGOS_')));
    const ledgerBefore = readFileSync(join(root, LEDGER_REL), 'utf-8');
    const sh = spawnSync('bash', ['-c', `openlogos() { node ${JSON.stringify(CLI)} "$@" --format json; }\n${n.command}`], { cwd: root, encoding: 'utf-8', env });
    expect(sh.status).not.toBe(0);
    expect(sh.stderr).toContain('ACCEPT_ARGS_INVALID');
    expect(readFileSync(join(root, LEDGER_REL), 'utf-8')).toBe(ledgerBefore);
    expect(ledgerRows(root).filter(r => r.kind === 'manual')).toEqual([]);
    expect(n.auto_execute).toBeFalsy();
    expect(n.manual_acceptance).toEqual({ environment: 'prod', deploy_id: d, remaining: ['SMOKE-core-901', 'ST-S01-05'] });
    const st = cli(root, ['status', '--format', 'json']).out.data;
    expect(st.proposal_step ?? st.active_change?.proposal_step).toBe('awaiting-manual-acceptance');
  });

  it('UT-S05-59: --auto 不放行', () => {
    const { root } = waiting();
    const n = nextJson(root, true).out.data;
    expect(n.proposal_step).toBe('awaiting-manual-acceptance');
    expect(n.auto_execute).toBeFalsy();
    expect(n.gate_auto_passed).not.toBe(true);
    expect(existsSync(join(PROPOSAL_DIR(root), 'GATE_AUTO_PASSED'))).toBe(false);
  });

  it('UT-S05-60: 剩余为空时建议重跑 smoke', () => {
    const { root, d } = waiting();
    acceptJson(root, ['--deploy', d, '--case', 'SMOKE-core-901,ST-S01-05', '--result', 'pass']);
    const plain = nextJson(root).out.data;
    expect(plain.proposal_step).toBe('awaiting-manual-acceptance');
    expect(plain.command).toBe('openlogos smoke --env prod');
    expect(plain.auto_execute).toBeFalsy();
    const auto = nextJson(root, true).out.data;
    expect(auto.auto_execute).toBe(true);
    expect(auto.command).toBe('openlogos smoke --env prod');
  });

  it('UT-S05-61: 派生只读账本（不调用 git）', () => {
    const { root, d } = waiting();
    // 移走 .git 并清空 PATH：只读账本的派生结果不变（任何 git 调用都会失败）
    rmSync(join(root, '.git'), { recursive: true, force: true });
    const saved = process.env.PATH;
    process.env.PATH = '';
    let state: ReturnType<typeof readProposalManualState>;
    try { state = readProposalManualState(root, SLUG); } finally { process.env.PATH = saved; }
    expect(state!.waiting).toEqual({ deploy_id: d, remaining: ['SMOKE-core-901', 'ST-S01-05'] });
  });

  it('UT-S05-62: 重新部署后旧 pending 失效', () => {
    const { root } = waiting();
    deployDone(root);
    expect(nextJson(root).out.data.proposal_step).toBe('ready-to-smoke');
    // 评审 code-r1 F4：D1 等待中，经版本通道把同一环境部署为 D2（提案 DEPLOY_DONE 仍指向 D1）
    const v = waiting();
    ledgerDeploy(v.root, 'prod', 'd2', head(v.root));
    expect(readProposalManualState(v.root, SLUG)!.waiting).toBeNull();
    const n = nextJson(v.root).out.data;
    expect(n.proposal_step).not.toBe('awaiting-manual-acceptance');
    expect(String(n.command ?? '')).not.toContain('openlogos accept');
    expect(n.manual_acceptance ?? null).toBeNull();
    const st = cli(v.root, ['status', '--format', 'json']).out.data;
    expect(st.proposal_step ?? st.active_change?.proposal_step).not.toBe('awaiting-manual-acceptance');
  });

  it('UT-S05-63: 通过已过期或不属于本部署', () => {
    // ① 通过后又记录 manual
    const { root, d } = waiting();
    acceptJson(root, ['--deploy', d, '--case', 'SMOKE-core-901,ST-S01-05', '--result', 'pass']);
    expect(smokeJson(root).out.data.gate.result).toBe('PASS');
    ledgerManual(root, 'prod', d, 'ST-S01-05', 'fail', '更正');
    expect(existsSync(join(PROPOSAL_DIR(root), 'SMOKE_PASS'))).toBe(true);
    expect(nextJson(root).out.data.proposal_step).toBe('ready-to-smoke');
    // ② 开启人工验收，SMOKE_PASS 来自旧部署 D1，DEPLOY_DONE 指向 D2、D2 没有 smoke 记录
    const p2 = waiting();
    acceptJson(p2.root, ['--deploy', p2.d, '--case', 'SMOKE-core-901,ST-S01-05', '--result', 'pass']);
    smokeJson(p2.root);
    const marker = readFileSync(join(PROPOSAL_DIR(p2.root), 'DEPLOY_DONE'), 'utf-8');
    deployDone(p2.root);
    writeFileSync(join(PROPOSAL_DIR(p2.root), 'SMOKE_PASS'), '');
    expect(readFileSync(join(PROPOSAL_DIR(p2.root), 'DEPLOY_DONE'), 'utf-8')).not.toBe(marker);
    expect(nextJson(p2.root).out.data.proposal_step).toBe('ready-to-smoke');
  });

  it('UT-S05-64: 版本通道不派生提案驻留态', () => {
    const root = manualProject(cleanups, { proposal: false });
    ledgerDeploy(root, 'prod', 'd1', head(root));
    expect(smokeJson(root).out.data.gate.result).toBe('PENDING');
    const n = nextJson(root).out.data;
    expect(n.proposal_step).not.toBe('awaiting-manual-acceptance');
    const st = cli(root, ['status', '--format', 'json']).out.data;
    const prod = st.environments.find((e: any) => e.id === 'prod');
    expect(prod.manual_acceptance.waiting).toEqual({ deploy_id: 'd1', remaining: ['SMOKE-core-901', 'ST-S01-05'] });
  });

  it('UT-S05-65: 没有 pending 时既有派生不变', () => {
    const root = manualProject(cleanups, { prodManual: null, manualRows: [], manualSmoke: [] });
    expect(nextJson(root).out.data.proposal_step).toBe('ready-to-deploy');
    deployDone(root);
    const n1 = nextJson(root).out.data;
    expect(n1.proposal_step).toBe('ready-to-smoke');
    expect('manual_acceptance' in n1).toBe(false);
    expect(smokeJson(root).status).toBe(0);
    expect(nextJson(root).out.data.proposal_step).toBe('smoke-passed');
    expect(existsSync(join(root, LEDGER_REL))).toBe(true);
  });

  it('UT-S05-66: next.schema.json 覆盖新驻留态', () => {
    const { root } = waiting();
    const data = nextJson(root).out.data;
    const schema = JSON.parse(readFileSync(resolve(HERE, '../../spec/schema/next.schema.json'), 'utf-8'));
    const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown } })({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    expect(validate(data), JSON.stringify((validate as { errors?: unknown }).errors)).toBe(true);
  });
});
