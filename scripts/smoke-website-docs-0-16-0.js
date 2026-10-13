#!/usr/bin/env node
/**
 * SMOKE-core-235～SMOKE-core-238 — 官网文档站（中英文）补齐 0.16.0 的发布后取证（website-docs-0-16-0）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「官网文档 0.16.0 补齐发布后 smoke（SMOKE-core-235～238）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.0 官网文档补齐发布检查」。
 *
 *   - SMOKE-core-235：新增页面与 CLI 参考覆盖 0.16.0 命令面（含 Gate 编号一致）。
 *   - 复用用例 SMOKE-core-07 / 08 / 21 / 23：按其原口径对 <base>（生产）执行，并以各自 ID 写结果记录。
 *     本案窗口内 website/scripts/smoke-releases.mjs 不再为这四个 ID 写本地 dist 结果、也不删除本 runner 的记录，
 *     因此正式账本里每个 ID 只有一条结果，且来自生产检查对象（code 评审 r1 F3）。
 *   - SMOKE-core-236：中英文全站不再以现行操作呈现旧指引（反向关键词 + 正向断言；发布历史按版本卡片边界例外）。
 *   - SMOKE-core-237：宿主适配内容与 CLI 枚举一致。
 *   - SMOKE-core-238：中英文升级指南可达且内容完整。
 *
 * **执行对象**：正式模式固定 <base>=https://openlogos.ai。命令集合与 `--ai-tool` 取值运行时读已安装 CLI 的
 * `openlogos --help`（可用 OPENLOGOS_BIN 指定入口），补入 help 漏列的 `slice`（来源提案 K4）。
 *
 * **URL 重定位**：sitemap 与页面中的 https://openlogos.ai 绝对 URL 保留 pathname + query、origin 改写为 <base>；
 * 其他 origin 不请求。每条实际请求 URL 都记录，并断言 origin == <base>，否则当次全部用例 fail。
 *
 * **执行边界**：公网只读（HTTP GET + 本机 `openlogos --help`）。网络不可达、本机无 CLI 属可补齐的环境缺口：
 * 写显式 skip（missing_requirements 列出缺失项），不标 platform-unavailable。
 *
 * **部署记录**：正式模式要求 logos/resources/verify/deployment-report.md 含 `website_docs_deploy_url: <url>` 与
 * `website_docs_deploy_id: <id>` 两行（部署任务写入）；缺失即为全部用例写显式 skip（missing_requirements 列出缺失项）
 * 并以非零退出，不得写 pass（code 评审 r1 F1）。值只进 evidence，不参与判定。自测模式不要求部署记录。
 *
 * **证据**：每条结果的 evidence 含该用例实际请求的逐条 `HTTP <状态码> <URL>`（含缓存命中），以及请求总数与站外请求数；
 * 正式与自测同一记录路径（code 评审 r1 F2）。
 *
 * **窗口**：活跃提案为本 slug，或 OPENLOGOS_WEBSITE_DOCS_SMOKE=1；窗口之外为 235～238 写 skip 留痕
 * （复用 ID 此时仍由 smoke-releases.mjs 按本地构建认领）。
 *
 * **自测模式**：OPENLOGOS_WEBSITE_DOCS_SELF_TEST=1 + OPENLOGOS_WEBSITE_DOCS_SITE=<本地预览 URL>，且
 * OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本。正式模式拒绝 SITE 注入；结果以 environment=self-test-preview 写入。
 * 两种模式都先跑 SMOKE-core-236 判据对照夹具 A/B/C，任一不符预期即全部用例 fail。
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SLUG = 'website-docs-0-16-0';
const PROD_ORIGIN = 'https://openlogos.ai';
export const OWNED = ['SMOKE-core-235', 'SMOKE-core-236', 'SMOKE-core-237', 'SMOKE-core-238'];
/** 本案窗口内由本 runner 按生产 <base> 执行并写记录的复用用例（smoke-releases.mjs 同步让出，见其 PRODUCTION_DEFERRED_IDS）。 */
export const REUSED = ['SMOKE-core-07', 'SMOKE-core-08', 'SMOKE-core-21', 'SMOKE-core-23'];
export const RECORDED = [...OWNED, ...REUSED];
export const DEPLOY_RECORD_KEYS = ['website_docs_deploy_url', 'website_docs_deploy_id'];

/** 旧指引关键词集合 K（与部署方案发布前检查第 2 项、proposal「旧指引残留检索」一致）。 */
export const RESIDUE_KEYWORDS = [
  'MERGE_PROMPT', 'merge-apply', 'merge transaction', '.cursor/rules',
  'Layer 1', 'Layer1', 'Layer 3', 'Layer3',
  'Design-time Coverage', 'Acceptance Criteria Traceability', 'git checkout logos/resources',
];
const LAYER_KEYWORDS = new Set(['Layer 1', 'Layer1', 'Layer 3', 'Layer3']);
const MIGRATION_HEADINGS = ['从旧版迁移', 'Migrating from earlier versions'];
const UPGRADE_PATHS = new Set(['/getting-started/upgrade-from-0-13', '/zh/getting-started/upgrade-from-0-13']);
const MIGRATION_PAGES = new Set(['/cli/sync', '/zh/cli/sync', '/cli/merge', '/zh/cli/merge']);
const LAYER_PAGES = new Set(['/deep-dive/engineering-foundation', '/zh/deep-dive/engineering-foundation']);
const RELEASE_PAGES = new Set(['/releases', '/zh/releases']);
const VERSION_TITLE = /^v\d+\.\d+\.\d+/;
const EXPECTED_AI_TOOLS = ['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy', 'other', 'all'];
const TOOL_NAMES = ['Claude Code', 'OpenCode', 'Codex', 'Cursor', 'ZCode', 'Qoder', 'WorkBuddy'];
const FALLBACK_MESSAGE = 'Structured release summary unavailable for this version.';

// ── 纯函数：HTML 处理与 236 判据（导出供夹具对照与单元复用） ─────────────────────────

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

/** 去掉 head / script / style / nav（侧栏与页内目录），保留正文 HTML。 */
export function bodyHtml(html) {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
}

export function htmlToText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function normalizePath(pathname) {
  const p = pathname.replace(/\/index\.html$/, '/');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/**
 * 把正文 HTML 切成「片段」：发布历史版本卡片单独成段，其余按 h1～h3 切成小节。
 * 每段带 heading（所属最近的 ≤ 当前层级的小节标题链顶端）与 releaseVersion（若在版本卡片内）。
 */
export function segments(html) {
  const out = [];
  let rest = bodyHtml(html);
  // 版本卡片：<article class="release-card ...">…</article>（卡片不嵌套）
  const cardRe = /<article\b[^>]*class="[^"]*\brelease-card\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  rest = rest.replace(cardRe, (_, inner) => {
    const title = /class="[^"]*\brelease-title\b[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(inner);
    const titleText = title ? htmlToText(title[1]) : '';
    out.push({ heading: null, releaseVersion: VERSION_TITLE.test(titleText) ? titleText : null, text: htmlToText(inner) });
    return ' ';
  });
  // 小节：按 h1～h3 切分；迁移小节延伸到下一个同级或更高级标题
  const headRe = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const marks = [];
  let m;
  while ((m = headRe.exec(rest)) !== null) marks.push({ index: m.index, end: headRe.lastIndex, level: Number(m[1]), title: htmlToText(m[2]) });
  const stack = [];
  let cursor = 0;
  const push = (from, to) => {
    const text = htmlToText(rest.slice(from, to));
    if (text) out.push({ heading: stack.map(s => s.title), releaseVersion: null, text });
  };
  for (const mark of marks) {
    push(cursor, mark.index);
    while (stack.length && stack[stack.length - 1].level >= mark.level) stack.pop();
    stack.push({ level: mark.level, title: mark.title });
    cursor = mark.index;
  }
  push(cursor, rest.length);
  return out;
}

/** SMOKE-core-236 反向判据：返回不被允许的命中（空数组即通过）。 */
export function residueViolations(pagePath, html) {
  const path = normalizePath(pagePath);
  const violations = [];
  for (const seg of segments(html)) {
    for (const kw of RESIDUE_KEYWORDS) {
      let idx = seg.text.indexOf(kw);
      while (idx !== -1) {
        const allowed = UPGRADE_PATHS.has(path)
          || (MIGRATION_PAGES.has(path) && (seg.heading ?? []).some(h => MIGRATION_HEADINGS.includes(h)))
          || (LAYER_PAGES.has(path) && LAYER_KEYWORDS.has(kw))
          || (RELEASE_PAGES.has(path) && seg.releaseVersion !== null);
        if (!allowed) {
          violations.push({
            path, keyword: kw, section: (seg.heading ?? []).join(' > ') || (seg.releaseVersion ? `release-card ${seg.releaseVersion}` : '(page)'),
            context: seg.text.slice(Math.max(0, idx - 40), idx + kw.length + 40),
          });
        }
        idx = seg.text.indexOf(kw, idx + kw.length);
      }
    }
  }
  return violations;
}

/** 判据对照夹具 A/B/C（规格 §五）：A 预期通过，B、C 预期失败。 */
export const RESIDUE_FIXTURES = [
  {
    name: 'A', path: '/releases/', expectPass: true,
    html: '<html><head><title>x</title></head><body><main><h1>Releases</h1><div class="release-list">'
      + '<article class="release-card"><div class="release-top"><div class="release-title"><h3>v0.9.19</h3></div></div>'
      + '<ul><li>Fixed openlogos merge idempotency so an already merged proposal exits cleanly instead of regenerating MERGE_PROMPT.md.</li>'
      + '<li>launch now refreshes .cursor/rules/openlogos-policy.mdc</li></ul></article></div></main></body></html>',
  },
  {
    name: 'B', path: '/cli/merge/', expectPass: false,
    html: '<html><body><main><div class="sl-markdown-content"><h2 id="usage">Usage</h2>'
      + '<ol><li>Run openlogos merge &lt;slug&gt;.</li><li>Read MERGE_PROMPT.md and execute the merge.</li></ol>'
      + '<div class="sl-heading-wrapper level-h2"><h2 id="migrating">Migrating from earlier versions</h2></div>'
      + '<p>MERGE_PROMPT.md was removed in 0.15.0.</p></div></main></body></html>',
  },
  {
    name: 'C', path: '/releases/', expectPass: false,
    html: '<html><body><main><section class="release-hero"><p>To merge, read MERGE_PROMPT.md first.</p></section>'
      + '<article class="release-card"><div class="release-title"><h3>v0.9.19</h3></div><p>regenerating MERGE_PROMPT.md</p></article>'
      + '</main></body></html>',
  },
];

export function runResidueFixtures() {
  return RESIDUE_FIXTURES.map(f => {
    const v = residueViolations(f.path, f.html);
    const passed = v.length === 0;
    return { name: f.name, expectPass: f.expectPass, passed, ok: passed === f.expectPass, violations: v.length };
  });
}

/** 解析 `openlogos --help` 的 Commands 段，得到顶层命令名（如 `feature list`、`flow show`、`change-lint`）。 */
export function parseHelpCommands(helpText) {
  const lines = helpText.split(/\r?\n/);
  const start = lines.findIndex(l => /^Commands:\s*$/.test(l));
  if (start === -1) return [];
  const names = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // 下一个顶层段（Options:）
    if (!/^ {2}[a-z]/.test(line)) continue; // 只取恰好两格缩进的命令行
    const usage = line.trim().split(/\s{2,}/)[0];
    const tokens = [];
    for (const tok of usage.split(/\s+/)) {
      if (/^[<[\-]/.test(tok)) break;
      tokens.push(tok);
    }
    if (tokens.length) names.push(tokens.join(' '));
  }
  return [...new Set(names)];
}

/** 解析 `init` 段 `--ai-tool <a|b|…>` 的取值集合。 */
export function parseAiTools(helpText) {
  const m = /--ai-tool <([^>]+)>/.exec(helpText);
  return m ? m[1].split('|').map(s => s.trim()).filter(Boolean) : [];
}

/** 命令名 → 页面 slug 的固定映射（规格 SMOKE-core-235 ①）。 */
export function commandSlug(name) {
  const fixed = {
    index: 'index-command', 'flow show': 'flow-show', 'feature list': 'feature', 'feature-backfill': 'feature',
    ignore: 'ignore-exempt', exempt: 'ignore-exempt',
  };
  return fixed[name] ?? name.replace(/\s+/g, '-');
}

/** 正文中提取 `/cli/…`（或 `/zh/cli/…`）链接集合（slug，去前后缀）。 */
export function cliLinks(html, zh) {
  const prefix = zh ? '/zh/cli/' : '/cli/';
  const set = new Set();
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    try { href = new URL(href, PROD_ORIGIN).pathname; } catch { continue; }
    if (!href.startsWith(prefix)) continue;
    const slug = normalizePath(href).slice(prefix.length);
    if (slug) set.add(slug);
  }
  return set;
}

/** Starlight 主侧栏：`<nav class="sidebar …">`（aria-label 随语言变化，英文 Main、中文「主要」，故按 class 定位）。 */
export function sidebarHtml(html) {
  return /<nav\b[^>]*class="[^"]*\bsidebar\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1] ?? '';
}

export function markdownHtml(html) {
  const start = html.indexOf('sl-markdown-content');
  if (start === -1) return '';
  const end = html.indexOf('</main>', start);
  return html.slice(start, end === -1 ? undefined : end);
}

/** 解析部署记录：返回各键取值与缺失项（缺文件时 text 为 null）。 */
export function parseDeployRecord(text) {
  if (text === null) return { values: {}, missing: ['logos/resources/verify/deployment-report.md'] };
  const values = {};
  const missing = [];
  for (const key of DEPLOY_RECORD_KEYS) {
    const v = new RegExp(`^\\s*[-*]?\\s*\`?${key}\`?:\\s*\`?([^\\s\`]+)`, 'm').exec(text)?.[1];
    if (v) values[key] = v; else missing.push(`deployment-report:${key}`);
  }
  return { values, missing };
}

export function firstGate(text) {
  return /Gate (3\.\d)/.exec(text)?.[1] ?? null;
}

/** 命令页自身标注的 Gate：以 meta description 为准（正文常先提到前置门禁），缺省时取正文首个。 */
export function pageGate(html) {
  const desc = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)?.[1];
  return (desc && firstGate(decodeEntities(desc))) || firstGate(htmlToText(markdownHtml(html) || bodyHtml(html)));
}

// ── 运行环境 ───────────────────────────────────────────────────────────────────

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain) {
  const repoRoot = process.cwd();
  const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
  const SELF_TEST = process.env.OPENLOGOS_WEBSITE_DOCS_SELF_TEST === '1';
  const SITE_OVERRIDE = process.env.OPENLOGOS_WEBSITE_DOCS_SITE;
  const ENVIRONMENT = SELF_TEST ? 'self-test-preview' : 'production-site';

  const refuse = (reason) => {
    console.error(`smoke runner 拒绝运行（未写入任何结果）：${reason}`);
    process.exit(2);
  };
  const formalResultPath = () => {
    let configured = null;
    try { configured = JSON.parse(readFileSync(join(repoRoot, 'logos/logos.config.json'), 'utf8')).smoke?.result_path ?? null; } catch { /* 缺省 */ }
    return resolve(repoRoot, configured || 'logos/resources/verify/smoke-results.jsonl');
  };
  if (!SELF_TEST && SITE_OVERRIDE !== undefined) refuse('设置了 OPENLOGOS_WEBSITE_DOCS_SITE 但未声明自测（OPENLOGOS_WEBSITE_DOCS_SELF_TEST=1）');
  if (SELF_TEST && !SITE_OVERRIDE) refuse('自测模式需要提供 OPENLOGOS_WEBSITE_DOCS_SITE（本地预览 URL）');
  if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

  let base;
  try { base = new URL(SELF_TEST ? SITE_OVERRIDE : PROD_ORIGIN); } catch { refuse(`非法的站点 URL：${SITE_OVERRIDE}`); }
  const baseOrigin = base.origin;

  const activeChange = () => {
    const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
    if (!existsSync(guardFile)) return null;
    try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
  };

  const writeRecords = (rows, ids) => {
    mkdirSync(dirname(resultPath), { recursive: true });
    const timestamp = new Date().toISOString();
    for (const id of ids) {
      const row = rows.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
      const record = { id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT, detail: row.detail, evidence: row.evidence };
      if (row.status === 'skip') {
        record.not_applicable_reason = row.detail;
        record.missing_requirements = row.missing ?? [];
      }
      appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
    }
  };

  if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_WEBSITE_DOCS_SMOKE !== '1') {
    const rows = new Map(OWNED.map(id => [id, {
      status: 'skip', detail: `非本案官网文档验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_WEBSITE_DOCS_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_WEBSITE_DOCS_SMOKE'], evidence: [], duration_ms: 0,
    }]));
    writeRecords(rows, OWNED);
    console.log(`smoke 不适用（已为 ${OWNED.join(', ')} 写 skip 留痕）`);
    process.exit(0);
  }

  class EnvGap extends Error {
    constructor(message, missing) { super(message); this.missing = missing; }
  }

  // ── 请求与重定位 ──
  const requested = [];
  const external = new Set();
  const cache = new Map();
  /** 当前用例的逐条请求证据（`HTTP <状态码> <URL>`，同一用例内去重；缓存命中同样记入该用例）。 */
  let caseLog = null;
  const logRequest = (page) => { if (caseLog) caseLog.add(`HTTP ${page.status} ${page.url}`); };
  /** 把站内 URL（相对或 https://openlogos.ai 绝对）改写到 <base>；其他 origin 返回 null。 */
  const relocate = (raw) => {
    let u;
    try { u = new URL(raw, baseOrigin); } catch { return null; }
    if (u.origin !== PROD_ORIGIN && u.origin !== baseOrigin) { external.add(u.href); return null; }
    return new URL(`${u.pathname}${u.search}`, baseOrigin).href;
  };
  const get = async (raw) => {
    const url = relocate(raw);
    if (url === null) throw new Error(`拒绝请求站外 URL：${raw}`);
    if (cache.has(url)) { logRequest(cache.get(url)); return cache.get(url); }
    requested.push(url);
    let res;
    try {
      res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      throw new EnvGap(`站点不可达：${url}（${error instanceof Error ? error.message : String(error)}）`, ['network:site']);
    }
    const finalUrl = res.url || url;
    if (new URL(finalUrl).origin !== baseOrigin) requested.push(finalUrl);
    const contentType = res.headers.get('content-type') || '';
    const isText = /text|xml|json|css|javascript/.test(contentType);
    const buf = isText ? null : Buffer.from(await res.arrayBuffer());
    const page = { url, status: res.status, contentType, body: isText ? await res.text() : '', size: buf ? buf.length : 0 };
    cache.set(url, page);
    logRequest(page);
    return page;
  };
  const getOk = async (path, problems, label = path) => {
    const page = await get(path);
    if (page.status !== 200) { problems.push(`${label} HTTP ${page.status}`); return null; }
    return page;
  };

  const cliHelp = () => {
    const bin = process.env.OPENLOGOS_BIN || 'openlogos';
    const r = spawnSync(bin, ['--help'], { encoding: 'utf8', timeout: 60_000, shell: false });
    if (r.error || r.status !== 0) throw new EnvGap(`无法执行已安装 CLI：${bin} --help（${r.error?.message ?? `exit ${r.status}`}）`, ['openlogos-cli']);
    const versionRun = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 60_000, shell: false });
    return { text: `${r.stdout}\n${r.stderr}`, version: (versionRun.stdout || '').trim() };
  };

  /** 正式模式缺部署记录 → EnvGap（全部用例 skip、非零退出）；自测不要求。值只作 evidence。 */
  const deployEvidence = () => {
    if (SELF_TEST) return ['deploy_record=not-required(self-test)'];
    const report = join(repoRoot, 'logos/resources/verify/deployment-report.md');
    const { values, missing } = parseDeployRecord(existsSync(report) ? readFileSync(report, 'utf8') : null);
    if (missing.length) throw new EnvGap(`部署记录缺失：${missing.join(', ')}（需先按部署方案完成官网部署并写入部署记录）`, missing);
    return [`deploy_url=${values.website_docs_deploy_url}`, `deploy_id=${values.website_docs_deploy_id}`];
  };

  // ── 用例 ──
  const ctx = {};
  const CASES = {
    'SMOKE-core-235': async () => {
      const problems = [];
      const evidence = [];
      const commands = parseHelpCommands(ctx.help.text);
      if (!commands.includes('slice')) commands.push('slice'); // K4：help 漏列，实际可用
      const names = commands.filter(c => c !== 'baseline-seed');
      for (const must of ['change-lint', 'lint-specs', 'ignore', 'exempt', 'impact', 'slice']) {
        if (!commands.includes(must)) problems.push(`① 命令集合缺 ${must}`);
      }
      const bySlug = new Map();
      for (const name of names) {
        const slug = commandSlug(name);
        if (!bySlug.has(slug)) bySlug.set(slug, []);
        bySlug.get(slug).push(name);
      }
      evidence.push(`commands=${names.join(',')}`);
      // ② 命令页
      for (const [slug, cmdNames] of bySlug) {
        for (const prefix of ['', '/zh']) {
          const page = await getOk(`${prefix}/cli/${slug}/`, problems, `② ${prefix}/cli/${slug}`);
          if (!page) continue;
          const text = htmlToText(markdownHtml(page.body) || bodyHtml(page.body));
          for (const n of cmdNames) if (!text.includes(`openlogos ${n}`)) problems.push(`② ${prefix}/cli/${slug} 正文缺「openlogos ${n}」`);
        }
      }
      // ③ 概览页侧栏与命令表
      const overviewGate = {};
      for (const [prefix, zh] of [['', false], ['/zh', true]]) {
        const page = await getOk(`${prefix}/cli/`, problems, `③ ${prefix}/cli`);
        if (!page) continue;
        const side = cliLinks(sidebarHtml(page.body), zh);
        const table = cliLinks(markdownHtml(page.body), zh);
        for (const slug of bySlug.keys()) {
          if (!side.has(slug)) problems.push(`③ ${prefix}/cli 侧栏缺 ${slug}`);
          if (!table.has(slug)) problems.push(`③ ${prefix}/cli 命令表缺 ${slug}`);
        }
        // ⑤ 概览页 Gate：取链接到该命令的表格行中的 Gate 编号
        const md = markdownHtml(page.body);
        for (const slug of ['verify', 'smoke', 'deploy-done']) {
          const row = new RegExp(`<tr>(?:(?!</tr>)[\\s\\S])*?href="${prefix}/cli/${slug}/?"(?:(?!</tr>)[\\s\\S])*?</tr>`).exec(md)?.[0] ?? '';
          overviewGate[`${prefix}:${slug}`] = firstGate(htmlToText(row));
        }
      }
      // ④ 新增非 CLI 页面
      for (const path of ['/specs/pretooluse-guard/', '/specs/test-slice-manifest/', '/skills/brownfield-adopter/']) {
        for (const prefix of ['', '/zh']) {
          const page = await getOk(`${prefix}${path}`, problems, `④ ${prefix}${path}`);
          if (page && path.includes('brownfield') && !htmlToText(bodyHtml(page.body)).includes('openlogos baseline-seed')) {
            problems.push(`④ ${prefix}${path} 缺「openlogos baseline-seed」`);
          }
        }
      }
      // ⑤ Gate 编号一致
      for (const slug of ['verify', 'smoke', 'deploy-done']) {
        const gates = [];
        for (const prefix of ['', '/zh']) {
          const page = cache.get(relocate(`${prefix}/cli/${slug}/`));
          const own = page && page.status === 200 ? pageGate(page.body) : null;
          const ov = overviewGate[`${prefix}:${slug}`];
          gates.push(own, ov);
          if (!own || !ov || own !== ov) problems.push(`⑤ ${prefix}/cli/${slug} Gate=${own}，概览=${ov}`);
        }
        evidence.push(`gate_${slug}=${[...new Set(gates)].join('/')}`);
        if (new Set(gates.filter(Boolean)).size > 1) problems.push(`⑤ ${slug} 中英文 Gate 编号不一致：${gates.join(',')}`);
      }
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: `CLI 参考覆盖 ${bySlug.size} 个命令页（中英文），新增规格 / Skill 页可达，Gate 编号一致`, evidence };
    },

    'SMOKE-core-236': async () => {
      const problems = [];
      const index = await getOk('/sitemap-index.xml', problems, '① sitemap-index');
      if (!index) throw new Error(problems.join('；'));
      const pages = new Set();
      for (const loc of [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim())) {
        const child = await getOk(loc, problems, `① ${loc}`);
        if (!child) continue;
        for (const m of child.body.matchAll(/<loc>([^<]+)<\/loc>/g)) pages.add(m[1].trim());
      }
      if (pages.size === 0) problems.push('① sitemap 未列出任何页面');
      const violations = [];
      for (const loc of pages) {
        const page = await get(loc);
        if (page.status !== 200) { problems.push(`② ${loc} HTTP ${page.status}`); continue; }
        violations.push(...residueViolations(new URL(page.url).pathname, page.body));
      }
      for (const v of violations.slice(0, 30)) problems.push(`③ ${v.path} [${v.section}] 命中「${v.keyword}」：…${v.context}…`);
      if (violations.length > 30) problems.push(`③ 另有 ${violations.length - 30} 条命中`);
      // ④ 正向断言
      for (const [path, zh] of [['/skills/code-implementor/', false], ['/zh/skills/code-implementor/', true]]) {
        const page = await getOk(path, problems, `④ ${path}`);
        if (!page) continue;
        const text = htmlToText(markdownHtml(page.body) || bodyHtml(page.body));
        if (!text.includes('initial') || !text.includes('launched')) problems.push(`④ ${path} 缺 initial / launched 两种情形`);
        if (zh ? !(text.includes('不得自行') || text.includes('不自行')) : !(text.includes('must not re-batch') || text.includes('not re-split'))) problems.push(`④ ${path} 缺「launched 下不自行分批」表述`);
        if (!zh && !text.includes('slice-planner')) problems.push(`④ ${path} 缺 slice-planner`);
      }
      for (const [path, zh] of [['/cli/merge/', false], ['/zh/cli/merge/', true]]) {
        const page = await getOk(path, problems, `④ ${path}`);
        if (!page) continue;
        const text = htmlToText(markdownHtml(page.body) || bodyHtml(page.body));
        if (!text.includes('amended')) problems.push(`④ ${path} 缺 amended`);
        if (zh ? !text.includes('一次') : !(text.includes('single call') || text.includes('one call'))) problems.push(`④ ${path} 缺「一次调用完成合并」表述`);
      }
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: `全站 ${pages.size} 个页面无旧指引残留（发布历史与迁移小节按例外处理），正向断言通过`, evidence: [`pages=${pages.size}`, 'violations=0'] };
    },

    'SMOKE-core-237': async () => {
      const problems = [];
      const tools = parseAiTools(ctx.help.text);
      for (const t of EXPECTED_AI_TOOLS) if (!tools.includes(t)) problems.push(`① --ai-tool 缺 ${t}`);
      for (const path of ['/cli/init/', '/zh/cli/init/']) {
        const page = await getOk(path, problems, `② ${path}`);
        if (!page) continue;
        const text = htmlToText(bodyHtml(page.body));
        for (const t of tools) if (!new RegExp(`(^|[^a-z-])${t.replace(/-/g, '\\-')}([^a-z-]|$)`).test(text)) problems.push(`② ${path} 缺取值 ${t}`);
      }
      for (const host of ['zcode', 'qoder', 'workbuddy', 'cursor']) {
        for (const prefix of ['', '/zh']) {
          const page = await getOk(`${prefix}/specs/${host}-plugin/`, problems, `③ ${prefix}/specs/${host}-plugin`);
          if (page && host === 'cursor') {
            const text = htmlToText(bodyHtml(page.body));
            if (!text.includes('.cursor/skills/')) problems.push(`③ ${prefix}/specs/cursor-plugin 缺 .cursor/skills/`);
            if (!text.includes('afterShellExecution')) problems.push(`③ ${prefix}/specs/cursor-plugin 缺 afterShellExecution`);
          }
        }
      }
      for (const path of ['/', '/zh/', '/about/', '/zh/about/']) {
        const page = await getOk(path, problems, `④ ${path}`);
        if (!page) continue;
        const text = htmlToText(bodyHtml(page.body));
        for (const n of TOOL_NAMES) if (!text.includes(n)) problems.push(`④ ${path} 缺工具名 ${n}`);
      }
      for (const path of ['/cli/sync/', '/zh/cli/sync/']) {
        const page = await getOk(path, problems, `⑤ ${path}`);
        if (!page) continue;
        const text = htmlToText(bodyHtml(page.body));
        if (!text.includes('.cursor/skills/')) problems.push(`⑤ ${path} 缺 .cursor/skills/`);
        if (!text.includes('language')) problems.push(`⑤ ${path} 缺 language`);
      }
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: '`--ai-tool` 九个取值在 init 页齐全，四个宿主规格页可达，首页 / about 列出七个工具，sync 页含 Cursor Skills 与 language', evidence: [`ai_tools=${tools.join('|')}`] };
    },

    'SMOKE-core-238': async () => {
      const problems = [];
      const markers = {
        common: ['npm install -g @miniidealab/openlogos@latest', 'openlogos --version', '0.16.0', 'openlogos sync',
          '.cursor/rules/', '.cursor/skills/', 'openlogos merge', 'openlogos slice plan', 'data.contract.version'],
        zh: ['每个已有项目', '旧版 guard'],
        en: ['each existing project', 'old guard'],
      };
      for (const [prefix, lang] of [['', 'en'], ['/zh', 'zh']]) {
        const page = await getOk(`${prefix}/getting-started/upgrade-from-0-13/`, problems, `① ${prefix}/getting-started/upgrade-from-0-13`);
        if (page) {
          const text = htmlToText(markdownHtml(page.body) || bodyHtml(page.body));
          for (const mk of [...markers.common, ...markers[lang]]) if (!text.includes(mk)) problems.push(`③ ${lang} 升级指南缺「${mk}」`);
          if (!text.includes('merge transaction') && !text.includes('merge-apply')) problems.push(`③ ${lang} 升级指南缺事务命令移除说明（merge transaction / merge-apply）`);
        }
        const gs = await getOk(`${prefix}/getting-started/`, problems, `② ${prefix}/getting-started`);
        if (gs) {
          const links = [...sidebarHtml(gs.body).matchAll(/href="([^"]+)"/g)].map(m => normalizePath(new URL(m[1], PROD_ORIGIN).pathname));
          if (!links.includes(`${prefix}/getting-started/upgrade-from-0-13`)) problems.push(`② ${prefix}/getting-started 侧栏未链接升级指南`);
        }
      }
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: '中英文升级指南均可达、侧栏可进入，逐项包含 CHANGELOG 0.16.0「从 0.13.x 升级」各步', evidence: [] };
    },

    // ── 复用用例：沿用原定义，执行对象为 <base>（规格 §二） ──
    'SMOKE-core-07': async () => {
      const problems = [];
      const expectLatest = JSON.parse(readFileSync(join(repoRoot, 'website/src/data/releases.json'), 'utf8')).latestVersion;
      for (const path of ['/releases/', '/zh/releases/']) {
        const page = await getOk(path, problems, path);
        if (!page) continue;
        const latest = /class="(?:[^"]*\s)?latest-version(?:\s[^"]*)?"[^>]*>\s*v([0-9][0-9.]*)\s*</.exec(page.body)?.[1] ?? null;
        if (latest !== expectLatest) problems.push(`${path} latest=${latest}，应为 ${expectLatest}`);
        if (path === '/releases/') {
          const start = page.body.indexOf(`>v${expectLatest}</h3>`);
          const next = start === -1 ? -1 : page.body.indexOf('<article', start);
          const card = start === -1 ? '' : page.body.slice(start, next === -1 ? undefined : next);
          const valueBlock = card.split('<h4')[1] ?? '';
          if (!valueBlock.includes('<li') || valueBlock.includes(FALLBACK_MESSAGE)) problems.push(`v${expectLatest} 未展示英文价值摘要`);
          if (!card.includes('summary-original')) problems.push(`v${expectLatest} 缺中文原文次级内容`);
        }
      }
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: `/releases 与 /zh/releases latest=${expectLatest}，该版本展示英文价值摘要并保留中文原文`, evidence: [`latest=${expectLatest}`] };
    },

    'SMOKE-core-08': async () => {
      const problems = [];
      const home = await getOk('/', problems, '/');
      if (home && !/href="\/releases\/?"/.test(home.body)) problems.push('首页无 /releases 入口');
      const releases = await getOk('/releases/', problems, '/releases');
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: `首页可进入发布动态（/releases HTTP ${releases.status}）`, evidence: [] };
    },

    'SMOKE-core-21': async () => {
      const problems = [];
      for (const path of ['/zh/', '/zh/getting-started/', '/zh/cli/', '/zh/cli/slice/']) {
        const page = await getOk(path, problems, path);
        if (page && path !== '/zh/' && !page.body.includes('lang="zh-CN"')) problems.push(`${path} 缺 lang="zh-CN"`);
        if (page && path === '/zh/' && !page.body.includes('langSwitcher')) problems.push('/zh/ 缺语言切换器');
      }
      const home = await getOk('/', problems, '/');
      if (home && !home.body.includes('简体中文')) problems.push('英文首页语言切换器缺「简体中文」');
      if (problems.length) throw new Error(problems.join('；'));
      return { detail: '中文首页与中文文档页可访问，文档页 lang="zh-CN"，英文页语言切换器含「简体中文」', evidence: [] };
    },

    'SMOKE-core-23': async () => {
      const problems = [];
      const fonts = new Set();
      for (const path of ['/zh/', '/zh/getting-started/']) {
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
      return { detail: `中文页 CSS 引用 ${fonts.size} 个 NotoSansSC 子集字体且含 unicode-range，字体均可访问且非空`, evidence: [`fonts=${fonts.size}`] };
    },
  };

  // ── 执行与留痕 ──
  const rows = new Map();
  const outcome = (error, started, evidence = []) => (error instanceof EnvGap
    ? { status: 'skip', detail: error.message, missing: error.missing, evidence, duration_ms: Date.now() - started }
    : { status: 'fail', detail: error instanceof Error ? error.message : String(error), evidence, duration_ms: Date.now() - started });

  const started = Date.now();
  const fixtures = runResidueFixtures();
  const fixtureEvidence = fixtures.map(f => `fixture_${f.name}=${f.passed ? 'pass' : 'fail'}(expect ${f.expectPass ? 'pass' : 'fail'})`);
  const commonEvidence = [`base=${baseOrigin}`, ...fixtureEvidence];
  const caseLogs = new Map();
  if (fixtures.some(f => !f.ok)) {
    for (const id of RECORDED) rows.set(id, { status: 'fail', detail: `SMOKE-core-236 判据对照夹具结果不符预期：${fixtureEvidence.join(', ')}`, evidence: commonEvidence, duration_ms: Date.now() - started });
  } else {
    try {
      commonEvidence.push(...deployEvidence());
      ctx.help = cliHelp();
      commonEvidence.push(`cli_version=${ctx.help.version}`);
    } catch (error) {
      for (const id of RECORDED) rows.set(id, outcome(error, started, commonEvidence));
    }
    if (ctx.help) {
      for (const id of RECORDED) {
        const caseStart = Date.now();
        caseLog = new Set();
        caseLogs.set(id, caseLog);
        try {
          const { detail, evidence } = await CASES[id]();
          rows.set(id, { status: 'pass', detail, evidence: [...commonEvidence, ...evidence], duration_ms: Date.now() - caseStart });
        } catch (error) {
          rows.set(id, outcome(error, caseStart, commonEvidence));
        }
        caseLog = null;
      }
    }
    // 逐条请求证据 + 重定位自证：每条实际请求的 origin 必须等于 <base>
    const offsite = requested.filter(u => new URL(u).origin !== baseOrigin);
    for (const id of RECORDED) {
      const row = rows.get(id);
      const log = [...(caseLogs.get(id) ?? [])];
      row.evidence = [...row.evidence, `requests=${log.length}`, `requests_total=${requested.length}`, `offsite_requests=${offsite.length}`, `external_links_skipped=${external.size}`, ...log];
      if (offsite.length > 0) {
        rows.set(id, { ...row, status: 'fail', detail: `存在去往 <base> 之外的实际请求：${offsite.slice(0, 5).join(', ')}` });
      }
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
