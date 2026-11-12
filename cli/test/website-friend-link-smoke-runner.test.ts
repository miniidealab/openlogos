/**
 * add-markdown6-friend-link：官网友情链接 smoke runner（scripts/smoke-website-friend-link.js）的判据回归。
 * 覆盖：SMOKE-core-308 单页判据的正反夹具；正式模式缺本次部署记录 / 读到其他提案的记录时 skip 且不写 pass；
 * 窗口外 skip 留痕与写前去重；自测模式的账本与地址校验。部署记录与窗口检查先于任何网络请求，本文件不访问公网。
 * 本文件不认领 UT/ST 编号（SMOKE-core-308 的结果由 runner 自身写入 smoke 账本）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RUNNER = resolve(__dirname, '../../scripts/smoke-website-friend-link.js');
const loadRunner = () => import(pathToFileURL(RUNNER).href);

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function fixtureRoot(opts: { activeChange?: string | null; deploymentReport?: string; ledger?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-friend-link-smoke-'));
  roots.push(root);
  mkdirSync(join(root, 'logos', 'resources', 'verify'), { recursive: true });
  const active = opts.activeChange === undefined ? 'add-markdown6-friend-link' : opts.activeChange;
  if (active) writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: active, module: 'core' }));
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ smoke: { result_path: 'logos/resources/verify/smoke-results.jsonl' } }));
  if (opts.deploymentReport !== undefined) writeFileSync(join(root, 'logos', 'resources', 'verify', 'deployment-report.md'), opts.deploymentReport);
  if (opts.ledger !== undefined) writeFileSync(join(root, 'logos', 'resources', 'verify', 'smoke-results.jsonl'), opts.ledger);
  return root;
}

function run(root: string, extraEnv: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key.startsWith('OPENLOGOS_FRIEND_LINK_')) delete env[key];
  }
  Object.assign(env, extraEnv);
  const res = spawnSync(process.execPath, [RUNNER], { cwd: root, encoding: 'utf8', env, timeout: 60_000 });
  const ledgerPath = extraEnv.OPENLOGOS_SMOKE_RESULT_PATH ?? join(root, 'logos', 'resources', 'verify', 'smoke-results.jsonl');
  const records = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
  return { res, records };
}

const LINK_ZH = '<a class="footer-friend-link" href="https://markdown6.com/" target="_blank" rel="noopener noreferrer" aria-label="Markdown6（新标签页打开）">Markdown6 <span aria-hidden="true">↗</span></a>';
const page = (footerInner: string, footers = 1) =>
  `<html><body><main>x</main>${Array.from({ length: footers }, () => `<footer class="site-footer" data-astro-cid-x>${footerInner}</footer>`).join('')}</body></html>`;
const zhFooter = (link = LINK_ZH) => `<div class="footer-container"><a href="/zh/about">关于</a></div><div class="footer-friends"><span>友情链接</span><span aria-hidden="true">·</span>${link}</div>`;

describe('友情链接 smoke — SMOKE-core-308 页面判据', () => {
  it('合规的中英文 footer 通过', async () => {
    const mod = await loadRunner();
    expect(mod.checkFriendLink('/zh/', 'zh', page(zhFooter()))).toEqual([]);
    const en = zhFooter(LINK_ZH.replace('Markdown6（新标签页打开）', 'Markdown6 (opens in a new tab)')).replace('友情链接', 'Friends');
    expect(mod.checkFriendLink('/', 'en', page(en))).toEqual([]);
  });

  it('缺链接、链接重复、target / rel / aria-label 不合规、缺语言标签、footer 不唯一均判失败', async () => {
    const mod = await loadRunner();
    const fails = (html: string, lang: 'en' | 'zh' = 'zh') => mod.checkFriendLink('/zh/', lang, html).join(' ');
    expect(fails(page(zhFooter('')))).toMatch(/链接数量为 0/);
    expect(fails(page(zhFooter(LINK_ZH + LINK_ZH)))).toMatch(/链接数量为 2/);
    expect(fails(page(zhFooter(LINK_ZH.replace(' target="_blank"', ''))))).toMatch(/target/);
    expect(fails(page(zhFooter(LINK_ZH.replace('noopener noreferrer', 'noopener'))))).toMatch(/rel 缺 noreferrer/);
    expect(fails(page(zhFooter(LINK_ZH.replace(/ aria-label="[^"]*"/, ''))))).toMatch(/aria-label/);
    expect(fails(page(zhFooter()), 'en')).toMatch(/Friends/);
    expect(fails(page(zhFooter(), 2))).toMatch(/site-footer 数量为 2/);
    expect(fails('<html><body><footer class="other">x</footer></body></html>')).toMatch(/site-footer 数量为 0/);
  });

  it('只认 footer.site-footer 内的链接，正文里的同名链接不算', async () => {
    const mod = await loadRunner();
    const html = `<html><body><main>${LINK_ZH}</main><footer class="site-footer"><span>友情链接</span></footer></body></html>`;
    expect(mod.checkFriendLink('/zh/', 'zh', html).join(' ')).toMatch(/链接数量为 0/);
  });
});

describe('友情链接 smoke — 部署记录、窗口与自测', () => {
  it('正式模式缺部署记录 → skip、target_environment=prod、非零退出、无 pass', () => {
    const { res, records } = run(fixtureRoot());
    expect(res.status).not.toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 'SMOKE-core-308', status: 'skip', environment: 'production-site', target_environment: 'prod' });
    expect(records[0].missing_requirements).toContain('logos/resources/verify/deployment-report.md');
  });

  it('部署报告只有其他提案的官网部署记录 → 视为缺本次记录，skip', () => {
    const report = [
      '# 部署报告：docs-prompt-cheatsheet',
      '- website_docs_deploy_change: docs-prompt-cheatsheet',
      '- website_docs_deploy_url: https://73db153c.openlogos.pages.dev',
      '- website_docs_deploy_id: 73db153c',
    ].join('\n');
    const { res, records } = run(fixtureRoot({ deploymentReport: report }));
    expect(res.status).not.toBe(0);
    expect(records[0].status).toBe('skip');
    expect(records[0].missing_requirements.join(' ')).toMatch(/website_docs_deploy_change=add-markdown6-friend-link/);
  });

  it('窗口外写 skip 留痕，且替换旧记录为一条', () => {
    const seeded = `${JSON.stringify({ id: 'SMOKE-core-308', status: 'pass', timestamp: 'old' })}\n${JSON.stringify({ id: 'SMOKE-core-21', status: 'pass' })}\n`;
    const { res, records } = run(fixtureRoot({ activeChange: 'other-change', ledger: seeded }));
    expect(res.status).toBe(0);
    const own = records.filter(r => r.id === 'SMOKE-core-308');
    expect(own).toHaveLength(1);
    expect(own[0].status).toBe('skip');
    expect(records.filter(r => r.id === 'SMOKE-core-21')).toHaveLength(1);
  });

  it('自测结果指向正式账本 → 拒绝运行（exit 2）且不写结果', () => {
    const root = fixtureRoot();
    const formal = join(root, 'logos', 'resources', 'verify', 'smoke-results.jsonl');
    const { res } = run(root, { OPENLOGOS_FRIEND_LINK_BASE: 'http://127.0.0.1:4321', OPENLOGOS_SMOKE_RESULT_PATH: formal });
    expect(res.status).toBe(2);
    expect(existsSync(formal)).toBe(false);
  });

  it('自测地址不是 localhost / 127.0.0.1 → fail，写入独立账本', () => {
    const root = fixtureRoot();
    const ledger = join(root, 'self-test.jsonl');
    const { res, records } = run(root, { OPENLOGOS_FRIEND_LINK_BASE: 'https://openlogos.ai', OPENLOGOS_SMOKE_RESULT_PATH: ledger });
    expect(res.status).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 'fail', environment: 'self-test-preview' });
  });
});
