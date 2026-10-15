/**
 * environment-deploy 切片 2：部署执行未启用的项目零回归（S42）。
 *
 * 覆盖 UT-S42-16（logos/resources/test/core-S42-test-cases.md）。规范源：spec/environments.md §1「部署执行已启用」。
 * 以当前 CLI（cli/dist/index.js）在两种未启用夹具上执行既有命令，与落盘基线（引入部署执行前的 CLI 实测输出，
 * 生成方式见 test/golden/README.md）逐字比较：JSON 输出、退出码、账本字节与提案目录文件。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error 夹具为 ESM .mjs（与基线生成脚本共用），无类型声明
import { observeUnenabledFixtures } from './golden/s42-zero-regression-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const BASELINE = join(HERE, 'golden', 's42-zero-regression-baseline.json');

describe('S42 部署执行未启用的项目零回归 — 单元测试', () => {
  it('UT-S42-16: 部署执行未启用的项目零回归', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'));
    const current = observeUnenabledFixtures(CLI);
    expect(Object.keys(current)).toEqual(['no-registry', 'registry-without-deploy']);
    for (const name of Object.keys(baseline)) {
      expect(current[name], `${name} 与引入前基线逐字一致`).toEqual(baseline[name]);
    }
    // 关键不变量直接断言（基线之外的可读证据）
    const reg = current['registry-without-deploy'];
    const envList = reg.steps.find((s: any) => s.args === 'env list --format json').stdout.data;
    for (const env of envList.environments) {
      expect(Object.keys(env)).not.toEqual(expect.arrayContaining(['previous_ref']));
      expect(env).not.toHaveProperty('deploy_mode');
      expect(env).not.toHaveProperty('deploy_in_progress');
    }
    expect(reg.ledger.trim().split('\n')).toHaveLength(2); // deploy-done 1 行 + 有提案 smoke 1 行；无提案 smoke 不写
    expect(current['no-registry'].ledger).toBeNull();
  }, 300_000);
});
