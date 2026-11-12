/**
 * docs-prompt-cheatsheet：官网提示词速查页 smoke runner（scripts/smoke-website-prompt-cheatsheet.js）的判据回归。
 * 覆盖：正式模式缺本次部署记录 / 读到旧部署记录时全部 skip 且不写 pass；窗口外只为 306 / 307 留痕、不碰复用 ID；
 * 写前去重；自测模式的账本与地址校验；306 / 307 页面判据对正反夹具的判定。
 * 部署记录与窗口检查先于任何网络请求，因此本文件不访问公网。
 * 本文件不认领 UT/ST 编号（SMOKE-core-306 / 307 的结果由 runner 自身写入 smoke 账本）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RUNNER = resolve(__dirname, '../../scripts/smoke-website-prompt-cheatsheet.js');
const RECORDED = ['SMOKE-core-306', 'SMOKE-core-307', 'SMOKE-core-21', 'SMOKE-core-23'];
const loadRunner = () => import(pathToFileURL(RUNNER).href);

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function fixtureRoot(opts: { activeChange?: string | null; deploymentReport?: string; ledger?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-pcs-smoke-'));
  roots.push(root);
  mkdirSync(join(root, 'logos', 'resources', 'verify'), { recursive: true });
  const active = opts.activeChange === undefined ? 'docs-prompt-cheatsheet' : opts.activeChange;
  if (active) writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: active, module: 'core' }));
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ smoke: { result_path: 'logos/resources/verify/smoke-results.jsonl' } }));
  if (opts.deploymentReport !== undefined) writeFileSync(join(root, 'logos', 'resources', 'verify', 'deployment-report.md'), opts.deploymentReport);
  if (opts.ledger !== undefined) writeFileSync(join(root, 'logos', 'resources', 'verify', 'smoke-results.jsonl'), opts.ledger);
  return root;
}

function run(root: string, extraEnv: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key.startsWith('OPENLOGOS_PCS_')) delete env[key];
  }
  Object.assign(env, extraEnv);
  const res = spawnSync(process.execPath, [RUNNER], { cwd: root, encoding: 'utf8', env, timeout: 60_000 });
  const ledgerPath = extraEnv.OPENLOGOS_SMOKE_RESULT_PATH ?? join(root, 'logos', 'resources', 'verify', 'smoke-results.jsonl');
  const records = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
  return { res, records };
}

describe('速查页 smoke — 正式模式部署记录门（delta 评审 r1 F3）', () => {
  it('部署记录文件不存在 → 四条用例显式 skip、target_environment=prod、非零退出、无 pass', () => {
    const { res, records } = run(fixtureRoot());
    expect(res.status).not.toBe(0);
    expect(records.map(r => r.id).sort()).toEqual([...RECORDED].sort());
    for (const r of records) {
      expect(r.status).toBe('skip');
      expect(r.environment).toBe('production-site');
      expect(r.target_environment).toBe('prod');
      expect(r.missing_requirements).toContain('logos/resources/verify/deployment-report.md');
      expect(r.not_applicable_reason).not.toMatch(/platform-unavailable/);
    }
  });

  it('部署记录属于旧提案（change 行不是本 slug）→ 视为缺本次记录，全部 skip', () => {
    const report = [
      'website_docs_deploy_change: website-docs-0-16-0',
      'website_docs_deploy_url: https://old.openlogos.pages.dev',
      'website_docs_deploy_id: old-id',
    ].join('\n');
    const { res, records } = run(fixtureRoot({ deploymentReport: report }));
    expect(res.status).not.toBe(0);
    expect(records).toHaveLength(RECORDED.length);
    for (const r of records) {
      expect(r.status).toBe('skip');
      expect(r.missing_requirements.join(' ')).toMatch(/website_docs_deploy_change=docs-prompt-cheatsheet/);
    }
  });
});

describe('速查页 smoke — 窗口与记账', () => {
  it('窗口外只为 306 / 307 写 skip，不写也不删复用 ID 21 / 23，且 306 旧记录被替换为一条', () => {
    const seeded = [
      JSON.stringify({ id: 'SMOKE-core-306', status: 'pass', timestamp: 'old' }),
      JSON.stringify({ id: 'SMOKE-core-21', status: 'pass', timestamp: 'kept' }),
    ].join('\n') + '\n';
    const { res, records } = run(fixtureRoot({ activeChange: 'other-change', ledger: seeded }));
    expect(res.status).toBe(0);
    expect(records.filter(r => r.id === 'SMOKE-core-306')).toHaveLength(1);
    expect(records.find(r => r.id === 'SMOKE-core-306')!.status).toBe('skip');
    expect(records.filter(r => r.id === 'SMOKE-core-307')).toHaveLength(1);
    expect(records.filter(r => r.id === 'SMOKE-core-21')).toEqual([{ id: 'SMOKE-core-21', status: 'pass', timestamp: 'kept' }]);
    expect(records.some(r => r.id === 'SMOKE-core-23')).toBe(false);
  });

  it('OPENLOGOS_PCS_SMOKE=1 打开窗口：即使活跃变更不同，也按正式模式检查部署记录', () => {
    const { records } = run(fixtureRoot({ activeChange: 'other-change' }), { OPENLOGOS_PCS_SMOKE: '1' });
    expect(records.map(r => r.id).sort()).toEqual([...RECORDED].sort());
    expect(records.every(r => r.status === 'skip')).toBe(true);
  });

  it('自测结果指向项目正式账本 → 拒绝运行（exit 2）且不写任何结果', () => {
    const root = fixtureRoot();
    const formal = join(root, 'logos', 'resources', 'verify', 'smoke-results.jsonl');
    const { res } = run(root, { OPENLOGOS_PCS_BASE: 'http://127.0.0.1:4321', OPENLOGOS_SMOKE_RESULT_PATH: formal });
    expect(res.status).toBe(2);
    expect(existsSync(formal)).toBe(false);
  });

  it('自测地址不是 localhost / 127.0.0.1 → 四条用例 fail，写入独立账本', () => {
    const root = fixtureRoot();
    const ledger = join(root, 'self-test.jsonl');
    const { res, records } = run(root, { OPENLOGOS_PCS_BASE: 'https://openlogos.ai', OPENLOGOS_SMOKE_RESULT_PATH: ledger });
    expect(res.status).toBe(1);
    expect(records.map(r => r.id).sort()).toEqual([...RECORDED].sort());
    expect(records.every(r => r.status === 'fail' && r.environment === 'self-test-preview')).toBe(true);
  });
});

/** 构造 Starlight 结构的页面 HTML（侧栏 + 正文 + Tabs）。 */
function page(lang: 'en' | 'zh', o: { sidebar?: string[]; body?: string; tabs?: Array<{ label: string; panel: string }>[] } = {}) {
  const p = lang === 'zh' ? '/zh' : '';
  const sidebar = o.sidebar ?? [`${p}/getting-started/`, `${p}/getting-started/first-collaboration/`, `${p}/getting-started/prompt-cheatsheet/`];
  const t = lang === 'zh'
    ? { a: '场景 A：从新需求建一个系统', b: '场景 B：读懂已有项目', conf: '人类确认点', term: '要你在终端执行' }
    : { a: 'Scenario A: Build a system', b: 'Scenario B: Existing project', conf: 'Human confirmation points', term: 'run by you in a terminal' };
  const defaultTabs = [[
    { label: 'Claude Code', panel: 'AI can run commands' },
    { label: 'Codex / OpenCode', panel: 'no interception' },
    { label: 'Cursor', panel: 'partial' },
    { label: 'ZCode / Qoder / WorkBuddy', panel: `openlogos change, openlogos merge, openlogos verify ${t.term}` },
  ]];
  const tabsHtml = (o.tabs ?? defaultTabs).map((group, g) => '<starlight-tabs><div class="tablist-wrapper"><ul role="tablist">'
    + group.map((tab, i) => `<li role="presentation"><a role="tab" href="#tab-panel-${g}${i}" id="tab-${g}${i}">  ${tab.label} </a></li>`).join('')
    + '</ul></div>'
    + group.map((tab, i) => `<div id="tab-panel-${g}${i}" aria-labelledby="tab-${g}${i}" role="tabpanel"><ul><li>${tab.panel}</li></ul></div>`).join('')
    + '<script>const x=\'role="tab"\';</script></starlight-tabs>').join('');
  const body = o.body ?? `<h2 id="c">${t.conf}</h2><table><tr><td>openlogos merge</td><td>openlogos verify</td><td>openlogos archive</td><td>git push</td></tr></table>`
    + `<h2 id="n">x</h2><p>openlogos next openlogos change</p><h2 id="a">${t.a}</h2><p>…</p><h2 id="b">${t.b}</h2><p>…</p>`
    + `<h2 id="h">hosts</h2>${tabsHtml}`;
  return `<html><body><nav class="sidebar" aria-label="Main"><ul>${sidebar.map(h => `<li><a href="${h}">x</a></li>`).join('')}</ul></nav>`
    + `<main><div class="sl-markdown-content">${body}</div></main></body></html>`;
}

describe('速查页 smoke — SMOKE-core-306 / 307 页面判据', () => {
  it('完整页面（中英文）通过 306 与 307', async () => {
    const mod = await loadRunner();
    for (const lang of ['en', 'zh'] as const) {
      expect(mod.checkCheatsheetPage(lang, page(lang))).toEqual([]);
      expect(mod.checkHostTabs(lang, page(lang)).problems).toEqual([]);
    }
  });

  it('306：侧栏中本页没有紧跟首次 AI 协作、缺场景 B、确认点缺 git push 均判失败', async () => {
    const mod = await loadRunner();
    const misordered = page('zh', { sidebar: ['/zh/getting-started/first-collaboration/', '/zh/getting-started/quick-start/', '/zh/getting-started/prompt-cheatsheet/'] });
    expect(mod.checkCheatsheetPage('zh', misordered).join(' ')).toMatch(/未紧跟/);
    const noB = page('en', { body: '<h2>Human confirmation points</h2><p>merge verify archive git push</p><h2>Scenario A</h2><p>openlogos next openlogos change openlogos merge openlogos verify openlogos archive</p>' });
    expect(mod.checkCheatsheetPage('en', noB).join(' ')).toMatch(/Scenario B/);
    const noPush = page('zh', { body: '<h2>人类确认点</h2><p>merge verify archive</p><h2>场景 A</h2><h2>场景 B</h2><p>openlogos next openlogos change openlogos merge openlogos verify openlogos archive git push</p>' });
    expect(mod.checkCheatsheetPage('zh', noPush).join(' ')).toMatch(/人类确认点小节缺「git push」/);
  });

  it('307：缺宿主标签、ZCode / Qoder / WorkBuddy 面板缺终端说明、宿主区块不唯一均判失败', async () => {
    const mod = await loadRunner();
    const missingCodex = page('en', { tabs: [[
      { label: 'Claude Code', panel: '' }, { label: 'OpenCode', panel: '' }, { label: 'Cursor', panel: '' },
      { label: 'ZCode / Qoder / WorkBuddy', panel: 'openlogos change openlogos merge openlogos verify terminal' },
    ]] });
    expect(mod.checkHostTabs('en', missingCodex).problems.join(' ')).toMatch(/Codex/);
    const noTerminal = page('zh', { tabs: [[
      { label: 'Claude Code', panel: '' }, { label: 'Codex / OpenCode', panel: '' }, { label: 'Cursor', panel: '' },
      { label: 'ZCode / Qoder / WorkBuddy', panel: 'openlogos change openlogos merge openlogos verify' },
    ]] });
    expect(mod.checkHostTabs('zh', noTerminal).problems.join(' ')).toMatch(/终端执行说明/);
    const twoBlocks = page('en', { tabs: [
      [{ label: 'Claude Code', panel: '' }],
      [{ label: 'ZCode / Qoder / WorkBuddy', panel: 'openlogos change openlogos merge openlogos verify terminal' }],
    ] });
    expect(mod.checkHostTabs('en', twoBlocks).problems.join(' ')).toMatch(/应恰好 1 个/);
  });

  it('宿主集合固定为 0.16.7 的七个取值，不读取本机 CLI', async () => {
    const mod = await loadRunner();
    expect(mod.BASELINE_HOSTS).toEqual(['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy']);
    expect(mod.parseAiTools('--ai-tool <claude-code|opencode|other|all>')).toEqual(['claude-code', 'opencode', 'other', 'all']);
  });

  it('部署记录解析：三行齐全且 change 为本 slug 才无缺失', async () => {
    const mod = await loadRunner();
    const ok = mod.parseDeployRecord([
      '- `website_docs_deploy_change`: `docs-prompt-cheatsheet`',
      'website_docs_deploy_url: https://abc.openlogos.pages.dev',
      'website_docs_deploy_id: 1234',
    ].join('\n'));
    expect(ok.missing).toEqual([]);
    expect(mod.parseDeployRecord('website_docs_deploy_url: x\nwebsite_docs_deploy_id: y').missing).toEqual(['deployment-report:website_docs_deploy_change']);
  });

  it('部署报告含更早提案的同名键时，只读本 slug 所在那份报告的 url / id', async () => {
    const mod = await loadRunner();
    const parsed = mod.parseDeployRecord([
      '# 部署报告：website-docs-0-16-0',
      '- website_docs_deploy_url: https://old.openlogos.pages.dev',
      '- website_docs_deploy_id: old-id',
      '',
      '# 部署报告：docs-prompt-cheatsheet',
      '- website_docs_deploy_change: docs-prompt-cheatsheet',
      '- website_docs_deploy_url: https://new.openlogos.pages.dev',
      '- website_docs_deploy_id: new-id',
      '',
      '# 部署报告：later-change',
      '- website_docs_deploy_id: later-id',
    ].join('\n'));
    expect(parsed.missing).toEqual([]);
    expect(parsed.values).toEqual({
      website_docs_deploy_change: 'docs-prompt-cheatsheet',
      website_docs_deploy_url: 'https://new.openlogos.pages.dev',
      website_docs_deploy_id: 'new-id',
    });
    const noOwnUrl = mod.parseDeployRecord('# a\n- website_docs_deploy_url: https://old\n# b\n- website_docs_deploy_change: docs-prompt-cheatsheet\n- website_docs_deploy_id: x');
    expect(noOwnUrl.missing).toEqual(['deployment-report:website_docs_deploy_url']);
  });
});

/** 起一个本地 HTTP 服务：routes[path] = [status, location?]，记录收到的请求路径。 */
async function server(routes: Record<string, [number, string?]>): Promise<{ origin: string; hits: string[]; srv: Server }> {
  const hits: string[] = [];
  const srv = createServer((req, res) => {
    hits.push(req.url ?? '');
    const [status, location] = routes[req.url ?? ''] ?? [404];
    if (location) res.setHeader('location', location);
    res.setHeader('content-type', 'text/html');
    res.statusCode = status;
    res.end(status === 200 ? '<html>ok</html>' : '');
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  servers.push(srv);
  return { origin: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, hits, srv };
}
const servers: Server[] = [];
afterEach(async () => { while (servers.length) await new Promise(r => servers.pop()!.close(() => r(null))); });

describe('速查页 smoke — 重定向逐跳检查（code 评审 r1 F2）', () => {
  it('A/start → 跨 origin 的 B/hop → A/final：不请求 B，留存被拦截的重定向，A/start 以 3xx 返回', async () => {
    const mod = await loadRunner();
    const b = await server({});
    const a = await server({ '/start': [302, `${b.origin}/hop`], '/final': [200] });
    b.srv.removeAllListeners('request');
    b.srv.on('request', (req, res) => { b.hits.push(req.url ?? ''); res.statusCode = 302; res.setHeader('location', `${a.origin}/final`); res.end(); });
    const client = mod.createSiteClient(a.origin);
    const page = await client.get('/start');
    expect(b.hits).toEqual([]);
    expect(a.hits).toEqual(['/start']);
    expect(client.requested).toEqual([`${a.origin}/start`]);
    expect(client.requested.every((u: string) => new URL(u).origin === a.origin)).toBe(true);
    expect(client.blockedRedirects).toEqual([`${a.origin}/start -> ${b.origin}/hop`]);
    expect(page.status).toBe(302);
  });

  it('同 origin 的多跳重定向逐跳跟随并逐跳记录', async () => {
    const mod = await loadRunner();
    const a = await server({ '/one': [301, '/two'], '/two': [302, '/final'], '/final': [200] });
    const client = mod.createSiteClient(a.origin);
    const log = new Set<string>();
    client.setCaseLog(log);
    const page = await client.get('/one');
    expect(page.status).toBe(200);
    expect(page.finalUrl).toBe(`${a.origin}/final`);
    expect(client.requested).toEqual([`${a.origin}/one`, `${a.origin}/two`, `${a.origin}/final`]);
    expect([...log]).toEqual([`HTTP 301 ${a.origin}/one`, `HTTP 302 ${a.origin}/two`, `HTTP 200 ${a.origin}/final`]);
  });

  it('生产域名的 Location 按 URL 重定位改写到 <base>，不请求生产站点', async () => {
    const mod = await loadRunner();
    const a = await server({ '/start': [302, 'https://openlogos.ai/final'], '/final': [200] });
    const client = mod.createSiteClient(a.origin);
    const page = await client.get('/start');
    expect(page.status).toBe(200);
    expect(client.requested).toEqual([`${a.origin}/start`, `${a.origin}/final`]);
  });

  it('重定向超过上限判失败', async () => {
    const mod = await loadRunner();
    const a = await server({ '/loop': [302, '/loop'] });
    const client = mod.createSiteClient(a.origin, { maxRedirects: 3 });
    await expect(client.get('/loop')).rejects.toThrow(/重定向超过 3 跳/);
    expect(client.requested).toHaveLength(4);
  });
});

describe('速查页内容 — launch 前置条件（code 评审 r1 F1）', () => {
  const pages = {
    zh: resolve(__dirname, '../../website/src/content/docs/zh/getting-started/prompt-cheatsheet.mdx'),
    en: resolve(__dirname, '../../website/src/content/docs/getting-started/prompt-cheatsheet.mdx'),
  };
  const heading = { zh: '### 首轮建设完成后', en: '### After the first build' };
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}：首轮建设完成后先写明部署与 smoke（或声明无需部署），再 launch`, () => {
      const src = readFileSync(pages[lang], 'utf8');
      const start = src.indexOf(heading[lang]);
      expect(start).toBeGreaterThan(-1);
      const end = src.indexOf('\n## ', start);
      const section = src.slice(start, end === -1 ? undefined : end);
      for (const marker of ['deployment-executor', 'openlogos smoke', 'deployment_required: false', 'skip_phases', 'openlogos launch']) {
        expect(section).toContain(marker);
      }
      expect(section.indexOf('openlogos smoke')).toBeLessThan(section.lastIndexOf('openlogos launch'));
    });
  }
});
