/**
 * verify-scope-fields-and-slice-module：安装态 smoke runner（scripts/smoke-verify-scope-fields.js）的分派判据，不落真实全局环境。
 * 规格：core-smoke-test-cases.md「OpenLogos 0.16.28 验收范围字段判断与切片模块安装态 smoke」SMOKE-core-359 的失败处置——
 * 「回流部署，不继续后续用例的通过判定」。本文件的用例是 runner 自身的判据测试，不对应、也不写入任何 SMOKE 用例结果。
 */
import { describe, expect, it, vi } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error smoke runner 为 ESM .js 脚本，无类型声明；以模块方式导入时不执行主流程
import { CASES, IDENTITY_CASE, OWNED, dispatchCases } from '../../scripts/smoke-verify-scope-fields.js';

vi.setConfig({ testTimeout: 120_000 });

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'index.js');
const BEHAVIOUR = (OWNED as string[]).filter(id => id !== IDENTITY_CASE);

describe('安装态 smoke runner 判据：身份校验是其余用例的前置条件（不落真实全局环境）', () => {
  it('回执与安装态版本不符：真实身份用例失败，行为用例调用次数为零且没有通过记录', async () => {
    // 版本不匹配的安装回执：candidate_version 与被测入口的 --version 不同，入口路径也不是回执登记的路径
    const receipt = { deploy_id: 'test-deploy', result: 'done', environment: 'test', candidate_version: '0.0.0-mismatch', entry_realpath: '/nonexistent/openlogos/dist/index.js' };
    const calls: string[] = [];
    const cases: Record<string, (entry: string) => Promise<{ detail: string; evidence: string[] }>> = { [IDENTITY_CASE]: CASES[IDENTITY_CASE] };
    for (const id of BEHAVIOUR) cases[id] = async () => { calls.push(id); return { detail: '行为断言通过', evidence: [] }; };

    const rows = await dispatchCases(CLI, receipt, cases) as Map<string, { status: string; detail: string; evidence: string[] }>;

    expect(Array.from(rows.keys()).sort()).toEqual([...(OWNED as string[])].sort());
    const identity = rows.get(IDENTITY_CASE)!;
    expect(identity.status).toBe('fail');
    expect(identity.detail).toContain('0.0.0-mismatch');
    expect(identity.evidence.some(e => e.startsWith('version='))).toBe(true);
    expect(calls).toEqual([]);
    for (const id of BEHAVIOUR) {
      const row = rows.get(id)!;
      expect(row.status, id).toBe('fail');
      expect(row.detail, id).toContain(IDENTITY_CASE);
      expect(row.detail, id).toContain('本用例未执行');
      expect(row.evidence, id).toContain(`blocked_by=${IDENTITY_CASE}`);
    }
    expect(Array.from(rows.values()).filter(r => r.status === 'pass')).toEqual([]);
  });

  it('身份用例通过后才逐个分派行为用例，各自的结论互不影响', async () => {
    const calls: string[] = [];
    const cases: Record<string, () => Promise<{ detail: string; evidence: string[] }>> = {
      [IDENTITY_CASE]: async () => ({ detail: '身份一致', evidence: [] }),
    };
    for (const id of BEHAVIOUR) {
      cases[id] = async () => {
        calls.push(id);
        if (id === BEHAVIOUR[1]) throw Object.assign(new Error('行为断言失败'), { evidence: ['x=1'] });
        return { detail: 'ok', evidence: [] };
      };
    }
    const rows = await dispatchCases('/fake/entry', {}, cases) as Map<string, { status: string; detail: string; evidence: string[] }>;
    expect(calls).toEqual(BEHAVIOUR);
    expect(rows.get(IDENTITY_CASE)!.status).toBe('pass');
    expect(rows.get(BEHAVIOUR[1])!.status).toBe('fail');
    expect(rows.get(BEHAVIOUR[1])!.evidence).toContain('x=1');
    expect(BEHAVIOUR.filter(id => rows.get(id)!.status === 'pass')).toEqual(BEHAVIOUR.filter(id => id !== BEHAVIOUR[1]));
  });
});
