#!/usr/bin/env node
/**
 * SMOKE-core-308 — 官网营销页 footer 的 Markdown6 友情链接发布后取证（add-markdown6-friend-link）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「官网友情链接发布后 smoke（SMOKE-core-308）」；
 * 部署：core-01-deployment-plan.md「官网友情链接发布检查（add-markdown6-friend-link）」。
 *
 * 检查 <base>/、/zh/、/about/、/zh/about/：每页恰好一个 footer.site-footer，其中恰好一个指向 https://markdown6.com/ 的链接，
 * target=_blank、rel 含 noopener 与 noreferrer、aria-label 非空、文本含 Markdown6，footer 文本含对应语言的标签。
 * 只验证官网上的链接写法，不请求 markdown6.com 本身。
 *
 * URL 重定位、逐跳重定向检查、账本去重与真实路径比较沿用 scripts/smoke-website-prompt-cheatsheet.js 的导出实现。
 *
 * **窗口**：活跃变更为本 slug，或 OPENLOGOS_FRIEND_LINK_SMOKE=1；窗口之外为 SMOKE-core-308 写 skip 留痕。
 * **自测模式**：OPENLOGOS_FRIEND_LINK_BASE=<本地预览 URL>（只接受 localhost / 127.0.0.1），结果写独立账本，不要求部署记录。
 * **正式模式**：<base> 固定 https://openlogos.ai，只在 `website_docs_deploy_change: add-markdown6-friend-link` 所属那份
 * 部署报告内读 url / id（只作 evidence）；缺失写显式 skip，不标 platform-unavailable。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EnvGap, PROD_ORIGIN, canonicalPath, createSiteClient, decodeEntities, htmlToText, isLocalBase,
  parseDeployRecord, removeRecords,
} from './smoke-website-prompt-cheatsheet.js';

export const SLUG = 'add-markdown6-friend-link';
export const CASE_ID = 'SMOKE-core-308';
export const FRIEND_URL = 'https://markdown6.com/';
export const TARGET_ENVIRONMENT = 'prod';
export const PAGES = [
  { path: '/', lang: 'en' },
  { path: '/zh/', lang: 'zh' },
  { path: '/about/', lang: 'en' },
  { path: '/zh/about/', lang: 'zh' },
];
const LABEL = { en: 'Friends', zh: '友情链接' };

// ── 纯函数（导出供单元测试复用） ─────────────────────────────────────────────────

/** 页面中所有 class 含 site-footer 的 <footer> 元素内部 HTML。 */
export function siteFooters(html) {
  return [...html.matchAll(/<footer\b[^>]*\bclass="[^"]*\bsite-footer\b[^"]*"[^>]*>([\s\S]*?)<\/footer>/gi)].map(m => m[1]);
}

function attr(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  return m ? decodeEntities(m[1]) : null;
}

/** footer 内的链接：[{ href, target, rel, ariaLabel, text }]，href 规范化为绝对地址。 */
export function footerLinks(footerHtml) {
  return [...footerHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => {
    const raw = attr(m[1], 'href');
    let href = null;
    try { href = raw === null ? null : new URL(raw, PROD_ORIGIN).href; } catch { href = raw; }
    return { href, target: attr(m[1], 'target'), rel: attr(m[1], 'rel'), ariaLabel: attr(m[1], 'aria-label'), text: htmlToText(m[2]) };
  });
}

/** SMOKE-core-308 的单页判据。返回问题清单，空即通过。 */
export function checkFriendLink(path, lang, html) {
  const problems = [];
  const footers = siteFooters(html);
  if (footers.length !== 1) {
    problems.push(`② ${path} site-footer 数量为 ${footers.length}，应恰好 1 个`);
    if (footers.length === 0) return problems;
  }
  const footer = footers[0];
  const links = footerLinks(footer).filter(l => l.href === FRIEND_URL);
  if (links.length !== 1) {
    problems.push(`③ ${path} footer 中指向 ${FRIEND_URL} 的链接数量为 ${links.length}，应恰好 1 个`);
    if (links.length === 0) return problems;
  }
  const [link] = links;
  if (link.target !== '_blank') problems.push(`③ ${path} 友情链接 target=${link.target}，应为 _blank`);
  const rel = (link.rel ?? '').toLowerCase().split(/\s+/);
  for (const token of ['noopener', 'noreferrer']) if (!rel.includes(token)) problems.push(`③ ${path} 友情链接 rel 缺 ${token}`);
  if (!link.ariaLabel || !link.ariaLabel.trim()) problems.push(`③ ${path} 友情链接缺非空 aria-label`);
  if (!link.text.includes('Markdown6')) problems.push(`③ ${path} 友情链接文本不含 Markdown6`);
  if (!htmlToText(footer).includes(LABEL[lang])) problems.push(`③ ${path} footer 缺「${LABEL[lang]}」标签`);
  return problems;
}

// ── 运行 ───────────────────────────────────────────────────────────────────────

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain) {
  const repoRoot = process.cwd();
  const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
  const BASE_OVERRIDE = process.env.OPENLOGOS_FRIEND_LINK_BASE;
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

  const writeRecord = (row) => {
    mkdirSync(dirname(resultPath), { recursive: true });
    removeRecords(resultPath, [CASE_ID]);
    const record = {
      id: CASE_ID, status: row.status, timestamp: new Date().toISOString(), duration_ms: row.duration_ms,
      environment: ENVIRONMENT, target_environment: TARGET_ENVIRONMENT, detail: row.detail, evidence: row.evidence,
    };
    // 窗口外的 skip 没有验证任何环境，不声明 target_environment：该字段表示 runner 实际验证的环境（spec/environments.md §6），
    // 声明了会让其他环境的 smoke（如 --env test）在本记录上判为 SMOKE_ENV_EVIDENCE_MISMATCH
    if (row.outOfWindow) delete record.target_environment;
    if (row.status === 'skip') {
      record.not_applicable_reason = row.detail;
      record.missing_requirements = row.missing ?? [];
    }
    appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  };

  if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_FRIEND_LINK_SMOKE !== '1') {
    writeRecord({
      status: 'skip', detail: `非本案官网友情链接验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_FRIEND_LINK_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_FRIEND_LINK_SMOKE'], evidence: [], duration_ms: 0, outOfWindow: true,
    });
    console.log(`smoke 不适用（已为 ${CASE_ID} 写 skip 留痕）`);
    process.exit(0);
  }

  if (SELF_TEST && !isLocalBase(BASE_OVERRIDE)) {
    writeRecord({ status: 'fail', detail: `OPENLOGOS_FRIEND_LINK_BASE 只接受 localhost / 127.0.0.1：${BASE_OVERRIDE}`, evidence: [`base=${BASE_OVERRIDE}`], duration_ms: 0 });
    console.error(`smoke 未通过：OPENLOGOS_FRIEND_LINK_BASE 非本地地址（${BASE_OVERRIDE}）`);
    process.exit(1);
  }
  const baseOrigin = new URL(SELF_TEST ? BASE_OVERRIDE : PROD_ORIGIN).origin;
  const started = Date.now();
  const evidence = [`base=${baseOrigin}`];
  let row;

  try {
    if (SELF_TEST) evidence.push('deploy_record=not-required(self-test)');
    else {
      const report = join(repoRoot, 'logos/resources/verify/deployment-report.md');
      const { values, missing } = parseDeployRecord(existsSync(report) ? readFileSync(report, 'utf8') : null, SLUG);
      if (missing.length) throw new EnvGap(`本次部署记录缺失：${missing.join(', ')}（需先按部署方案完成官网部署并写入部署记录）`, missing);
      evidence.push(`deploy_change=${values.website_docs_deploy_change}`, `deploy_url=${values.website_docs_deploy_url}`, `deploy_id=${values.website_docs_deploy_id}`);
    }
    const client = createSiteClient(baseOrigin);
    const log = new Set();
    client.setCaseLog(log);
    const problems = [];
    for (const { path, lang } of PAGES) {
      const page = await client.get(path);
      if (page.status !== 200) { problems.push(`① ${path} HTTP ${page.status}`); continue; }
      problems.push(...checkFriendLink(path, lang, page.body));
    }
    const offsite = client.requested.filter(u => new URL(u).origin !== baseOrigin);
    evidence.push(`requests_total=${client.requested.length}`, `offsite_requests=${offsite.length}`, `blocked_redirects=${client.blockedRedirects.length}`, ...log);
    if (offsite.length > 0) problems.push(`存在去往 <base> 之外的实际请求：${offsite.slice(0, 5).join(', ')}`);
    row = problems.length
      ? { status: 'fail', detail: problems.join('；'), evidence, duration_ms: Date.now() - started }
      : { status: 'pass', detail: '中英文首页与 about 页 footer 各有恰好一个指向 https://markdown6.com/ 的友情链接，target=_blank、rel 含 noopener noreferrer、带 aria-label 与对应语言标签', evidence, duration_ms: Date.now() - started };
  } catch (error) {
    row = error instanceof EnvGap
      ? { status: 'skip', detail: error.message, missing: error.missing, evidence, duration_ms: Date.now() - started }
      : { status: 'fail', detail: error instanceof Error ? error.message : String(error), evidence, duration_ms: Date.now() - started };
  }
  writeRecord(row);

  if (row.status !== 'pass') {
    console.error(`smoke 未通过：${CASE_ID}(${row.status})：${row.detail}`);
    process.exit(1);
  }
  console.log(`smoke 通过：${CASE_ID}（${ENVIRONMENT}，base=${baseOrigin}）`);
  process.exit(0);
}
