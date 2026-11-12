#!/usr/bin/env node
/**
 * SMOKE-core-306～SMOKE-core-307 — 官网中英文「提示词速查」页发布后取证（docs-prompt-cheatsheet）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「官网提示词速查页发布后 smoke（SMOKE-core-306～307）」；
 * 部署：core-01-deployment-plan.md「官网提示词速查页发布检查（docs-prompt-cheatsheet）」。
 *
 *   - SMOKE-core-306：中英文速查页可达、侧栏与简介页入口齐全，覆盖两条主线、五个核心命令与人类确认点。
 *   - SMOKE-core-307：宿主差异区块覆盖 0.16.7 全部具体宿主（固定集合 H₀），ZCode / Qoder / WorkBuddy 标签页写明终端执行。
 *   - 复用 SMOKE-core-21 / 23：按原口径对 <base> 执行。交接窗口内 website/scripts/smoke-releases.mjs 让出这两个 ID，
 *     正式账本中每个 ID 只有一条来自本 runner 的结果（规格「复用用例的记账交接」）。
 *
 * **执行对象**：正式模式固定 <base>=https://openlogos.ai；设置 OPENLOGOS_PCS_BASE（只接受 localhost / 127.0.0.1）即自测模式，
 * 自测结果必须写独立账本（OPENLOGOS_SMOKE_RESULT_PATH 不得指向项目正式账本），不要求部署记录。
 *
 * **宿主口径**：H₀ 来自 v0.16.7 提交中 cli/src/index.ts 帮助文本的 `--ai-tool <…>` 取值（去掉 other / all），写死为常量。
 * 本机 `openlogos --version` 与 `--ai-tool` 取值只写 evidence，不参与判定。
 *
 * **窗口**：活跃变更为本 slug，或 OPENLOGOS_PCS_SMOKE=1；窗口之外只为 306～307 写 skip 留痕，不写 21 / 23。
 *
 * **执行边界**：公网只读（HTTP GET + 本机 `openlogos --version` / `--help`）。网络不可达、正式模式缺本次部署记录属可补齐的
 * 环境缺口：写显式 skip（missing_requirements 列出缺失项），不标 platform-unavailable。
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SLUG = 'docs-prompt-cheatsheet';
export const PROD_ORIGIN = 'https://openlogos.ai';
export const OWNED = ['SMOKE-core-306', 'SMOKE-core-307'];
export const REUSED = ['SMOKE-core-21', 'SMOKE-core-23'];
export const RECORDED = [...OWNED, ...REUSED];
export const DEPLOY_RECORD_KEYS = ['website_docs_deploy_change', 'website_docs_deploy_url', 'website_docs_deploy_id'];
export const TARGET_ENVIRONMENT = 'prod';

/** H₀：v0.16.7 `cli/src/index.ts` 帮助文本 `--ai-tool <claude-code|opencode|codex|cursor|zcode|qoder|workbuddy|other|all>` 去掉 other / all。 */
export const BASELINE_HOSTS = ['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy'];
export const HOST_DISPLAY = {
  'claude-code': 'Claude Code', opencode: 'OpenCode', codex: 'Codex', cursor: 'Cursor',
  zcode: 'ZCode', qoder: 'Qoder', workbuddy: 'WorkBuddy',
};
export const CORE_COMMANDS = ['openlogos next', 'openlogos change', 'openlogos merge', 'openlogos verify', 'openlogos archive'];
export const TERMINAL_COMMANDS = ['openlogos change', 'openlogos merge', 'openlogos verify'];
export const CONFIRMATION_TERMS = ['merge', 'verify', 'archive', 'git push'];
export const PAGES = {
  en: { path: '/getting-started/prompt-cheatsheet', index: '/getting-started', prev: '/getting-started/first-collaboration' },
  zh: { path: '/zh/getting-started/prompt-cheatsheet', index: '/zh/getting-started', prev: '/zh/getting-started/first-collaboration' },
};
const MARKERS = {
  en: { scenarioA: 'Scenario A', scenarioB: 'Scenario B', confirmation: /human confirmation/i, terminal: /terminal/i },
  zh: { scenarioA: '场景 A', scenarioB: '场景 B', confirmation: /人类确认点/, terminal: /终端/ },
};

// ── 纯函数（导出供单元测试复用） ─────────────────────────────────────────────────

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

export function stripScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

export function htmlToText(html) {
  return decodeEntities(stripScripts(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function normalizePath(pathname) {
  const p = pathname.replace(/\/index\.html$/, '/');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/** Starlight 主侧栏：`<nav class="sidebar …">`。 */
export function sidebarHtml(html) {
  return /<nav\b[^>]*class="[^"]*\bsidebar\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1] ?? '';
}

/** 正文区域：`.sl-markdown-content` 起至 `</main>`，去掉 script / style。 */
export function markdownHtml(html) {
  const start = html.indexOf('sl-markdown-content');
  if (start === -1) return '';
  const end = html.indexOf('</main>', start);
  return stripScripts(html.slice(start, end === -1 ? undefined : end));
}

/** 按出现顺序提取站内链接路径（规范化，忽略末尾 `/`）。 */
export function linkPaths(html) {
  const out = [];
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    let u;
    try { u = new URL(decodeEntities(m[1]), PROD_ORIGIN); } catch { continue; }
    if (u.origin !== PROD_ORIGIN) continue;
    out.push(normalizePath(u.pathname));
  }
  return out;
}

/** 按 h2 / h3 切小节：返回 [{ title, text }]，text 为该标题到下一个 h2 / h3 之间的正文。 */
export function sections(md) {
  const re = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const marks = [...md.matchAll(re)].map(m => ({ index: m.index, end: m.index + m[0].length, title: htmlToText(m[2]) }));
  return marks.map((mark, i) => ({ title: mark.title, text: htmlToText(md.slice(mark.end, marks[i + 1]?.index ?? md.length)) }));
}

/** 提取 Starlight Tabs 组件：[{ tabs: [{ id, label }], panels: Map<tabId, text> }]。 */
export function tabBlocks(md) {
  const blocks = [];
  for (const m of md.matchAll(/<starlight-tabs\b[^>]*>([\s\S]*?)<\/starlight-tabs>/gi)) {
    const inner = m[1];
    const tabs = [...inner.matchAll(/<a\b([^>]*\brole="tab"[^>]*)>([\s\S]*?)<\/a>/gi)].map(t => ({
      id: /\bid="([^"]+)"/.exec(t[1])?.[1] ?? null,
      label: htmlToText(t[2]),
    }));
    const starts = [...inner.matchAll(/<div\b([^>]*\brole="tabpanel"[^>]*)>/gi)].map(p => ({
      index: p.index, end: p.index + p[0].length, labelledBy: /\baria-labelledby="([^"]+)"/.exec(p[1])?.[1] ?? null,
    }));
    const panels = new Map();
    starts.forEach((s, i) => panels.set(s.labelledBy, htmlToText(inner.slice(s.end, starts[i + 1]?.index ?? inner.length))));
    blocks.push({ tabs, panels });
  }
  return blocks;
}

/** 解析 `--ai-tool <a|b|…>` 取值。 */
export function parseAiTools(helpText) {
  const m = /--ai-tool <([^>]+)>/.exec(helpText);
  return m ? m[1].split('|').map(s => s.trim()).filter(Boolean) : [];
}

/**
 * 解析部署记录：三行齐全且 change 行等于本 slug 才算本次部署记录。
 * 返回 { values, missing }；缺文件时 text 为 null。
 */
export function parseDeployRecord(text) {
  if (text === null) return { values: {}, missing: ['logos/resources/verify/deployment-report.md'] };
  // 部署报告是按提案追加的多份报告（以一级标题分隔），旧报告可能含同名键（如 0.16.0 官网部署的 url / id）。
  // 先定位本 slug 的 change 行，再只在它所属的那份报告（到下一个一级标题为止）里读 url / id。
  const lines = text.split(/\r?\n/);
  const valueOf = (line, key) => new RegExp(`^\\s*[-*]?\\s*\`?${key}\`?:\\s*\`?([^\\s\`]+)`).exec(line)?.[1] ?? null;
  const changeKey = DEPLOY_RECORD_KEYS[0];
  const changes = lines.map((line, i) => ({ i, v: valueOf(line, changeKey) })).filter(c => c.v !== null);
  const own = changes.filter(c => c.v === SLUG).pop();
  if (!own) {
    const other = changes.pop();
    return {
      values: {},
      missing: [other
        ? `deployment-report:${changeKey}=${SLUG}（当前为 ${other.v}，属旧部署记录）`
        : `deployment-report:${changeKey}`],
    };
  }
  let start = own.i;
  while (start > 0 && !/^# /.test(lines[start])) start -= 1;
  let end = own.i + 1;
  while (end < lines.length && !/^# /.test(lines[end])) end += 1;
  const values = { [changeKey]: SLUG };
  const missing = [];
  for (const key of DEPLOY_RECORD_KEYS.slice(1)) {
    const v = lines.slice(start, end).map(line => valueOf(line, key)).filter(Boolean).pop();
    if (v) values[key] = v; else missing.push(`deployment-report:${key}`);
  }
  return { values, missing };
}

/** SMOKE-core-306 的单页内容判据（② 侧栏、④ 正文）。返回问题清单，空即通过。 */
export function checkCheatsheetPage(lang, html) {
  const { path, prev } = PAGES[lang];
  const mk = MARKERS[lang];
  const problems = [];
  const side = linkPaths(sidebarHtml(html));
  const at = side.indexOf(path);
  if (at === -1) problems.push(`② ${path} 侧栏缺本页链接`);
  else if (side[at - 1] !== prev) problems.push(`② ${path} 侧栏中本页未紧跟 ${prev}（前一项为 ${side[at - 1] ?? '无'}）`);
  const md = markdownHtml(html);
  if (!md) { problems.push(`④ ${path} 无正文区域`); return problems; }
  const secs = sections(md);
  if (!secs.some(s => s.title.includes(mk.scenarioA))) problems.push(`④ ${path} 缺标题含「${mk.scenarioA}」的小节`);
  if (!secs.some(s => s.title.includes(mk.scenarioB))) problems.push(`④ ${path} 缺标题含「${mk.scenarioB}」的小节`);
  const text = htmlToText(md);
  for (const cmd of CORE_COMMANDS) if (!text.includes(cmd)) problems.push(`④ ${path} 正文缺「${cmd}」`);
  const conf = secs.find(s => mk.confirmation.test(s.title));
  if (!conf) problems.push(`④ ${path} 缺人类确认点小节`);
  else for (const term of CONFIRMATION_TERMS) if (!conf.text.includes(term)) problems.push(`④ ${path} 人类确认点小节缺「${term}」`);
  return problems;
}

/** SMOKE-core-307 的单页判据。返回 { problems, labels }。 */
export function checkHostTabs(lang, html) {
  const { path } = PAGES[lang];
  const names = BASELINE_HOSTS.map(h => HOST_DISPLAY[h]);
  const problems = [];
  const blocks = tabBlocks(markdownHtml(html)).filter(b => b.tabs.some(t => names.some(n => t.label.includes(n))));
  if (blocks.length !== 1) {
    problems.push(`② ${path} 宿主差异区块数为 ${blocks.length}，应恰好 1 个`);
    return { problems, labels: blocks.flatMap(b => b.tabs.map(t => t.label)) };
  }
  const [block] = blocks;
  const labels = block.tabs.map(t => t.label);
  for (const n of names) if (!labels.some(l => l.includes(n))) problems.push(`③ ${path} 标签缺宿主「${n}」`);
  const tab = block.tabs.find(t => ['ZCode', 'Qoder', 'WorkBuddy'].every(n => t.label.includes(n)));
  if (!tab) problems.push(`④ ${path} 缺同时含 ZCode / Qoder / WorkBuddy 的标签页`);
  else {
    const panel = block.panels.get(tab.id) ?? '';
    for (const cmd of TERMINAL_COMMANDS) if (!panel.includes(cmd)) problems.push(`④ ${path} ZCode / Qoder / WorkBuddy 面板缺「${cmd}」`);
    if (!MARKERS[lang].terminal.test(panel)) problems.push(`④ ${path} ZCode / Qoder / WorkBuddy 面板缺终端执行说明`);
  }
  return { problems, labels };
}

/** 删除账本中指定 ID 的旧记录（保证每个 ID 只有一条结果）。 */
export function removeRecords(resultPath, ids) {
  if (!existsSync(resultPath)) return;
  const drop = new Set(ids);
  const kept = readFileSync(resultPath, 'utf8').split('\n').filter((line) => {
    if (!line.trim()) return false;
    try { return !drop.has(JSON.parse(line).id); } catch { return true; }
  });
  writeFileSync(resultPath, kept.length ? `${kept.join('\n')}\n` : '');
}

/** 比较账本路径用：父目录取 realpath（如 macOS 的 /var → /private/var），文件本身可以尚不存在。 */
export function canonicalPath(p) {
  try { return join(realpathSync(dirname(p)), basename(p)); } catch { return p; }
}

export function isLocalBase(raw) {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** 可补齐的环境缺口（网络不可达、缺本次部署记录）：写显式 skip，不标 platform-unavailable。 */
export class EnvGap extends Error {
  constructor(message, missing) { super(message); this.missing = missing; }
}

export const MAX_REDIRECTS = 5;

/**
 * 站点请求客户端（code 评审 r1 F2）：手动逐跳跟随重定向，每一跳请求前按「URL 重定位」规则检查 origin 并记入 requested，
 * 因此 requested 就是实际发出的全部请求。https://openlogos.ai 的地址改写到 <base>；其他 origin 的地址（含重定向 Location）
 * 一律不请求，只记入 external / blockedRedirects，该次请求以 3xx 响应返回，由调用方按非 200 判失败。跳数超过上限即判失败。
 */
export function createSiteClient(baseOrigin, { fetchImpl = fetch, maxRedirects = MAX_REDIRECTS, timeoutMs = 30_000 } = {}) {
  const requested = [];
  const external = new Set();
  const blockedRedirects = [];
  const cache = new Map();
  let caseLog = null;
  const log = (line) => { if (caseLog) caseLog.add(line); };
  const relocate = (raw, from = baseOrigin) => {
    let u;
    try { u = new URL(raw, from); } catch { return null; }
    if (u.origin !== PROD_ORIGIN && u.origin !== baseOrigin) { external.add(u.href); return null; }
    return new URL(`${u.pathname}${u.search}`, baseOrigin).href;
  };
  const get = async (raw) => {
    const url = relocate(raw);
    if (url === null) throw new Error(`拒绝请求站外 URL：${raw}`);
    if (cache.has(url)) {
      for (const line of cache.get(url).hops) log(line);
      return cache.get(url);
    }
    const hops = [];
    let current = url;
    let res;
    for (let hop = 0; ; hop += 1) {
      requested.push(current);
      try {
        res = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        throw new EnvGap(`站点不可达：${current}（${error instanceof Error ? error.message : String(error)}）`, ['network:site']);
      }
      hops.push(`HTTP ${res.status} ${current}`);
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      if (hop + 1 > maxRedirects) throw new Error(`重定向超过 ${maxRedirects} 跳：${url}`);
      const next = relocate(location, current);
      if (next === null) {
        const blocked = `${current} -> ${new URL(location, current).href}`;
        blockedRedirects.push(blocked);
        hops.push(`REDIRECT-BLOCKED ${blocked}`);
        break;
      }
      current = next;
    }
    const contentType = res.headers.get('content-type') || '';
    const isText = /text|xml|json|css|javascript/.test(contentType);
    const buf = isText ? null : Buffer.from(await res.arrayBuffer());
    const page = { url, finalUrl: current, status: res.status, contentType, body: isText ? await res.text() : '', size: buf ? buf.length : 0, hops };
    cache.set(url, page);
    for (const line of hops) log(line);
    return page;
  };
  return {
    get, relocate, requested, external, blockedRedirects,
    setCaseLog: (set) => { caseLog = set; },
  };
}

// ── 运行 ───────────────────────────────────────────────────────────────────────

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain) {
  const repoRoot = process.cwd();
  const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
  const BASE_OVERRIDE = process.env.OPENLOGOS_PCS_BASE;
  const SELF_TEST = typeof BASE_OVERRIDE === 'string' && BASE_OVERRIDE !== '';
  const ENVIRONMENT = SELF_TEST ? 'self-test-preview' : 'production-site';

  const formalResultPath = () => {
    let configured = null;
    try { configured = JSON.parse(readFileSync(join(repoRoot, 'logos/logos.config.json'), 'utf8')).smoke?.result_path ?? null; } catch { /* 缺省 */ }
    return resolve(repoRoot, configured || 'logos/resources/verify/smoke-results.jsonl');
  };
  if (SELF_TEST && canonicalPath(resultPath) === canonicalPath(formalResultPath())) {
    console.error('smoke runner 拒绝运行（未写入任何结果）：自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');
    process.exit(2);
  }

  const activeChange = () => {
    const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
    if (!existsSync(guardFile)) return null;
    try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
  };

  const writeRecords = (rows, ids) => {
    mkdirSync(dirname(resultPath), { recursive: true });
    removeRecords(resultPath, ids);
    const timestamp = new Date().toISOString();
    for (const id of ids) {
      const row = rows.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
      const record = {
        id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT,
        target_environment: TARGET_ENVIRONMENT, detail: row.detail, evidence: row.evidence,
      };
      if (row.status === 'skip') {
        record.not_applicable_reason = row.detail;
        record.missing_requirements = row.missing ?? [];
      }
      appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
    }
  };

  if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_PCS_SMOKE !== '1') {
    const rows = new Map(OWNED.map(id => [id, {
      status: 'skip', detail: `非本案官网速查页验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_PCS_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_PCS_SMOKE'], evidence: [], duration_ms: 0,
    }]));
    writeRecords(rows, OWNED);
    console.log(`smoke 不适用（已为 ${OWNED.join(', ')} 写 skip 留痕）`);
    process.exit(0);
  }

  const rows = new Map();
  const started = Date.now();

  if (SELF_TEST && !isLocalBase(BASE_OVERRIDE)) {
    for (const id of RECORDED) {
      rows.set(id, { status: 'fail', detail: `OPENLOGOS_PCS_BASE 只接受 localhost / 127.0.0.1：${BASE_OVERRIDE}`, evidence: [`base=${BASE_OVERRIDE}`], duration_ms: 0 });
    }
    writeRecords(rows, RECORDED);
    console.error(`smoke 未通过：OPENLOGOS_PCS_BASE 非本地地址（${BASE_OVERRIDE}）`);
    process.exit(1);
  }
  const baseOrigin = new URL(SELF_TEST ? BASE_OVERRIDE : PROD_ORIGIN).origin;

  // ── 请求与重定位（逐跳手动跟随重定向，见 createSiteClient） ──
  const client = createSiteClient(baseOrigin);
  const { get, requested, external, blockedRedirects } = client;
  const getOk = async (path, problems, label = path) => {
    const page = await get(path);
    if (page.status !== 200) { problems.push(`${label} HTTP ${page.status}`); return null; }
    return page;
  };

  /** 本机 CLI 只作 evidence：版本与 `--ai-tool` 取值；超出 H₀ 的取值记为 hosts_beyond_baseline。 */
  const cliEvidence = () => {
    const bin = process.env.OPENLOGOS_BIN || 'openlogos';
    const version = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 60_000, shell: false });
    const help = spawnSync(bin, ['--help'], { encoding: 'utf8', timeout: 60_000, shell: false });
    if (version.error || help.error || help.status !== 0) return ['cli=unavailable（不影响判定）'];
    const tools = parseAiTools(`${help.stdout}\n${help.stderr}`).filter(t => t !== 'other' && t !== 'all');
    const beyond = tools.filter(t => !BASELINE_HOSTS.includes(t));
    return [
      `cli_version=${(version.stdout || '').trim()}`,
      `cli_ai_tools=${tools.join('|')}`,
      ...(beyond.length ? [`hosts_beyond_baseline=${beyond.join('|')}`] : []),
    ];
  };

  const deployEvidence = () => {
    if (SELF_TEST) return ['deploy_record=not-required(self-test)'];
    const report = join(repoRoot, 'logos/resources/verify/deployment-report.md');
    const { values, missing } = parseDeployRecord(existsSync(report) ? readFileSync(report, 'utf8') : null);
    if (missing.length) throw new EnvGap(`本次部署记录缺失：${missing.join(', ')}（需先按部署方案完成官网部署并写入部署记录）`, missing);
    return [`deploy_change=${values.website_docs_deploy_change}`, `deploy_url=${values.website_docs_deploy_url}`, `deploy_id=${values.website_docs_deploy_id}`];
  };

  // ── 用例 ──
  const CASES = {
    'SMOKE-core-306': async () => {
      const problems = [];
      for (const lang of ['en', 'zh']) {
        const { path, index } = PAGES[lang];
        const page = await getOk(`${path}/`, problems, `① ${path}`);
        if (page) problems.push(...checkCheatsheetPage(lang, page.body));
        const idx = await getOk(`${index}/`, problems, `③ ${index}`);
        if (idx && !linkPaths(markdownHtml(idx.body)).includes(path)) problems.push(`③ ${index} 正文缺指向 ${path} 的链接`);
      }
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: '中英文速查页可达，侧栏紧跟首次 AI 协作，简介页有入口，两条主线、五个核心命令与人类确认点齐全', evidence: [] };
    },

    'SMOKE-core-307': async () => {
      const problems = [];
      const evidence = [`baseline_hosts=${BASELINE_HOSTS.join('|')}`];
      for (const lang of ['en', 'zh']) {
        const page = await getOk(`${PAGES[lang].path}/`, problems, `① ${PAGES[lang].path}`);
        if (!page) continue;
        const { problems: p, labels } = checkHostTabs(lang, page.body);
        problems.push(...p);
        evidence.push(`${lang}_tabs=${labels.join(' | ')}`);
      }
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: '中英文宿主差异区块覆盖 0.16.7 七个宿主，ZCode / Qoder / WorkBuddy 标签页写明 change / merge / verify 在终端执行', evidence };
    },

    // ── 复用用例：沿用原定义，执行对象为 <base>（规格「复用的在案用例」） ──
    'SMOKE-core-21': async () => {
      const problems = [];
      for (const path of ['/zh/', '/zh/getting-started/', '/zh/getting-started/prompt-cheatsheet/']) {
        const page = await getOk(path, problems, path);
        if (page && path !== '/zh/' && !page.body.includes('lang="zh-CN"')) problems.push(`${path} 缺 lang="zh-CN"`);
        if (page && path === '/zh/' && !page.body.includes('langSwitcher')) problems.push('/zh/ 缺语言切换器');
      }
      const home = await getOk('/', problems, '/');
      if (home && !home.body.includes('简体中文')) problems.push('英文首页语言切换器缺「简体中文」');
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: '中文首页、中文简介页与中文速查页可访问，文档页 lang="zh-CN"，英文页语言切换器含「简体中文」', evidence: [] };
    },

    'SMOKE-core-23': async () => {
      const problems = [];
      const fonts = new Set();
      for (const path of ['/zh/', '/zh/getting-started/prompt-cheatsheet/']) {
        const page = await getOk(path, problems, path);
        if (!page) continue;
        const sheets = [...page.body.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1]);
        let css = [...page.body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
        for (const href of sheets) {
          const sheet = await get(href);
          if (sheet.status === 200) css += `\n${sheet.body}`;
        }
        if (!/Noto Sans SC/.test(css)) problems.push(`${path} 的 CSS 缺 Noto Sans SC`);
        for (const m of css.matchAll(/url\(([^)]*NotoSansSC-\d+\.subset\.woff2)\)/g)) fonts.add(m[1].replace(/["']/g, ''));
        if (!/unicode-range/.test(css)) problems.push(`${path} 的 CSS 缺 unicode-range`);
      }
      for (const w of ['400', '500', '600', '700', '900']) {
        if (![...fonts].some(f => f.includes(`NotoSansSC-${w}.subset.woff2`))) problems.push(`缺 ${w} 字重子集引用`);
      }
      for (const f of fonts) {
        const font = await get(f);
        if (font.status !== 200 || font.size === 0) problems.push(`字体 ${f} HTTP ${font.status} size=${font.size}`);
      }
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: `中文营销页与中文速查页 CSS 引用 ${fonts.size} 个 NotoSansSC 子集字体且含 unicode-range，字体均可访问且非空`, evidence: [`fonts=${fonts.size}`] };
    },
  };

  // ── 执行与留痕 ──
  const outcome = (error, start, evidence = []) => (error instanceof EnvGap
    ? { status: 'skip', detail: error.message, missing: error.missing, evidence, duration_ms: Date.now() - start }
    : { status: 'fail', detail: error instanceof Error ? error.message : String(error), evidence, duration_ms: Date.now() - start });

  const commonEvidence = [`base=${baseOrigin}`];
  const caseLogs = new Map();
  let ready = true;
  try {
    commonEvidence.push(...deployEvidence());
  } catch (error) {
    ready = false;
    for (const id of RECORDED) rows.set(id, outcome(error, started, commonEvidence));
  }
  if (ready) {
    commonEvidence.push(...cliEvidence());
    for (const id of RECORDED) {
      const caseStart = Date.now();
      const caseLog = new Set();
      caseLogs.set(id, caseLog);
      client.setCaseLog(caseLog);
      try {
        const { detail, evidence } = await CASES[id]();
        rows.set(id, { status: 'pass', detail, evidence: [...commonEvidence, ...evidence], duration_ms: Date.now() - caseStart });
      } catch (error) {
        rows.set(id, outcome(error, caseStart, commonEvidence));
      }
      client.setCaseLog(null);
    }
    // 逐跳请求证据 + 重定位自证：requested 含每一跳，每条实际请求的 origin 必须等于 <base>
    const offsite = requested.filter(u => new URL(u).origin !== baseOrigin);
    for (const id of RECORDED) {
      const row = rows.get(id);
      const log = [...(caseLogs.get(id) ?? [])];
      row.evidence = [...row.evidence, `requests=${log.length}`, `requests_total=${requested.length}`, `offsite_requests=${offsite.length}`,
        `external_links_skipped=${external.size}`, `blocked_redirects=${blockedRedirects.length}`, ...log];
      if (offsite.length > 0) rows.set(id, { ...row, status: 'fail', detail: `存在去往 <base> 之外的实际请求：${offsite.slice(0, 5).join(', ')}` });
    }
  }
  writeRecords(rows, RECORDED);

  const notPassed = RECORDED.filter(id => rows.get(id)?.status !== 'pass');
  if (notPassed.length > 0) {
    console.error(`smoke 未全部通过：${notPassed.map(id => `${id}(${rows.get(id)?.status})`).join(', ')}`);
    for (const id of notPassed) console.error(`  ${id}: ${rows.get(id)?.detail ?? '未执行'}`);
    process.exit(1);
  }
  console.log(`smoke 通过：${RECORDED.join(', ')}（${ENVIRONMENT}，base=${baseOrigin}，请求 ${requested.length} 次）`);
  process.exit(0);
}
