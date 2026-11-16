/**
 * UT-S32-104..117 / ST-S32-44 / ST-S32-45：切片规划冻结 checkpoint 验收范围（slice-verify-efficient-mode）。
 *
 * 对应功能规格 §2.101.2～§2.101.6，根规范 `spec/test-slice-manifest.md` §2.3.2、§2.4、§3、§6.1，
 * `spec/cli-json-output.md`「status/next slice_verification_state」「openlogos slice plan 输出合同」，
 * 场景 S32「S32 切片规划冻结验收范围时序」EX-32.26～EX-32.32。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts）写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  SLICE_CHECKPOINT_SCHEMA_V1,
  appendSliceCheckpoint,
  computeSliceManifestIdentity,
  type TestSliceManifestV1,
} from '../src/lib/test-slice-manifest.js';
import { slicePlanExitCode } from '../src/commands/slice.js';
import {
  BASE_TARGET, CHANGED, REPO_SCHEMA, baselineIds, catchPlan, checkCodeTasks, cli, cliJson, createScopeFixture,
  currentIdentity, fileState, passAll, passCurrentSlice, plan, readManifest, runNextJson, runStatusJson,
  runVerifyJson, setVerifyConfig, slicesInput, state, tempLeftovers, writeBaseline, writeManifestRaw,
  writeResults, writeSlicesFile, type FixtureOptions, type ScopeFixture,
} from './slice-scope-fixture.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function fx(options: FixtureOptions = {}): ScopeFixture {
  const { fixture, cleanup } = createScopeFixture(options);
  cleanups.push(cleanup);
  return fixture;
}

/** N = 基线数 + 3 个变更用例。 */
function fxN(n: number, options: FixtureOptions = {}): ScopeFixture {
  return fx({ ...options, baseline: baselineIds(n - CHANGED.length) });
}

async function schemaValidator(name: 'status' | 'next') {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const { default: addFormats } = await import('ajv-formats');
  const ajv = new Ajv2020({ strict: false, allowUnionTypes: true });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(join(REPO_SCHEMA, `${name}.schema.json`), 'utf-8')));
  return (data: unknown) => ({ ok: validate(data) as boolean, errors: JSON.stringify(validate.errors) });
}

describe('S32 切片规划冻结验收范围 — 判定', () => {
  it('UT-S32-104: auto 阈值两侧的判定（manual 不计入、不与模块范围求交）', () => {
    const below = fxN(999, { manual: true });
    expect(plan(below)).toMatchObject({ verify_scope: 'baseline', verify_scope_source: 'decided' });
    expect(readManifest(below).verify_scope).toBe('baseline');

    const at = fxN(1000);
    expect(plan(at)).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'decided' });
    expect(readManifest(at).verify_scope).toBe('owned');

    const small = fxN(3, { verify: { slice_scope_threshold: 4 } });
    expect(plan(small)).toMatchObject({ verify_scope: 'baseline', verify_scope_source: 'decided' });
    const four = fxN(4, { verify: { slice_scope_threshold: 4 } });
    expect(plan(four)).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'decided' });

    // 多模块且启用模块范围：N 按全部已定义用例计（core 3 + 1 基线 + team 1 = 5），不与范围求交
    const multi = fx({ team: true, baseline: ['UT-S01-01'], verify: { slice_scope_threshold: 5 } });
    expect(plan(multi)).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'decided' });
  });

  it('UT-S32-105: baseline / owned 强制不看用例数', () => {
    const big = fxN(5000, { verify: { slice_scope: 'baseline' } });
    expect(plan(big)).toMatchObject({ verify_scope: 'baseline', verify_scope_source: 'decided' });
    const tiny = fxN(3, { verify: { slice_scope: 'owned' } });
    expect(plan(tiny)).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'decided' });
  });

  it('UT-S32-106: 配置非法只在判定路径拒绝，沿用路径不受影响', () => {
    const invalid: Array<Record<string, unknown>> = [
      { slice_scope: 'full' },
      { slice_scope_threshold: 0 },
      { slice_scope_threshold: -1 },
      { slice_scope_threshold: 1.5 },
      { slice_scope_threshold: '1000' },
    ];
    for (const patch of invalid) {
      const f = fx({ verify: patch });
      const tasksBefore = fileState(f.tasksPath);
      const error = catchPlan(f);
      expect(error.code).toBe('SLICE_PLAN_VERIFY_SCOPE_CONFIG_INVALID');
      expect(slicePlanExitCode(error.code)).toBe(1);
      const key = Object.keys(patch)[0];
      expect(error.message).toContain(`verify.${key}`);
      expect(error.message).toContain(JSON.stringify(patch[key]));
      expect(fileState(f.tasksPath)).toEqual(tasksBefore);
      expect(existsSync(f.manifestPath)).toBe(false);
      expect(tempLeftovers(f.dir)).toEqual([]);
    }
    // retained 路径不读配置：已冻结 owned 后配置被写坏，同一划分重跑照常成功
    const f = fx({ verify: { slice_scope: 'owned' } });
    plan(f);
    setVerifyConfig(f.root, { slice_scope: 'full' });
    expect(plan(f)).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'retained' });
  });

  it('UT-S32-107: 身份仅 owned 纳入 verify_scope；baseline / 缺省与引入前公式相同', () => {
    const base: TestSliceManifestV1 = {
      schema: 'openlogos/test-slice-manifest@1', change: 'scope-demo', module: 'core',
      task_fingerprint: `sha256:${'a'.repeat(64)}`, spec_fingerprint: `sha256:${'b'.repeat(64)}`,
      generated_at: '2026-11-16T00:00:00.000Z', slices: slicesInput(1),
    };
    // 引入前公式在固定输入上的值（独立于实现计算后固化）
    const LEGACY_GOLDEN = 'sha256:db1b14d5df38b543b2b418f504939533528f994933d40766f2a646e933ae2f3c';
    const OWNED_GOLDEN = 'sha256:beade6ddfb8973fa7620fcddfd6fbdad503c6a8f3c1b5be10ca57263b55c045d';
    expect(computeSliceManifestIdentity(base)).toBe(LEGACY_GOLDEN);
    expect(computeSliceManifestIdentity({ ...base, verify_scope: 'baseline' })).toBe(LEGACY_GOLDEN);
    expect(computeSliceManifestIdentity({ ...base, verify_scope: 'owned' })).toBe(OWNED_GOLDEN);
    expect(OWNED_GOLDEN).not.toBe(LEGACY_GOLDEN);
  });
});

describe('S32 切片规划冻结验收范围 — 沿用、重划与恢复', () => {
  it('UT-S32-108: 用例数跨阈值后同一划分重跑沿用', () => {
    const f = fxN(999);
    plan(f);
    const identity = currentIdentity(f);
    writeBaseline(f, baselineIds(1500 - CHANGED.length));
    expect(plan(f)).toMatchObject({ verify_scope: 'baseline', verify_scope_source: 'retained' });
    expect(currentIdentity(f)).toBe(identity);

    const g = fxN(1000);
    plan(g);
    const ownedIdentity = currentIdentity(g);
    writeBaseline(g, baselineIds(10 - CHANGED.length));
    expect(plan(g)).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'retained' });
    expect(currentIdentity(g)).toBe(ownedIdentity);
  });

  it('UT-S32-109: 反例 a——配置变化后的同一划分恢复保留范围、身份与已确认切片', async () => {
    for (const entry of ['invalid', 'idempotent'] as const) {
      const f = fxN(1200);
      plan(f);
      passCurrentSlice(f);
      const identity = currentIdentity(f);
      setVerifyConfig(f.root, { slice_scope_threshold: 2000 });   // 按当前用例数应判 baseline
      if (entry === 'invalid') {
        const raw = readManifest(f) as unknown as Record<string, unknown>;
        delete raw.module;
        writeManifestRaw(f, raw);
        expect(state(f).reason).toBe('test-slice-manifest-invalid');
        expect((await runNextJson(f.root)).modules[0].next_node.id).toBe('plan-slices');
      }
      expect(plan(f)).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'retained' });
      const after = state(f);
      expect(currentIdentity(f)).toBe(identity);
      expect(after.confirmed_slice_ids).toEqual(['slice-a']);
      expect(after.attempted_slice_id).toBe('slice-b');
    }
  });

  it('UT-S32-110: 反例 b——同样配置变化下真正重划重新判定并使旧身份失效', () => {
    const f = fxN(1200);
    plan(f);
    passCurrentSlice(f);
    const identity = currentIdentity(f);
    const ledger = fileState(f.ledgerPath);
    setVerifyConfig(f.root, { slice_scope_threshold: 2000 });
    expect(plan(f, 2)).toMatchObject({ verify_scope: 'baseline', verify_scope_source: 'decided' });
    const after = state(f);
    expect(currentIdentity(f)).not.toBe(identity);
    expect(after.confirmed_slice_ids).toEqual([]);
    expect(after.attempted_slice_id).toBe('slice-a');
    expect(fileState(f.ledgerPath)).toEqual(ledger);
  });

  it('UT-S32-111: 旧 manifest 缺 verify_scope 时恢复保留 baseline 与身份', () => {
    const f = fxN(5000);   // 按当前配置应判 owned
    plan(f, 1);
    // 模拟升级前写出的 manifest：去掉 verify_scope 字段
    const legacy = readManifest(f) as unknown as Record<string, unknown>;
    delete legacy.verify_scope;
    writeManifestRaw(f, legacy);
    expect(state(f).verify_scope).toBe('baseline');
    passCurrentSlice(f);
    const identity = currentIdentity(f);
    expect(plan(f)).toMatchObject({ verify_scope: 'baseline', verify_scope_source: 'retained' });
    expect(readManifest(f).verify_scope).toBe('baseline');
    expect(currentIdentity(f)).toBe(identity);
    expect(state(f).confirmed_slice_ids).toEqual(['slice-a']);
  });

  it('UT-S32-112: manifest 缺失——账本单命中恢复', () => {
    for (const [frozen, flipped] of [['owned', 'baseline'], ['baseline', 'owned']] as const) {
      const f = fx({ verify: { slice_scope: frozen } });
      plan(f);
      passCurrentSlice(f);
      const identity = currentIdentity(f);
      const ledger = fileState(f.ledgerPath);
      unlinkSync(f.manifestPath);
      setVerifyConfig(f.root, { slice_scope: flipped });
      expect(plan(f)).toMatchObject({ verify_scope: frozen, verify_scope_source: 'recovered' });
      expect(currentIdentity(f)).toBe(identity);
      expect(state(f).confirmed_slice_ids).toEqual(['slice-a']);
      expect(fileState(f.ledgerPath)).toEqual(ledger);
    }
  });

  it('UT-S32-113: manifest 缺失——账本双命中拒绝且零副作用', () => {
    const f = fx({ verify: { slice_scope: 'baseline' } });
    plan(f);
    const current = state(f);
    expect(appendSliceCheckpoint(f.dir, current, 'PASS', '2026-11-16T00:00:00.000Z')).toBe(true);
    const ownedState = { ...current, manifest_data: { ...current.manifest_data!, verify_scope: 'owned' as const } };
    expect(appendSliceCheckpoint(f.dir, ownedState, 'PASS', '2026-11-16T00:00:01.000Z')).toBe(true);
    const baselineId = computeSliceManifestIdentity(current.manifest_data!);
    const ownedId = computeSliceManifestIdentity(ownedState.manifest_data);
    unlinkSync(f.manifestPath);
    const tasksBefore = fileState(f.tasksPath);
    const error = catchPlan(f);
    expect(error.code).toBe('SLICE_PLAN_VERIFY_SCOPE_AMBIGUOUS');
    expect(slicePlanExitCode(error.code)).toBe(1);
    expect(error.message).toContain(baselineId);
    expect(error.message).toContain(ownedId);
    expect(error.message).toContain('slice-a');
    expect(fileState(f.tasksPath)).toEqual(tasksBefore);
    expect(existsSync(f.manifestPath)).toBe(false);
    expect(tempLeftovers(f.dir)).toEqual([]);
  });

  it('UT-S32-114: manifest 缺失——账本无命中按当前配置判定', () => {
    const variants = ['no-ledger', 'v1-only', 'fail-only', 'other-partition'] as const;
    for (const variant of variants) {
      const f = fx({ verify: { slice_scope: 'baseline' } });
      plan(f);
      const current = state(f);
      const manifestBytes = readFileSync(f.manifestPath);
      if (variant === 'v1-only') {
        writeFileSync(f.ledgerPath, `${JSON.stringify({
          schema: SLICE_CHECKPOINT_SCHEMA_V1, slice_id: 'slice-a',
          manifest_sha256: `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`,
          result: 'PASS', eligible_test_ids_sha256: `sha256:${'c'.repeat(64)}`, timestamp: '2026-11-16T00:00:00.000Z',
        })}\n`);
      } else if (variant === 'fail-only') {
        appendSliceCheckpoint(f.dir, current, 'FAIL', '2026-11-16T00:00:00.000Z');
      } else if (variant === 'other-partition') {
        plan(f, 2);
        passCurrentSlice(f);
      }
      unlinkSync(f.manifestPath);
      setVerifyConfig(f.root, { slice_scope: 'owned' });
      expect(plan(f), variant).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'decided' });
    }
  });

  it('UT-S32-115: manifest verify_scope 非法值走既有恢复', async () => {
    const f = fx({ verify: { slice_scope: 'owned' } });
    plan(f);
    passCurrentSlice(f);
    const identity = currentIdentity(f);
    writeManifestRaw(f, { ...readManifest(f), verify_scope: 'full' });
    const s = state(f);
    expect(s.manifest_status).toBe('invalid');
    expect(s.verify_scope).toBeNull();
    const v = s.violations!.find(item => item.path === '$.verify_scope');
    expect(v).toMatchObject({ code: 'test-slice-manifest-invalid' });
    expect(v!.fix_hint).toBeTruthy();
    expect((await runNextJson(f.root)).modules[0].next_node.id).toBe('plan-slices');
    const verified = runVerifyJson(f.root);
    expect(verified.exited).toBe(true);
    expect(existsSync(join(f.dir, 'VERIFY_FAIL'))).toBe(false);
    expect(existsSync(join(f.dir, 'LOOP_ITERS'))).toBe(false);
    setVerifyConfig(f.root, { slice_scope: 'baseline' });
    expect(plan(f)).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'recovered' });
    expect(currentIdentity(f)).toBe(identity);
  });
});

describe('S32 切片规划冻结验收范围 — 机器输出', () => {
  it('UT-S32-116: slice plan 输出带出范围与来源（JSON 与文本）', () => {
    const f = fx({ verify: { slice_scope: 'owned' } });
    const input = writeSlicesFile(f);
    const json = cliJson(f.root, 'slice', 'plan', '--file', input);
    expect(json.status).toBe(0);
    expect(json.json.data).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'decided', slice_count: 2 });
    for (const key of ['slice_ids', 'task_fingerprint', 'spec_fingerprint', 'manifest_path']) expect(json.json.data).toHaveProperty(key);
    expect(readManifest(f).verify_scope).toBe(json.json.data.verify_scope);

    const text = cli(f.root, 'slice', 'plan', '--file', input);
    expect(text.status).toBe(0);
    const lines = text.stdout.split('\n');
    const at = lines.findIndex(line => line.includes('task_fingerprint：'));
    expect(lines[at + 1]).toBe('  验收范围：owned（retained）');
    expect(lines.filter(line => line.includes('验收范围：'))).toHaveLength(1);

    const bad = fx({ verify: { slice_scope: 'full' } });
    const rejected = cliJson(bad.root, 'slice', 'plan', '--file', writeSlicesFile(bad));
    expect(rejected.status).toBe(1);
    expect(rejected.json.error.code).toBe('SLICE_PLAN_VERIFY_SCOPE_CONFIG_INVALID');
    expect(JSON.stringify(rejected.json)).not.toContain('verify_scope_source');
  });

  it('UT-S32-117: status / next 的 slice_verification_state.verify_scope', async () => {
    const validateStatus = await schemaValidator('status');
    const validateNext = await schemaValidator('next');
    const f = fx({ verify: { slice_scope: 'owned' } });
    plan(f);
    const s = runStatusJson(f.root);
    const n = await runNextJson(f.root);
    expect(s.modules[0].slice_verification_state.verify_scope).toBe('owned');
    expect(n.modules[0].slice_verification_state).toEqual(s.modules[0].slice_verification_state);
    expect(validateStatus(s)).toMatchObject({ ok: true });
    expect(validateNext(n)).toMatchObject({ ok: true });

    // 修改配置但不重新 slice plan：字段只读自 manifest，不变
    setVerifyConfig(f.root, { slice_scope: 'baseline' });
    expect(runStatusJson(f.root).modules[0].slice_verification_state.verify_scope).toBe('owned');

    const legacy = readManifest(f) as unknown as Record<string, unknown>;
    delete legacy.verify_scope;
    writeManifestRaw(f, legacy);
    expect(runStatusJson(f.root).modules[0].slice_verification_state.verify_scope).toBe('baseline');

    writeManifestRaw(f, { ...legacy, verify_scope: 'full' });
    expect(runStatusJson(f.root).modules[0].slice_verification_state.verify_scope).toBeNull();

    rmSync(f.manifestPath);
    const missing = runStatusJson(f.root);
    expect(missing.modules[0].slice_verification_state.verify_scope).toBeNull();
    expect((await runNextJson(f.root)).modules[0].slice_verification_state.verify_scope).toBeNull();
    expect(validateStatus(missing)).toMatchObject({ ok: true });
  });
});

describe('S32 切片规划冻结验收范围 — 端到端（真实 CLI）', () => {
  it('ST-S32-44: 配置变化后恢复保进度、重划才重判的端到端', () => {
    const f = fxN(1200);
    const input = writeSlicesFile(f);
    // ① 首次规划冻结 owned
    expect(cliJson(f.root, 'slice', 'plan', '--file', input).json.data)
      .toMatchObject({ verify_scope: 'owned', verify_scope_source: 'decided' });
    // ② 通过切片一并勾选
    writeResults(f.root, passAll(['UT-S90-01', 'UT-S90-02']));
    const first = cliJson(f.root, 'verify');
    expect(first.json.data.gate.result).toBe('PASS');
    expect(first.json.data.eligible_test_ids).toEqual(['UT-S90-01', 'UT-S90-02']);
    checkCodeTasks(f, 1);
    // ③ 阈值调高、manifest 被破坏，按 next 指引以相同 slices.json 重跑
    setVerifyConfig(f.root, { slice_scope_threshold: 2000 });
    const raw = readManifest(f) as unknown as Record<string, unknown>;
    delete raw.module;
    writeManifestRaw(f, raw);
    expect(cliJson(f.root, 'next').json.data.modules[0].next_node.id).toBe('plan-slices');
    expect(cliJson(f.root, 'slice', 'plan', '--file', input).json.data)
      .toMatchObject({ verify_scope: 'owned', verify_scope_source: 'retained' });
    // ④ 进度保住，verify 只验收 3 个 owned 用例
    const resumed = cliJson(f.root, 'next').json.data.modules[0].slice_verification_state;
    expect(resumed).toMatchObject({ confirmed_slice_ids: ['slice-a'], attempted_slice_id: 'slice-b', verify_scope: 'owned' });
    writeResults(f.root, passAll(CHANGED));
    const second = cliJson(f.root, 'verify');
    expect(second.json.data.eligible_test_ids).toEqual(CHANGED);
    expect(second.json.data.gate.result).toBe('PASS');
    // ⑤ 真正重划：按当前配置判定 baseline，旧确认作废，eligible 含基线
    const redivided = cliJson(f.root, 'slice', 'plan', '--file', writeSlicesFile(f, 2)).json.data;
    expect(redivided).toMatchObject({ verify_scope: 'baseline', verify_scope_source: 'decided' });
    const after = cliJson(f.root, 'next').json.data.modules[0].slice_verification_state;
    expect(after.confirmed_slice_ids).toEqual([]);
    expect(after.eligible_test_ids).toEqual(expect.arrayContaining(f.baseline.slice(0, 5)));
  });

  it('ST-S32-45: manifest 缺失时由账本恢复冻结范围的端到端', () => {
    const f = fx({ verify: { slice_scope: 'owned' } });
    const input = writeSlicesFile(f);
    expect(cliJson(f.root, 'slice', 'plan', '--file', input).status).toBe(0);
    writeResults(f.root, passAll(['UT-S90-01', 'UT-S90-02']));
    expect(cliJson(f.root, 'verify').json.data.gate.result).toBe('PASS');
    checkCodeTasks(f, 1);
    // ② 删除 manifest、配置改为 baseline
    rmSync(f.manifestPath);
    setVerifyConfig(f.root, { slice_scope: 'baseline' });
    // ③ next 指向恢复
    const recovering = cliJson(f.root, 'next').json.data.modules[0];
    expect(recovering.slice_verification_state.reason).toBe('test-slice-manifest-missing');
    expect(recovering.next_node.id).toBe('plan-slices');
    // ④ 以相同 slices.json 重跑，由账本恢复 owned
    expect(cliJson(f.root, 'slice', 'plan', '--file', input).json.data)
      .toMatchObject({ verify_scope: 'owned', verify_scope_source: 'recovered' });
    // ⑤ 从切片二继续，eligible 不含基线
    const resumed = cliJson(f.root, 'next').json.data.modules[0].slice_verification_state;
    expect(resumed.attempted_slice_id).toBe('slice-b');
    expect(resumed.eligible_test_ids).toEqual(CHANGED);
    expect(resumed.eligible_test_ids.some((id: string) => f.baseline.includes(id))).toBe(false);
    expect(readFileSync(join(f.root, BASE_TARGET), 'utf8')).toContain('UT-S01-01');
  });
});
