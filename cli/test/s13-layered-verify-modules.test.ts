/**
 * layered-verification 切片 2：分层验收与按模块限定范围（§2.96）并存——按模块级扩大、命令组选择、
 * 共享标志独立采信、已识别场景保留、环境预检针对本次实际执行的命令组（多模块夹具 LV-mod）。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 分层验收测试」严格对齐：UT-S13-236、237、270、271、272。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 夹具 LV-mod：模块 core / backend / web，各有命令组；测试规格 core-S01（2 条）、core-S03（2 条，主链路 UT-S03-01）、
 * backend-S05（2 条 + 本提案新增 UT-S05-03）、backend-S06（1 条）、web-S07（2 条）；提案属于 backend，只改动 backend/**。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { createLv, declarationYaml, destroyLv, runVerify } from './golden/s13-layered-fixture.mjs';

vi.setConfig({ testTimeout: 180_000 });

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'index.js');
const BACKEND = ['UT-S05-01', 'UT-S05-02', 'UT-S05-03', 'UT-S06-01'];
const ALL = ['UT-S01-01', 'UT-S01-02', 'UT-S03-01', 'UT-S03-02', ...BACKEND, 'UT-S07-01', 'UT-S07-02'].sort();

type Lv = ReturnType<typeof createLv>;
const made: Lv[] = [];
afterEach(() => { while (made.length) destroyLv(made.pop()!); });
function lvMod(opts: Record<string, unknown> = {}): Lv {
  const f = createLv({ mod: true, buildTestChangeSet, ...opts });
  made.push(f);
  return f;
}
const verify = (f: Lv, env: Record<string, string | undefined> = {}) => runVerify(CLI, f, { env });
const runners = (run: { calls: any[] }): string[] => run.calls.map(c => c.runner);
const reasonCodes = (data: any): string[] => data.layers.expansion.reasons.map((r: any) => r.code);

describe('S13 分层验收 — 与按模块限定范围并存', () => {
  it('UT-S13-236: 按模块级扩大', () => {
    const run = verify(lvMod({ declaration: null }));
    expect(run.data.layers.expansion.level).toBe('module');
    expect(reasonCodes(run.data)).toEqual(['declaration_missing']);
    expect(run.data.layers.affected.ids).toEqual(BACKEND);
    expect(run.data.layers.changed.ids).toEqual(['UT-S05-03']);
    expect(run.data.layers.main_path.ids).toEqual(['UT-S03-01']);
    expect(run.data.layers.total.ids).toEqual(['UT-S03-01', ...BACKEND].sort());
    expect(run.data.gate.result).toBe('PASS');
  });

  it('UT-S13-237: 与模块范围并存时的命令组', () => {
    // ① 未扩大：P 只含 backend-S05 的用例与 core-S03 的主链路用例
    const a = verify(lvMod());
    const p = ['UT-S03-01', 'UT-S05-01', 'UT-S05-02', 'UT-S05-03'];
    expect(a.data.layers.expansion.level).toBe('none');
    expect(a.data.layers.total.ids).toEqual(p);
    expect(runners(a)).toEqual(['core', 'backend']);
    for (const call of a.calls) expect(call.eligible, call.runner).toEqual(p);
    expect(a.calls.map(c => c.modules)).toEqual(['core', 'backend']);
    expect(a.calls.find(c => c.runner === 'core').executed).toEqual(['UT-S03-01']);
    expect(a.calls.find(c => c.runner === 'backend').executed).toEqual(['UT-S05-01', 'UT-S05-02', 'UT-S05-03']);
    expect(a.data.scope).toMatchObject({ mode: 'module', modules: ['backend'], fallback_reason: null });
    expect(a.data.summary.defined_count).toBe(4);
    expect(a.data.gate.result).toBe('PASS');
    // ② 按模块扩大：范围 M 的 backend 命令组 + 主链路所属的 core 命令组
    const b = verify(lvMod({ declaration: null }));
    expect(b.data.layers.expansion.level).toBe('module');
    expect(runners(b)).toEqual(['core', 'backend']);
    expect(b.calls.map(c => c.modules)).toEqual(['core', 'backend']);
    expect(runners(b)).not.toContain('web');
    expect(b.data.scope).toMatchObject({ mode: 'module', modules: ['backend'] });
    expect(b.data.gate.result).toBe('PASS');
  });

  it('UT-S13-270: 共享标志独立于评估状态被采信', () => {
    const arms: Array<[string, string]> = [
      ['unknown', declarationYaml({ assessment: 'unknown', shared: 'true', scenarios: [] })],
      ['pending', declarationYaml({ assessment: 'pending', shared: 'true', scenarios: [] })],
      ['S99', declarationYaml({ shared: 'true', scenarios: ['S99'] })],
    ];
    for (const [name, declaration] of arms) {
      const run = verify(lvMod({ declaration }));
      expect(run.data.layers.expansion.level, name).toBe('full');
      expect(reasonCodes(run.data), name).toContain('shared_change_declared');
      expect(runners(run), name).toEqual(['core', 'backend', 'web']);
      expect(run.data.layers.total.ids, name).toEqual(ALL);
      expect(run.data.summary.defined_count, name).toBe(ALL.length);
      expect(run.data.gate.result, name).toBe('PASS');
    }
  });

  it('UT-S13-271: 按模块扩大时保留已识别场景与 delta 触及场景', () => {
    const base = verify(lvMod({ declaration: declarationYaml({ scenarios: ['S07'] }) }));
    expect(base.data.layers.expansion.level).toBe('none');
    expect(base.data.layers.total.ids).toEqual(['UT-S03-01', 'UT-S05-01', 'UT-S05-02', 'UT-S05-03', 'UT-S07-01', 'UT-S07-02']);
    expect(runners(base)).toEqual(['core', 'backend', 'web']);
    const arms: Array<[string, string, string]> = [
      ['S07+S99', declarationYaml({ scenarios: ['S07', 'S99'] }), 'scenario_unknown'],
      ['unknown+S07', declarationYaml({ assessment: 'unknown', scenarios: ['S07'] }), 'assessment_unknown'],
    ];
    for (const [name, declaration, code] of arms) {
      const run = verify(lvMod({ declaration }));
      expect(run.data.layers.expansion.level, name).toBe('module');
      expect(reasonCodes(run.data), name).toEqual([code]);
      const total: string[] = run.data.layers.total.ids;
      for (const id of base.data.layers.total.ids) expect(total, `${name} ${id}`).toContain(id);
      for (const id of [...BACKEND, 'UT-S07-01', 'UT-S07-02', 'UT-S03-01']) expect(total, `${name} ${id}`).toContain(id);
      expect(total, name).not.toContain('UT-S01-01');
      expect(runners(run), name).toContain('web');
      expect(runners(run), name).toEqual(['core', 'backend', 'web']);
      expect(run.data.layers.affected.scenarios, name).toEqual([{ id: 'S05', sources: ['delta'] }, { id: 'S07', sources: ['declared'] }]);
      expect(run.data.gate.result, name).toBe('PASS');
    }
  });

  it('UT-S13-272: 环境预检针对本次实际执行的命令组', () => {
    const f = lvMod({
      declaration: null,
      verify: { modules: { core: { requirements: { env: ['LV_CORE_TOKEN'] } }, web: { requirements: { env: ['LV_WEB_TOKEN'] } } } },
    });
    const blocked = verify(f);
    expect(blocked.data.gate).toEqual({ result: 'FAIL', reason: 'verify_env_not_ready' });
    const missing = blocked.data.requirements.missing_environment;
    expect(missing.map((m: any) => m.name)).toEqual(['LV_CORE_TOKEN']);
    // 环境变量类缺失项在既有输出中不带 modules 字段（只有 checks 带）；归属由配置确定——LV_CORE_TOKEN 只声明在 verify.modules.core 下
    expect(missing[0].kind).toBe('env');
    expect(blocked.data.requirements.declared.env).toEqual(['LV_CORE_TOKEN']);
    expect(JSON.stringify(blocked.data.requirements)).not.toContain('LV_WEB_TOKEN');
    expect(blocked.calls).toHaveLength(0);
    const ready = verify(f, { LV_CORE_TOKEN: 'set' });
    expect(ready.data.gate.reason).not.toBe('verify_env_not_ready');
    expect(runners(ready)).toEqual(['core', 'backend']);
    expect(ready.data.gate.result).toBe('PASS');
  });
});
