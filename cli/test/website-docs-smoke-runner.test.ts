/**
 * website-docs-0-16-0：官网文档 smoke runner（scripts/smoke-website-docs-0-16-0.js）的判据回归（code 评审 r1 F1）。
 * 正式模式缺部署记录时，必须为全部用例（SMOKE-core-235～238 与本案窗口内由其记账的复用用例 07/08/21/23）
 * 写显式 skip 并非零退出，不得写 pass。部署记录检查先于任何网络请求，因此本文件不访问公网。
 * 本文件不认领 UT/ST 编号（上述 SMOKE 结果由 runner 自身写入 smoke 账本）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RUNNER = resolve(__dirname, '../../scripts/smoke-website-docs-0-16-0.js');
const RECORDED = [
  'SMOKE-core-235', 'SMOKE-core-236', 'SMOKE-core-237', 'SMOKE-core-238',
  'SMOKE-core-07', 'SMOKE-core-08', 'SMOKE-core-21', 'SMOKE-core-23',
];

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

/** 一次性项目根：活跃提案为本案（处于验收窗口），可选写入部署记录。 */
function fixtureRoot(deploymentReport?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-website-docs-smoke-'));
  roots.push(root);
  mkdirSync(join(root, 'logos', 'resources', 'verify'), { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'website-docs-0-16-0', module: 'core' }));
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ smoke: { result_path: 'logos/resources/verify/smoke-results.jsonl' } }));
  if (deploymentReport !== undefined) writeFileSync(join(root, 'logos', 'resources', 'verify', 'deployment-report.md'), deploymentReport);
  return root;
}

function runFormal(root: string) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key.startsWith('OPENLOGOS_WEBSITE_DOCS_')) delete env[key];
  }
  const res = spawnSync(process.execPath, [RUNNER], { cwd: root, encoding: 'utf8', env, timeout: 60_000 });
  const ledger = join(root, 'logos', 'resources', 'verify', 'smoke-results.jsonl');
  const records = existsSync(ledger)
    ? readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
  return { res, records };
}

describe('官网文档 smoke — 正式模式缺部署记录不得全绿（code 评审 r1 F1）', () => {
  it('部署记录文件不存在 → 全部用例显式 skip、带缺失项、非零退出、无 pass', () => {
    const { res, records } = runFormal(fixtureRoot());
    expect(res.status).not.toBe(0);
    expect(records.map(r => r.id).sort()).toEqual([...RECORDED].sort());
    for (const r of records) {
      expect(r.status).toBe('skip');
      expect(r.environment).toBe('production-site');
      expect(r.missing_requirements).toContain('logos/resources/verify/deployment-report.md');
      expect(r.not_applicable_reason).toMatch(/部署记录缺失/);
    }
  });

  it('部署记录存在但缺本案的 deploy URL / ID 行 → 同样 skip 并点名缺失键', () => {
    const { res, records } = runFormal(fixtureRoot('# Deployment Report\n\npublic_release_version: 0.16.0\n'));
    expect(res.status).not.toBe(0);
    expect(records).toHaveLength(RECORDED.length);
    for (const r of records) {
      expect(r.status).toBe('skip');
      expect(r.missing_requirements).toEqual(['deployment-report:website_docs_deploy_url', 'deployment-report:website_docs_deploy_id']);
    }
    expect(records.some(r => r.status === 'pass')).toBe(false);
  });
});

describe('官网文档 smoke — 部署记录解析', () => {
  it('列表项与反引号写法均可解析，值只作证据', async () => {
    const mod = await import(pathToFileURL(RUNNER).href);
    const parsed = mod.parseDeployRecord([
      '## 官网文档补齐部署',
      '- `website_docs_deploy_url`: `https://abc123.openlogos.pages.dev`',
      'website_docs_deploy_id: 3f2c9e10-aaaa-bbbb-cccc-1234567890ab',
    ].join('\n'));
    expect(parsed.missing).toEqual([]);
    expect(parsed.values).toEqual({
      website_docs_deploy_url: 'https://abc123.openlogos.pages.dev',
      website_docs_deploy_id: '3f2c9e10-aaaa-bbbb-cccc-1234567890ab',
    });
    expect(mod.parseDeployRecord(null).missing).toEqual(['logos/resources/verify/deployment-report.md']);
  });

  it('判据对照夹具 A 通过、B / C 失败', async () => {
    const mod = await import(pathToFileURL(RUNNER).href);
    const results = mod.runResidueFixtures();
    expect(results.map((r: { name: string; passed: boolean }) => [r.name, r.passed])).toEqual([['A', true], ['B', false], ['C', false]]);
  });
});
