#!/usr/bin/env node
'use strict';
/**
 * OpenLogos guard 事后检查引擎（guard-versioned-content-scope，spec/pretooluse-guard.md
 * 「版本控制内容保护与事后检查（规范性）」）。Node CommonJS，零外部依赖。
 *
 * 子命令：
 *   snapshot [--rebase-only]                 PreToolUse 拍快照（guard-check 调用；含对未关闭记录的补查）
 *   check [--stop|--session-start|--pre-tool-use|--rebase-only]
 *                                            PostToolUse / PostToolUseFailure / Stop / SessionStart / PreToolUse 补查
 *   restore <record_id> -- <path>            按报告记录把单个路径恢复为执行前的原始字节
 *   boundary-start / boundary-end            提案边界（openlogos change 写 guard 文件前 / archive 删 guard 文件前）
 *   classify [--host claude|cursor] [--shell bash|powershell]
 *                                            guard-check 内部使用：独立调用 / restore / 只读 / 可确定写入目标
 *
 * 状态目录 logos/.openlogos-runtime/（.gitignore 托管区块固定忽略）：
 *   guard-records/<id>.json   执行记录          pending-reports.jsonl  待报告项
 *   reported.jsonl            已报告去重表      raw-baseline.json      原始字节基线缓存
 *   state.lock                项目级状态锁      pending-spill/<pid>-<时间戳>.json  拿不到锁时溢出的待报告项
 *   guard-records/<id>.closed 已关闭记录的墓碑（下一次会话开始后清理）
 * 本文件同时导出纯函数（module.exports），供测试在函数层调用真实实现。
 *
 * 仅测试使用的故障注入（默认关闭，生产环境不设置）：
 *   OPENLOGOS_GUARD_TEST_FAULT=throw-before-rename          原子落盘写完临时文件、rename 之前抛错
 *   OPENLOGOS_GUARD_TEST_FAULT=pause-before-rename          同一位置挂起（供测试 kill -9）
 *   OPENLOGOS_GUARD_TEST_FAULT=kill-after-record-writes:<n> 本进程第 n 次执行记录落盘后以 SIGKILL 自终止
 *   OPENLOGOS_GUARD_TEST_FAULT=kill-after-emit              反馈写出后、去重表与送达状态落盘前以 SIGKILL 自终止
 *   OPENLOGOS_GUARD_TEST_LOCK_WAIT_MS=<ms>                  覆盖等锁上限（默认 5000）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const RUNTIME_REL = 'logos/.openlogos-runtime';
const CONFIG_REL = 'logos/logos.config.json';
const GUARD_FILE_REL = 'logos/.openlogos-guard';
const RESOURCES_REL = 'logos/resources';
const MAX_RETAIN_BYTES = 5 * 1024 * 1024;
const CLAUDE_ENGINE_REL = '.claude/openlogos/bin/guard-post-check.cjs';
const CURSOR_ENGINE_REL = '.cursor/hooks/openlogos-guard-post.cjs';
const LOCK_WAIT_MS = 5000;
const SPILL_DIR = 'pending-spill';
const LOCK_STALE_MS = 30000;

// 与 plugin/bin/guard-check 的 WHITELIST_PREFIXES 逐项一致（受保护判定第 5 步；已去掉 .gitignore）
const WHITELIST_PREFIXES = [
  'logos/changes/', 'logos/.openlogos-guard', 'logos/logos-project.yaml', '.claude/', '.opencode/', '.codex-plugin/',
  '.cursor/', 'logos/skills/', 'logos/spec/', 'README', 'CLAUDE.md', 'AGENTS.md', 'opencode.json', '.openlogos',
];
const BUILTIN_EXEMPT = ['logos/resources/reference/', 'logos/resources/verify/baseline-seed-runs/*/staging/'];

/* ─────────────────────────── 基础工具 ─────────────────────────── */

/** 可注入时钟（测试以 OPENLOGOS_GUARD_NOW_NS 固定）：纳秒 BigInt。 */
function nowNs() {
  const inj = process.env.OPENLOGOS_GUARD_NOW_NS;
  if (inj && /^\d+$/.test(inj)) return BigInt(inj);
  return BigInt(Date.now()) * 1000000n;
}

/** 测试观测钩子：OPENLOGOS_GUARD_TRACE 指向文件时逐行追加 JSON 事件（git 调用、hash 批次、restore 改名）。 */
function trace(ev) {
  const f = process.env.OPENLOGOS_GUARD_TRACE;
  if (!f) return;
  try { fs.appendFileSync(f, `${JSON.stringify({ pid: process.pid, ...ev })}\n`); } catch { /* 观测失败不影响判定 */ }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function randTag() {
  return Math.random().toString(36).slice(2, 8);
}

/** 测试故障注入（OPENLOGOS_GUARD_TEST_FAULT，默认关闭）：返回 { kind, arg } 或 null。 */
function testFault() {
  const v = process.env.OPENLOGOS_GUARD_TEST_FAULT;
  if (!v) return null;
  const i = v.indexOf(':');
  return i < 0 ? { kind: v, arg: '' } : { kind: v.slice(0, i), arg: v.slice(i + 1) };
}

/** 原子落盘：同目录临时文件 *.tmp-<pid>-<rand> 写入后 rename 覆盖。 */
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randTag()}`;
  fs.writeFileSync(tmp, data);
  const f = testFault();
  if (f && f.kind === 'throw-before-rename') {
    throw new Error(`测试故障注入：${path.basename(file)} rename 之前失败`);
  }
  if (f && f.kind === 'pause-before-rename') {
    trace({ op: 'fault-pause', tmp });
    for (;;) sleepMs(1000); // 等待测试 kill -9
  }
  fs.renameSync(tmp, file);
}

function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf-8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 损坏行跳过 */ }
  }
  return out;
}

function writeJsonl(file, items) {
  writeAtomic(file, items.map(i => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''));
}

function realpathSafe(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function lstatSafe(p) {
  try { return fs.lstatSync(p, { bigint: true }); } catch { return null; }
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/* ─────────────────────────── git 调用 ─────────────────────────── */

function runGit(root, args, opts = {}) {
  const ev = { op: 'git', args };
  if (args.includes('--stdin-paths') && typeof opts.input === 'string') ev.paths = opts.input.split('\n').filter(Boolean);
  trace(ev);
  const r = cp.spawnSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {
    input: opts.input, maxBuffer: 1024 * 1024 * 1024, env: opts.env || process.env, timeout: opts.timeout || 120000,
  });
  return {
    status: r.error ? null : r.status,
    stdout: r.stdout || Buffer.alloc(0),
    stderr: r.stderr ? r.stderr.toString('utf-8') : '',
  };
}

function gitText(root, args, opts) {
  const r = runGit(root, args, opts);
  return r.status === 0 ? r.stdout.toString('utf-8') : null;
}

function splitZ(buf) {
  return buf.toString('utf-8').split('\0').filter(Boolean);
}

/* ─────────────────────────── 项目根与 git 上下文 ─────────────────────────── */

function hasConfig(dir) {
  try { return fs.statSync(path.join(dir, CONFIG_REL)).isFile(); } catch { return false; }
}

/** 项目根：CLAUDE_PROJECT_DIR（在场但不是 OpenLogos 项目 → null）→ cwd 向上查找 → 引擎托管位置反推。 */
function findRoot() {
  const env = process.env.CLAUDE_PROJECT_DIR;
  if (env) return hasConfig(env) ? realpathSafe(env) : null;
  let d = process.cwd();
  for (;;) {
    if (hasConfig(d)) return realpathSafe(d);
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  const here = path.dirname(__filename);
  for (const c of [path.resolve(here, '..', '..', '..'), path.resolve(here, '..', '..')]) {
    if (hasConfig(c)) return realpathSafe(c);
  }
  return null;
}

/** 项目根相对路径（与 guard-check 的 node 归一化分支同口径：最深已存在祖先 realpath，越界为 ../ 前缀）。 */
function relOfRoot(root, p) {
  const abs = path.isAbsolute(p) ? p : path.join(root, p);
  let anc = abs;
  const tail = [];
  while (anc && !fs.existsSync(anc)) {
    const parsed = path.parse(anc);
    if (anc === parsed.root) break;
    tail.push(path.basename(anc));
    anc = path.dirname(anc);
  }
  let realAnc = anc;
  try { realAnc = fs.realpathSync(anc); } catch { /* 保持原样 */ }
  const realP = tail.length ? path.join(realAnc, ...tail.reverse()) : realAnc;
  let rel = path.relative(realpathSafe(root), realP);
  if (rel.startsWith('..')) {
    const rel2 = path.relative(root, abs);
    if (!rel2.startsWith('..')) rel = rel2;
  }
  if (path.isAbsolute(rel)) rel = `../${rel}`;
  rel = toPosix(rel);
  return rel === '' ? '.' : rel;
}

/** 位于项目根之内时返回相对路径，否则 null。 */
function insideRoot(root, abs) {
  const rel = toPosix(path.relative(realpathSafe(root), realpathSafe(abs)));
  if (rel === '' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return null;
  return rel;
}

/**
 * git 判据上下文：项目根在 git 工作树内且 git 可执行时返回 { root, gitDirsAbs, gitDirsRel, excludesRel, hooksPathRel }，
 * 否则 null（非 git：引擎不做任何事后检查）。
 */
function gitContext(root) {
  const out = gitText(root, ['rev-parse', '--is-inside-work-tree', '--absolute-git-dir', '--path-format=absolute',
    '--git-common-dir', '--path-format=absolute', '--show-toplevel']);
  if (out === null) return null;
  const lines = out.split('\n');
  if (lines[0] !== 'true') return null;
  const gitDir = lines[1];
  const commonDir = lines[2];
  const top = lines[3] || root;
  const gitDirsAbs = [];
  const gitDirsRel = [];
  for (const d of [gitDir, commonDir]) {
    if (!d || gitDirsAbs.includes(d)) continue;
    gitDirsAbs.push(d);
    const r = insideRoot(root, d);
    if (r !== null && !gitDirsRel.includes(r)) gitDirsRel.push(r);
  }
  const cfgPath = (key) => {
    const v = gitText(root, ['config', '--path', '--get', key]);
    if (v === null) return null;
    const t = v.replace(/\n$/, '');
    if (!t) return null;
    return path.isAbsolute(t) ? t : path.join(top, t);
  };
  const ex = cfgPath('core.excludesFile');
  const hp = cfgPath('core.hooksPath');
  return {
    root,
    gitDirsAbs,
    gitDirsRel,
    excludesRel: ex ? insideRoot(root, ex) : null,
    hooksPathRel: hp ? insideRoot(root, hp) : null,
  };
}

function guardFileExists(root) {
  try { return fs.statSync(path.join(root, GUARD_FILE_REL)).isFile(); } catch { return false; }
}

/* ─────────────────────────── guard.exempt ─────────────────────────── */

/** 条目合法返回 null；非法返回原因（与 guard-check exempt_entry_invalid_reason 同口径）。 */
function exemptInvalidReason(e) {
  if (e === '' || e === '/' || e === '*') return '空串、/ 或单独 *';
  if (e.includes('\\')) return '含反斜杠';
  if (e.startsWith('/') || /^[A-Za-z]:/.test(e)) return '绝对路径';
  const body = e.endsWith('/') ? e.slice(0, -1) : e;
  if (!body) return '空路径';
  if (`/${body}/`.includes('//')) return '含空段';
  const segs = body.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return '含 . / .. / 空段';
    if (s !== '*' && s.includes('*')) return '* 须独占一个路径段';
    if (s === '.gitignore') return '忽略规则来源（.gitignore）不可豁免';
  }
  if (body === '*') return '单独 *';
  if (segs[0] === '.git') return 'git 元数据（.git）不可豁免';
  if (body === RUNTIME_REL || body.startsWith(`${RUNTIME_REL}/`)) return `guard 自有状态（${RUNTIME_REL}/）不可豁免`;
  if (body === CONFIG_REL) return `${CONFIG_REL} 不可豁免`;
  return null;
}

/** 读取 guard.exempt：缺省 → 内置默认；显式数组按原样；损坏 → []（不回落内置默认）。 */
function loadExempt(root) {
  const warnings = [];
  let d;
  try {
    d = JSON.parse(fs.readFileSync(path.join(root, CONFIG_REL), 'utf-8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') return { entries: BUILTIN_EXEMPT.slice(), status: 'default', warnings };
    warnings.push(`${CONFIG_REL} 配置异常（无法解析），guard.exempt 视为 []`);
    return { entries: [], status: 'corrupt', warnings };
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { entries: [], status: 'corrupt', warnings };
  if (!Object.prototype.hasOwnProperty.call(d, 'guard')) return { entries: BUILTIN_EXEMPT.slice(), status: 'default', warnings };
  const g = d.guard;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return { entries: [], status: 'corrupt', warnings };
  if (!Object.prototype.hasOwnProperty.call(g, 'exempt')) return { entries: BUILTIN_EXEMPT.slice(), status: 'default', warnings };
  if (!Array.isArray(g.exempt)) return { entries: [], status: 'corrupt', warnings };
  const entries = [];
  for (const it of g.exempt) {
    if (typeof it !== 'string' || /[\n\r\t\0]/.test(it)) { warnings.push('guard.exempt 非法条目已跳过（不是字符串）'); continue; }
    const why = exemptInvalidReason(it);
    if (why) { warnings.push(`guard.exempt 非法条目已跳过：${it}（${why}）`); continue; }
    entries.push(it);
  }
  return { entries, status: 'explicit', warnings };
}

/** 完整段匹配；以 / 结尾匹配目录本身及后代；* 恰好匹配一个满足标识符约束的路径段。 */
function exemptMatches(e, rel) {
  const isDir = e.endsWith('/');
  const es = (isDir ? e.slice(0, -1) : e).split('/');
  const rs = rel.split('/');
  if (isDir ? rs.length < es.length : rs.length !== es.length) return false;
  for (let i = 0; i < es.length; i++) {
    if (es[i] === '*') {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rs[i]) || rs[i].includes('..')) return false;
    } else if (es[i] !== rs[i]) return false;
  }
  return true;
}

/* ─────────────────────────── 受保护判定（is_protected，JS 同口径实现） ─────────────────────────── */

function makeProtectCtx(gctx) {
  return { ...gctx, exempt: loadExempt(gctx.root).entries };
}

function hasSymlinkComponent(root, rel) {
  let walk = root;
  for (const seg of rel.split('/')) {
    walk = path.join(walk, seg);
    const st = lstatSafe(walk);
    if (!st) return false;
    if (st.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * 十步判定（spec「受保护判定」）。hint 由批量扫描给出已知的 git 状态（tracked / untracked / ignored），
 * 缺省时逐路径查询 git；查询失败按受保护处理。返回 { protected, step, reason }。
 */
function protectVerdict(pctx, rel, hint) {
  const P = (step, reason) => ({ protected: true, step, reason });
  const U = (step, reason) => ({ protected: false, step, reason });
  if (rel === '..' || rel.startsWith('../')) return U(1, '项目根之外');
  if (rel === RUNTIME_REL || rel.startsWith(`${RUNTIME_REL}/`)) return P(2, `guard 自有状态（${RUNTIME_REL}/）`);
  const base = rel.split('/').pop();
  if (base === '.gitignore') return P(3, '忽略规则来源（.gitignore）');
  if (rel === CONFIG_REL) return P(3, `保护范围来源（${CONFIG_REL}）`);
  for (const gd of pctx.gitDirsRel) if (rel === `${gd}/info/exclude`) return P(3, '忽略规则来源（info/exclude）');
  if (pctx.excludesRel && rel === pctx.excludesRel) return P(3, '忽略规则来源（core.excludesFile）');
  for (const gd of pctx.gitDirsRel) if (rel === gd || rel.startsWith(`${gd}/`)) return P(4, 'git 元数据');
  if (WHITELIST_PREFIXES.some(p => rel.startsWith(p))) return U(5, '白名单');
  const dotted = `/${rel}/`;
  if (!dotted.includes('//') && !dotted.includes('/./') && !dotted.includes('/../')
    && pctx.exempt.some(e => exemptMatches(e, rel)) && !hasSymlinkComponent(pctx.root, rel)) {
    return U(6, 'guard.exempt');
  }
  if (rel === RESOURCES_REL || rel.startsWith(`${RESOURCES_REL}/`)) return P(7, '规格目录（logos/resources/）');
  if (hint === 'tracked') return P(8, '已跟踪');
  if (hint !== 'untracked' && hint !== 'ignored') {
    const r = runGit(pctx.root, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', rel]);
    if (r.status === 0) return P(8, '已跟踪');
    if (r.status !== 1) return P(8, 'git 查询失败（ls-files），按受保护处理');
  }
  if (hint !== 'untracked' && !hasSymlinkComponent(pctx.root, rel)) {
    if (hint === 'ignored') return U(9, '被 git 忽略且未跟踪');
    const r = runGit(pctx.root, ['check-ignore', '-q', '--', rel]);
    if (r.status === 0) return U(9, '被 git 忽略且未跟踪');
    if (r.status !== 1) return P(9, 'git 查询失败（check-ignore），按受保护处理');
  }
  return P(10, '未被忽略的新文件');
}

/* ─────────────────────────── shell 命令解析（Bash 语法，引号感知） ─────────────────────────── */

/**
 * 解析为段序列：{ words: Word[], redirects: Redirect[], sep, nested }。
 * Word = { text, dynamic（含变量 / 命令替换）, glob（引号外通配或花括号）, tilde, quoted }。
 * violations 依出现顺序记录「独立调用」切段规则下的违规记号：| > < $( ` ( ) & << 换行。
 * 命令替换、子 shell 与反引号的内部命令解析为 nested 段（只用于提取写入目标）。
 */
function parseShell(src) {
  const segments = [];
  const violations = [];
  const heredocs = [];
  let pos = 0;

  const skipHeredocs = () => {
    while (heredocs.length) {
      const h = heredocs.shift();
      for (;;) {
        if (pos >= src.length) return;
        let end = src.indexOf('\n', pos);
        if (end < 0) end = src.length;
        let line = src.slice(pos, end);
        pos = end + 1;
        if (h.strip) line = line.replace(/^\t+/, '');
        if (line === h.delim) break;
      }
    }
  };

  const parseDollar = (w, list) => {
    const d = src[pos + 1];
    if (d === '(') {
      w.dynamic = true;
      violations.push('$(');
      if (src[pos + 2] === '(') {
        // 算术展开：按括号深度跳过
        let depth = 0;
        let i = pos + 1;
        for (; i < src.length; i++) {
          if (src[i] === '(') depth++;
          else if (src[i] === ')') { depth--; if (depth === 0) break; }
        }
        w.text += src.slice(pos, i + 1);
        pos = i + 1;
        return;
      }
      w.text += '$(…)';
      pos += 2;
      list(')', true);
      return;
    }
    if (d === '{') {
      let depth = 0;
      let i = pos + 1;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
      }
      w.dynamic = true;
      w.text += src.slice(pos, i + 1);
      pos = i + 1;
      return;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(pos + 1));
    if (m) { w.dynamic = true; w.text += `$${m[0]}`; pos += 1 + m[0].length; return; }
    if (d !== undefined && /[0-9@*#?$!-]/.test(d)) { w.dynamic = true; w.text += `$${d}`; pos += 2; return; }
    w.text += '$';
    pos += 1;
  };

  const parseDouble = (w, list) => {
    w.quoted = true;
    pos += 1;
    while (pos < src.length) {
      const c = src[pos];
      const d = src[pos + 1];
      if (c === '"') { pos += 1; return; }
      if (c === '\\' && d !== undefined && '$`"\\\n'.includes(d)) { if (d !== '\n') w.text += d; pos += 2; continue; }
      if (c === '$') { parseDollar(w, list); continue; }
      if (c === '`') { w.dynamic = true; violations.push('`'); pos += 1; list('`', true); continue; }
      w.text += c;
      pos += 1;
    }
  };

  const list = (term, nested) => {
    let seg = { words: [], redirects: [], sep: null, nested };
    let word = null;
    let pending = null;
    const ensure = () => {
      if (word === null) word = { text: '', dynamic: false, glob: false, tilde: false, quoted: false };
      return word;
    };
    const flush = () => {
      if (word === null) return;
      if (pending) {
        pending.target = word;
        if (pending.heredoc) heredocs.push({ delim: word.text, strip: pending.op === '<<-' });
        seg.redirects.push(pending);
        pending = null;
      } else seg.words.push(word);
      word = null;
    };
    const endSeg = (sep) => {
      flush();
      if (pending) { seg.redirects.push(pending); pending = null; }
      if (seg.words.length || seg.redirects.length) segments.push(seg);
      seg = { words: [], redirects: [], sep, nested };
    };
    while (pos < src.length) {
      const c = src[pos];
      const d = src[pos + 1];
      if (term === '`' && c === '`') { pos += 1; endSeg(null); return; }
      if (term === ')' && c === ')') { pos += 1; endSeg(null); return; }
      if (c === ' ' || c === '\t') { flush(); pos += 1; continue; }
      if (c === '\n') { violations.push('\n'); endSeg('\n'); pos += 1; skipHeredocs(); continue; }
      if (c === '#' && word === null) { while (pos < src.length && src[pos] !== '\n') pos += 1; continue; }
      if (c === '\\') {
        if (d === '\n') { pos += 2; continue; }
        const w = ensure();
        if (d !== undefined) w.text += d;
        pos += 2;
        continue;
      }
      if (c === "'") {
        const w = ensure();
        w.quoted = true;
        pos += 1;
        while (pos < src.length && src[pos] !== "'") { w.text += src[pos]; pos += 1; }
        pos += 1;
        continue;
      }
      if (c === '"') { parseDouble(ensure(), list); continue; }
      if (c === '$') { parseDollar(ensure(), list); continue; }
      if (c === '`') { ensure().dynamic = true; violations.push('`'); pos += 1; list('`', true); continue; }
      if (c === '&' && d === '&') { endSeg('&&'); pos += 2; continue; }
      if (c === '|' && d === '|') { endSeg('||'); pos += 2; continue; }
      if (c === ';') { endSeg(';'); pos += d === ';' ? 2 : 1; continue; }
      if (c === '|') { violations.push('|'); endSeg('|'); pos += d === '&' ? 2 : 1; continue; }
      if (c === '&' && d === '>') {
        flush();
        if (pending) { seg.redirects.push(pending); pending = null; }
        const op = src[pos + 2] === '>' ? '&>>' : '&>';
        violations.push('>');
        pending = { op, fd: null, target: null, out: true };
        pos += op.length;
        continue;
      }
      if (c === '&') { violations.push('&'); endSeg('&'); pos += 1; continue; }
      if (c === '>' || c === '<') {
        let fd = null;
        if (word !== null && /^\d+$/.test(word.text) && !word.quoted && !word.dynamic) { fd = word.text; word = null; } else flush();
        if (pending) { seg.redirects.push(pending); pending = null; }
        let op;
        if (c === '>') {
          op = d === '>' ? '>>' : d === '|' ? '>|' : d === '&' ? '>&' : '>';
          violations.push('>');
          pos += op.length;
          if (op === '>&') {
            let q = pos;
            while (src[q] === ' ' || src[q] === '\t') q += 1;
            const m = /^(\d+|-)(?=[\s;&|<>)`]|$)/.exec(src.slice(q));
            if (m) { pos = q + m[0].length; continue; }
          }
          pending = { op, fd, target: null, out: true };
        } else {
          if (d === '<' && src[pos + 2] === '<') { op = '<<<'; violations.push('<<'); }
          else if (d === '<' && src[pos + 2] === '-') { op = '<<-'; violations.push('<<'); }
          else if (d === '<') { op = '<<'; violations.push('<<'); }
          else if (d === '>') { op = '<>'; violations.push('<'); }
          else if (d === '&') { op = '<&'; violations.push('<'); }
          else { op = '<'; violations.push('<'); }
          pos += op.length;
          if (op === '<&') {
            let q = pos;
            while (src[q] === ' ' || src[q] === '\t') q += 1;
            const m = /^(\d+|-)(?=[\s;&|<>)`]|$)/.exec(src.slice(q));
            if (m) { pos = q + m[0].length; continue; }
          }
          pending = { op, fd, target: null, out: op === '<>', heredoc: op === '<<' || op === '<<-' };
        }
        continue;
      }
      if (c === '(') { violations.push('('); endSeg('('); pos += 1; list(')', true); continue; }
      if (c === ')') { violations.push(')'); endSeg(')'); pos += 1; continue; }
      const w = ensure();
      if (!w.quoted && w.text === '' && c === '~') w.tilde = true;
      if ('*?[{'.includes(c)) w.glob = true;
      w.text += c;
      pos += 1;
    }
    endSeg(null);
  };

  list(null, false);
  return { segments, violations };
}

function firstWordName(seg) {
  const w = seg.words[0];
  if (!w || w.dynamic) return null;
  return w.text;
}

/** 独立 git / openlogos 调用（spec「独立 git / openlogos 调用豁免」切段规则）：返回 { independent, violation }。 */
function independentCall(cmd) {
  const p = parseShell(cmd);
  if (p.violations.length) return { independent: false, violation: p.violations[0] };
  let core = false;
  for (const s of p.segments) {
    const name = firstWordName(s);
    if (s.redirects.length) return { independent: false, violation: '>' };
    if (name !== 'git' && name !== 'openlogos' && name !== 'cd') {
      return { independent: false, violation: s.words[0] ? s.words[0].text : '' };
    }
    if (name !== 'cd') core = true;
  }
  if (!core) return { independent: false, violation: null };
  return { independent: true, violation: null };
}

/** 复合调用中含 git / openlogos 段（反馈提示「拆成单独调用后重试」）。 */
function compoundGitOrOpenlogos(cmd) {
  if (!cmd) return false;
  if (independentCall(cmd).independent) return false;
  return parseShell(cmd).segments.some(s => {
    const n = firstWordName(s);
    return n === 'git' || n === 'openlogos';
  });
}

function engineWordAccepted(word, root, host) {
  const t = word.text;
  if (host === 'cursor') {
    if (word.dynamic) return false;
    return t === CURSOR_ENGINE_REL || t === `./${CURSOR_ENGINE_REL}` || t === path.join(root, CURSOR_ENGINE_REL)
      || t === path.join(realpathSafe(root), CURSOR_ENGINE_REL);
  }
  if (t === `$CLAUDE_PROJECT_DIR/${CLAUDE_ENGINE_REL}` || t === `\${CLAUDE_PROJECT_DIR}/${CLAUDE_ENGINE_REL}`) return true;
  if (word.dynamic) return false;
  const cands = [path.join(root, CLAUDE_ENGINE_REL), path.join(realpathSafe(root), CLAUDE_ENGINE_REL)];
  if (process.env.CLAUDE_PROJECT_DIR) cands.push(path.join(process.env.CLAUDE_PROJECT_DIR, CLAUDE_ENGINE_REL));
  return cands.includes(t);
}

/** 独立形态的引擎 restore 调用（R9a）：允许 cd 前缀段，restore 须为唯一非 cd 段且引擎路径为托管路径。 */
function restoreCall(cmd, root, host = 'claude') {
  const p = parseShell(cmd);
  if (p.violations.length) return null;
  const non = [];
  for (const s of p.segments) {
    if (s.redirects.length) return null;
    if (firstWordName(s) === 'cd') { if (s.words.length > 2) return null; continue; }
    non.push(s);
  }
  if (non.length !== 1) return null;
  const w = non[0].words;
  if (w.length !== 6) return null;
  if (w[0].dynamic || w[0].text !== 'node') return null;
  if (!engineWordAccepted(w[1], root, host)) return null;
  if (w[2].text !== 'restore' || w[4].text !== '--') return null;
  if ([w[2], w[3], w[4], w[5]].some(x => x.dynamic || x.glob)) return null;
  return { recordId: w[3].text, path: w[5].text };
}

// 只读快照优化名单：只读、不执行其他命令、不写文件（find / awk / sed / sort / tee 等可写，不在此列）
const READONLY_COMMANDS = new Set([
  'ls', 'cat', 'grep', 'egrep', 'fgrep', 'head', 'tail', 'wc', 'pwd', 'which', 'type', 'echo', 'printf', 'test', '[',
  'true', 'false', 'uname', 'sw_vers', 'whoami', 'id', 'printenv', 'env', 'realpath', 'readlink', 'basename', 'dirname',
  'diff', 'cmp', 'cut', 'tr', 'nl', 'stat', 'du', 'df', 'jq',
]);

/** 只读命令：单段、无重定向 / 管道 / 复合 / 命令替换 / 后台符，首词在只读名单（env 仅限无参数）。 */
function readOnlyCall(cmd) {
  const p = parseShell(cmd);
  if (p.violations.length || p.segments.length !== 1) return false;
  const s = p.segments[0];
  if (s.nested || s.redirects.length) return false;
  const name = firstWordName(s);
  if (!name || !READONLY_COMMANDS.has(name)) return false;
  if (name === 'env' && s.words.length !== 1) return false;
  return true;
}

const PATH_COMMANDS = new Set(['rm', 'cp', 'mv', 'mkdir', 'touch', 'chmod', 'chown']);

function determinable(w) {
  return !!w && !w.dynamic && !w.glob && !w.tilde && w.text !== '' && !w.text.includes('\n');
}

/**
 * 事前可确定的写入目标（spec「Bash / PowerShell 判定顺序」第 6 步）：重定向目标与
 * rm / cp / mv / mkdir / touch / chmod / chown 的路径实参；cd 段改变后续相对路径的基准，
 * 基准不可确定时后续相对目标视为不可确定。返回 [{ path（绝对）, op }]。
 */
function writeTargets(cmd, root) {
  const p = parseShell(cmd);
  const targets = [];
  let base = root;
  let nestedBase = root;
  let prevNested = false;
  const resolveT = (w, b) => {
    if (!determinable(w)) return null;
    if (path.isAbsolute(w.text)) return w.text;
    if (b === null) return null;
    return path.resolve(b, w.text);
  };
  for (const s of p.segments) {
    if (s.nested && !prevNested) nestedBase = base;
    prevNested = s.nested;
    const cur = s.nested ? nestedBase : base;
    let effective = cur;
    for (const r of s.redirects) {
      if (!r.out || !r.target) continue;
      const t = resolveT(r.target, cur);
      if (t) targets.push({ path: t, op: 'redirect' });
    }
    const words = s.words.slice();
    while (words.length && !words[0].dynamic && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].text)) words.shift();
    if (words.length && !words[0].dynamic && !words[0].glob) {
      const name = path.basename(words[0].text);
      if (name === 'cd' && words[0].text === 'cd') {
        const arg = words[1];
        if (!arg) effective = os.homedir();
        else if (!determinable(arg) || arg.text === '-') effective = null;
        else effective = path.isAbsolute(arg.text) ? arg.text : (cur === null ? null : path.resolve(cur, arg.text));
      } else if (PATH_COMMANDS.has(name)) {
        let afterDD = false;
        let skipFirst = name === 'chmod' || name === 'chown';
        let skipNext = false;
        let nextIsPath = false;
        for (const w of words.slice(1)) {
          if (skipNext) { skipNext = false; continue; }
          if (nextIsPath) { nextIsPath = false; const t = resolveT(w, cur); if (t) targets.push({ path: t, op: name }); continue; }
          if (!afterDD && !w.dynamic && w.text === '--') { afterDD = true; continue; }
          if (!afterDD && !w.dynamic && w.text.length > 1 && w.text.startsWith('-')) {
            if (name === 'mkdir' && (w.text === '-m' || w.text === '--mode')) skipNext = true;
            else if ((name === 'cp' || name === 'mv') && (w.text === '-t' || w.text === '--target-directory')) nextIsPath = true;
            else if ((name === 'cp' || name === 'mv') && (w.text === '-S' || w.text === '--suffix')) skipNext = true;
            continue;
          }
          if (skipFirst) { skipFirst = false; continue; }
          const t = resolveT(w, cur);
          if (t) targets.push({ path: t, op: name });
        }
      }
    }
    if (s.nested) nestedBase = effective; else base = effective;
  }
  return targets;
}

/** guard 自有状态目录命中：目标在运行时目录内，或 rm / mv / chmod / chown 作用于其祖先目录。 */
function runtimeHits(root, targets) {
  const hits = [];
  for (const t of targets) {
    const rel = relOfRoot(root, t.path);
    if (rel === RUNTIME_REL || rel.startsWith(`${RUNTIME_REL}/`)) { hits.push(t.path); continue; }
    if (['rm', 'mv', 'chmod', 'chown'].includes(t.op) && (rel === '.' || RUNTIME_REL.startsWith(`${rel}/`))) hits.push(t.path);
  }
  return hits;
}

/* ─────────────────────────── 原始字节摘要与基线缓存 ─────────────────────────── */

function statSig(st) {
  return { size: String(st.size), mtime_ns: String(st.mtimeNs), ino: String(st.ino), ctime_ns: String(st.ctimeNs) };
}

function typeOf(st) {
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'dir';
  if (st.isFile()) return 'file';
  return null;
}

/** 批量计算原始字节 blob oid（--no-filters）；write 时写入对象库。单个失败的路径不出现在结果中。 */
function hashFiles(root, rels, write) {
  const out = new Map();
  const ok = rels.filter(r => !r.includes('\n'));
  if (!ok.length) return out;
  const base = ['hash-object', ...(write ? ['-w'] : []), '--no-filters'];
  const r = runGit(root, [...base, '--stdin-paths'], { input: `${ok.join('\n')}\n` });
  if (r.status === 0) {
    const lines = r.stdout.toString('utf-8').split('\n').filter(Boolean);
    if (lines.length === ok.length) { ok.forEach((p, i) => out.set(p, lines[i].trim())); return out; }
  }
  for (const p of ok) {
    const r1 = runGit(root, [...base, '--', p]);
    if (r1.status === 0) out.set(p, r1.stdout.toString('utf-8').trim());
  }
  return out;
}

/** 符号链接以链接目标文本计算 blob（写入对象库，恢复时以临时链接 + rename 重建）。 */
function hashSymlink(root, rel, write = true) {
  let target;
  try { target = fs.readlinkSync(path.join(root, rel)); } catch { return null; }
  const r = runGit(root, ['hash-object', ...(write ? ['-w'] : []), '--stdin'], { input: target });
  return r.status === 0 ? r.stdout.toString('utf-8').trim() : null;
}

function cachePath(root) {
  return path.join(root, RUNTIME_REL, 'raw-baseline.json');
}

function loadCache(root) {
  try {
    const c = JSON.parse(fs.readFileSync(cachePath(root), 'utf-8'));
    if (c && c.version === 1 && c.tracked && c.extra) return c;
  } catch { /* 首次建立 */ }
  return { version: 1, tracked: {}, extra: {} };
}

function saveCache(root, cache) {
  writeAtomic(cachePath(root), JSON.stringify(cache));
}

/** stat 签名一致且 mtime 早于记录时刻（racy 规避）才复用缓存摘要。 */
function cacheHit(entry, sig, type, needWrite) {
  if (!entry || entry.type !== type) return false;
  if (entry.size !== sig.size || entry.mtime_ns !== sig.mtime_ns || entry.ino !== sig.ino || entry.ctime_ns !== sig.ctime_ns) return false;
  if (!(BigInt(entry.mtime_ns) < BigInt(entry.recorded_at_ns))) return false;
  if (needWrite && !entry.written) return false;
  return true;
}

/* ─────────────────────────── 快照扫描 ─────────────────────────── */

function walkFiles(root, absDir, out) {
  let names;
  try { names = fs.readdirSync(absDir); } catch { return; }
  for (const n of names) {
    const abs = path.join(absDir, n);
    const st = lstatSafe(abs);
    if (!st) continue;
    if (st.isDirectory()) walkFiles(root, abs, out);
    else if (st.isFile() || st.isSymbolicLink()) out.push(abs);
  }
}

/**
 * 候选路径与已知 git 状态：全部已跟踪文件（原始字节基线缓存覆盖全部已跟踪文件）、未跟踪未忽略文件、
 * logos/resources/ 下被忽略的文件、自身被忽略的 .gitignore、logos/logos.config.json、项目内 core.excludesFile、
 * git 元数据（git 目录与项目内 common dir 下的 config、info/**、hooks/**，项目内 core.hooksPath）。
 * 运行时目录一律排除。
 */
function collectCandidates(gctx) {
  const root = gctx.root;
  const cands = new Map();
  const add = (rel, hint, extra = {}) => {
    if (!rel || rel === RUNTIME_REL || rel.startsWith(`${RUNTIME_REL}/`)) return;
    if (!cands.has(rel)) cands.set(rel, { hint, ...extra });
  };
  const staged = runGit(root, ['ls-files', '-z', '-s']);
  if (staged.status !== 0) throw new Error(`git ls-files 失败：${staged.stderr}`);
  for (const line of splitZ(staged.stdout)) {
    const m = /^(\d+) ([0-9a-f]+) (\d)\t(.*)$/s.exec(line);
    if (!m || m[1] === '160000') continue;
    add(m[4], 'tracked', { indexOid: m[2], indexMode: m[1] });
  }
  const others = runGit(root, ['ls-files', '-z', '-o', '--exclude-standard']);
  if (others.status !== 0) throw new Error(`git ls-files -o 失败：${others.stderr}`);
  for (const p of splitZ(others.stdout)) if (!p.endsWith('/')) add(p, 'untracked');
  const ignoredTop = runGit(root, ['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory']);
  if (ignoredTop.status !== 0) throw new Error(`git ls-files -i 失败：${ignoredTop.stderr}`);
  let resourcesIgnored = false;
  for (const p of splitZ(ignoredTop.stdout)) {
    if (p.endsWith('/')) {
      if (`${RESOURCES_REL}/`.startsWith(p) || p.startsWith(`${RESOURCES_REL}/`)) resourcesIgnored = true;
      continue;
    }
    if (p.startsWith(`${RESOURCES_REL}/`)) resourcesIgnored = true;
    if (p.split('/').pop() === '.gitignore') add(p, 'ignored');
  }
  if (resourcesIgnored) {
    const res = runGit(root, ['ls-files', '-z', '-o', '-i', '--exclude-standard', '--', RESOURCES_REL]);
    if (res.status !== 0) throw new Error(`git ls-files 规格目录失败：${res.stderr}`);
    for (const p of splitZ(res.stdout)) if (!p.endsWith('/')) add(p, 'ignored');
  }
  add(CONFIG_REL, 'ignored');
  if (gctx.excludesRel) add(gctx.excludesRel, 'ignored');
  for (const d of gctx.gitDirsAbs) {
    const files = [path.join(d, 'config')];
    walkFiles(root, path.join(d, 'info'), files);
    walkFiles(root, path.join(d, 'hooks'), files);
    for (const f of files) {
      const rel = insideRoot(root, f);
      if (rel !== null) add(rel, 'meta');
    }
  }
  if (gctx.hooksPathRel && !gctx.gitDirsRel.some(g => gctx.hooksPathRel === g || gctx.hooksPathRel.startsWith(`${g}/`))) {
    const files = [];
    walkFiles(root, path.join(root, gctx.hooksPathRel), files);
    for (const f of files) {
      const rel = insideRoot(root, f);
      if (rel !== null) add(rel, 'hookspath');
    }
  }
  return cands;
}

function verdictFor(pctx, rel, cand) {
  if (cand.hint === 'hookspath') return { protected: true, step: 4, reason: 'git 元数据（core.hooksPath）' };
  const hint = cand.hint === 'meta' ? undefined : cand.hint;
  return protectVerdict(pctx, rel, hint);
}

/**
 * 扫描当前状态：返回 { states: Map<rel, State>（仅受保护路径）, cache }。
 * State = { exists, type, digest, raw_oid, recoverable, mode, tracked, size, mtime_ns, ino, ctime_ns }。
 * 已跟踪文件全部进入原始字节基线缓存（stat 签名增量），其余受保护候选按同一规则缓存。
 */
function scanProject(pctx, cacheIn) {
  const root = pctx.root;
  const cache = cacheIn || loadCache(root);
  const cands = collectCandidates(pctx);
  const recordedAt = nowNs();
  const next = { version: 1, tracked: {}, extra: {} };
  const states = new Map();
  const pend = { small: [], big: [], links: [] };
  const work = [];
  for (const [rel, cand] of cands) {
    const tracked = cand.hint === 'tracked';
    const v = verdictFor(pctx, rel, cand);
    if (!v.protected && !tracked) continue;
    const st = lstatSafe(path.join(root, rel));
    if (!st) continue;
    const type = typeOf(st);
    if (!type) continue;
    if (type === 'dir' && !tracked) continue;
    const sig = statSig(st);
    const mode = Number(st.mode & 0o7777n);
    const item = { rel, cand, tracked, protected: v.protected, type, sig, mode, oid: null, written: false };
    work.push(item);
    if (type === 'dir') continue;
    const bucket = tracked ? cache.tracked : cache.extra;
    const big = type === 'file' && st.size > BigInt(MAX_RETAIN_BYTES);
    const prev = bucket[rel];
    if (cacheHit(prev, sig, type, !big)) { item.oid = prev.raw_oid; item.written = prev.written; continue; }
    if (type === 'symlink') pend.links.push(item);
    else if (big) pend.big.push(item);
    else pend.small.push(item);
  }
  const small = hashFiles(root, pend.small.map(i => i.rel), true);
  for (const i of pend.small) { i.oid = small.get(i.rel) || null; i.written = !!i.oid; }
  const big = hashFiles(root, pend.big.map(i => i.rel), false);
  for (const i of pend.big) { i.oid = big.get(i.rel) || null; i.written = false; }
  for (const i of pend.links) { i.oid = hashSymlink(root, i.rel, true); i.written = !!i.oid; }
  let changed = pend.small.length + pend.big.length + pend.links.length > 0;
  for (const i of work) {
    if (i.type !== 'dir' && i.oid) {
      const bucket = i.tracked ? next.tracked : next.extra;
      const prev = (i.tracked ? cache.tracked : cache.extra)[i.rel];
      const reused = prev && prev.raw_oid === i.oid && cacheHit(prev, i.sig, i.type, false);
      bucket[i.rel] = {
        ...i.sig, type: i.type, mode: i.mode, raw_oid: i.oid, written: i.written,
        recorded_at_ns: reused ? prev.recorded_at_ns : String(recordedAt),
      };
    }
    if (!i.protected) continue;
    let digest;
    let recoverable;
    if (i.type === 'dir') { digest = 'dir'; recoverable = false; }
    else if (!i.oid) { digest = `unreadable:${i.sig.size}:${i.sig.mtime_ns}`; recoverable = false; }
    else {
      digest = i.oid;
      recoverable = i.written || (i.tracked && i.cand.indexOid === i.oid);
    }
    states.set(i.rel, {
      exists: true, type: i.type, digest, raw_oid: i.oid || null, recoverable, mode: i.mode, tracked: i.tracked, ...i.sig,
    });
  }
  if (!changed) {
    changed = Object.keys(next.tracked).length !== Object.keys(cache.tracked).length
      || Object.keys(next.extra).length !== Object.keys(cache.extra).length;
  }
  return { states, cache: next, cacheChanged: changed };
}

/** 单路径当前状态（不写对象库）：用于覆盖范围之外的路径与 restore 前置校验。 */
function statePath(root, rel) {
  const st = lstatSafe(path.join(root, rel));
  if (!st) return { exists: false };
  const type = typeOf(st);
  const sig = statSig(st);
  const mode = Number(st.mode & 0o7777n);
  if (type === 'dir') return { exists: true, type, digest: 'dir', raw_oid: null, recoverable: false, mode, ...sig };
  if (type === 'symlink') {
    const oid = hashSymlink(root, rel, false);
    return { exists: true, type, digest: oid || `unreadable:${sig.size}:${sig.mtime_ns}`, raw_oid: oid, recoverable: false, mode, ...sig };
  }
  if (type === 'file') {
    const oid = hashFiles(root, [rel], false).get(rel) || null;
    return { exists: true, type, digest: oid || `unreadable:${sig.size}:${sig.mtime_ns}`, raw_oid: oid, recoverable: false, mode, ...sig };
  }
  return { exists: true, type: 'other', digest: 'other', raw_oid: null, recoverable: false, mode, ...sig };
}

/** 记录条目只留判定与恢复所需字段（stat 签名由缓存承担）。 */
function entryOf(s) {
  return { exists: true, type: s.type, digest: s.digest, raw_oid: s.raw_oid, recoverable: s.recoverable, mode: s.mode, tracked: !!s.tracked };
}

/**
 * 变化判定（原始字节）：基线条目 vs 当前状态；新增 / 删除 / 类型变化 / 摘要变化。
 * 基线中有、当前覆盖范围中没有的路径（被忽略、被移出覆盖）按磁盘实况单独计算。
 */
function diffStates(root, baseEntries, states, memo) {
  const changes = [];
  const paths = new Set([...Object.keys(baseEntries), ...states.keys()]);
  for (const p of [...paths].sort()) {
    const b = baseEntries[p];
    let c = states.get(p);
    if (!c && b) {
      if (memo && memo.has(p)) c = memo.get(p);
      else { c = statePath(root, p); if (memo) memo.set(p, c); }
      if (!c.exists) c = null;
    }
    if (!b && !c) continue;
    if (b && !c) { changes.push({ path: p, change: 'deleted', before: b, after: { exists: false } }); continue; }
    if (!b && c) { changes.push({ path: p, change: 'added', before: { exists: false }, after: c }); continue; }
    if (b.type !== c.type) { changes.push({ path: p, change: 'type', before: b, after: c }); continue; }
    if (b.digest !== c.digest) changes.push({ path: p, change: 'modified', before: b, after: c });
  }
  return changes;
}

/* ─────────────────────────── 运行时状态：锁、记录、待报告与去重 ─────────────────────────── */

const rtPath = (root, ...p) => path.join(root, RUNTIME_REL, ...p);

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function lockWaitMs() {
  const v = process.env.OPENLOGOS_GUARD_TEST_LOCK_WAIT_MS;
  return v && /^\d+$/.test(v) ? Number(v) : LOCK_WAIT_MS;
}

/** 锁文件是否过期：持锁超过 30 秒且持有进程已不存在；内容无法解析时按文件 mtime 判定时长。 */
function lockStale(file) {
  try {
    const cur = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const at = Date.parse(cur.acquired_at);
    return Number.isFinite(at) && Date.now() - at > LOCK_STALE_MS && !pidAlive(cur.pid);
  } catch {
    try { return Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS; } catch { return false; }
  }
}

/** 项目级锁 state.lock（O_CREAT|O_EXCL；等锁最多 5 秒；持锁超过 30 秒且进程已不存在视为过期）。返回释放函数或 null。 */
function acquireLock(root, waitMs = lockWaitMs()) {
  const file = rtPath(root, 'state.lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString() }));
      fs.closeSync(fd);
      trace({ op: 'lock-acquired' });
      return () => {
        try {
          const cur = JSON.parse(fs.readFileSync(file, 'utf-8'));
          if (cur.pid === process.pid) fs.unlinkSync(file);
        } catch { /* 已被打破 */ }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    if (lockStale(file)) {
      // 打破过期锁：先改名再删除，避免两个进程同时判定过期后误删对方新建的锁
      const grave = `${file}.stale-${process.pid}-${randTag()}`;
      try {
        fs.renameSync(file, grave);
        if (lockStale(grave)) { trace({ op: 'lock-broken' }); fs.unlinkSync(grave); continue; }
        // 改名期间锁已被别人重新创建（改走的不是过期锁）：放回
        try { fs.linkSync(grave, file); } catch { /* 已有新锁 */ }
        fs.unlinkSync(grave);
      } catch { /* 并发打破，重试 */ }
      continue;
    }
    if (Date.now() >= deadline) return null;
    sleepMs(50);
  }
}

/**
 * 持锁后的整理（spec「共享状态的并发与中断」）：清理过期临时文件（持锁时其他进程的 *.tmp-* 必为残留）、
 * 把 pending-spill/ 合并进 pending-reports.jsonl 后删除；会话开始时同时清理墓碑。
 */
function housekeep(root, opts = {}) {
  for (const dir of [rtPath(root), rtPath(root, 'guard-records'), rtPath(root, SPILL_DIR)]) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const m = /\.(?:tmp|stale)-(\d+)-[A-Za-z0-9]+$/.exec(n);
      if (m && Number(m[1]) !== process.pid) {
        try { fs.unlinkSync(path.join(dir, n)); trace({ op: 'tmp-cleaned', name: n }); } catch { /* 已不存在 */ }
      }
      if (opts.sessionStart && dir.endsWith('guard-records') && n.endsWith('.closed')) {
        // 先删可能残留的同名记录文件（关闭中途被中断），再删墓碑，避免记录在清理墓碑后复活
        try { fs.unlinkSync(path.join(dir, `${n.slice(0, -7)}.json`)); } catch { /* 无残留 */ }
        try { fs.unlinkSync(path.join(dir, n)); trace({ op: 'tombstone-cleaned', name: n }); } catch { /* 已不存在 */ }
      }
    }
  }
  mergeSpills(root);
}

/** 溢出文件：pending-spill/<pid>-<时间戳>.json，以 O_EXCL 创建（拿不到锁时调用，不经锁）。 */
function writeSpill(root, items) {
  const dir = rtPath(root, SPILL_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const base = `${process.pid}-${nowNs()}`;
  for (let i = 0; ; i++) {
    const file = path.join(dir, `${base}${i ? `-${i}` : ''}.json`);
    try {
      const fd = fs.openSync(file, 'wx');
      try { fs.writeSync(fd, JSON.stringify(items)); } finally { fs.closeSync(fd); }
      return file;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

function readSpills(root) {
  const dir = rtPath(root, SPILL_DIR);
  let names;
  try { names = fs.readdirSync(dir).filter(n => /^\d+-\d+(?:-\d+)?\.json$/.test(n)).sort(); } catch { return []; }
  return names.map(n => {
    const file = path.join(dir, n);
    let items = null;
    try { const d = JSON.parse(fs.readFileSync(file, 'utf-8')); if (Array.isArray(d)) items = d; } catch { /* 写入中途被中断：对应记录仍未关闭，之后的检查会重新发现 */ }
    return { file, items: items || [] };
  });
}

/** 锁内合并溢出项：与去重表、现有待报告项比对后追加，合并后删除溢出文件。 */
function mergeSpills(root) {
  const spills = readSpills(root);
  if (!spills.length) return 0;
  const reported = loadReported(root);
  const pending = readJsonl(pendingFile(root));
  let added = 0;
  for (const sp of spills) {
    for (const it of sp.items) {
      if (!it || !it.path || isDuplicate(it, reported, pending)) continue;
      pending.push(it);
      added += 1;
    }
  }
  if (added) writeJsonl(pendingFile(root), pending);
  for (const sp of spills) { try { fs.unlinkSync(sp.file); } catch { /* 已删除 */ } }
  trace({ op: 'spill-merged', files: spills.length, added });
  return added;
}

function safeId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
}

function listRecordIds(root) {
  try {
    return fs.readdirSync(rtPath(root, 'guard-records'))
      .filter(n => n.endsWith('.json') && !n.includes('.tmp-'))
      .map(n => n.slice(0, -5));
  } catch { return []; }
}

function loadRecord(root, id) {
  try { return JSON.parse(fs.readFileSync(rtPath(root, 'guard-records', `${id}.json`), 'utf-8')); } catch { return null; }
}

const tombstonePath = (root, id) => rtPath(root, 'guard-records', `${id}.closed`);

function isClosed(root, id) {
  return fs.existsSync(tombstonePath(root, id));
}

let recordWrites = 0;

/**
 * 写执行记录（锁内调用）：已有墓碑 → 丢弃（已关闭的记录不复活）；代际不新于磁盘上的记录 → 丢弃（落后写入）。
 * 返回是否写入。
 */
function saveRecord(root, rec) {
  if (isClosed(root, rec.id)) { trace({ op: 'record-drop', id: rec.id, why: 'tombstone' }); return false; }
  const disk = loadRecord(root, rec.id);
  if (disk && !(Number(rec.generation || 0) > Number(disk.generation || 0))) {
    trace({ op: 'record-drop', id: rec.id, why: 'generation', have: disk.generation, got: rec.generation });
    return false;
  }
  writeAtomic(rtPath(root, 'guard-records', `${rec.id}.json`), JSON.stringify(rec));
  recordWrites += 1;
  const f = testFault();
  if (f && f.kind === 'kill-after-record-writes' && recordWrites >= Number(f.arg || 1)) process.kill(process.pid, 'SIGKILL');
  return true;
}

/** 代际 +1 后写入。 */
function updateRecord(root, rec) {
  rec.generation = Number(rec.generation || 1) + 1;
  return saveRecord(root, rec);
}

/** 关闭记录：先写墓碑再删除记录文件（中途中断时墓碑在场即视为已关闭）。 */
function closeRecord(root, id) {
  const tomb = tombstonePath(root, id);
  if (!fs.existsSync(tomb)) writeAtomic(tomb, JSON.stringify({ id, closed_at: new Date().toISOString() }));
  try { fs.unlinkSync(rtPath(root, 'guard-records', `${id}.json`)); } catch { /* 已不存在 */ }
  trace({ op: 'record-closed', id });
}

/** 未关闭记录（按建立先后）；墓碑在场的记录视为已关闭（tidy 时顺带删除残留记录文件，仅限锁内）。 */
function loadOpenRecords(root, tidy = true) {
  const out = [];
  for (const id of listRecordIds(root)) {
    if (isClosed(root, id)) {
      if (tidy) { try { fs.unlinkSync(rtPath(root, 'guard-records', `${id}.json`)); } catch { /* ignore */ } }
      continue;
    }
    const r = loadRecord(root, id);
    if (r && !r.closed) out.push(r);
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.seq || 0) - (b.seq || 0)));
}

const pendingFile = root => rtPath(root, 'pending-reports.jsonl');
const reportedFile = root => rtPath(root, 'reported.jsonl');

function fileNonEmpty(f) {
  try { return fs.statSync(f).size > 0; } catch { return false; }
}

/** 去重键：(path, raw_digest, 事件签名)；事件签名为 ino:ctime_ns，已删除时为 absent:<观测序号>。 */
function eventKey(after) {
  if (!after || !after.exists) return { raw_digest: 'absent', sig: null };
  return { raw_digest: after.digest, sig: `${after.ino}:${after.ctime_ns}` };
}

function isDuplicate(change, reported, pending) {
  const k = eventKey(change.after);
  const seen = [reported.get(change.path), ...pending.filter(i => i.path === change.path).map(i => ({ ...eventKey(i.after), path: i.path }))]
    .filter(Boolean);
  return seen.some(e => (k.raw_digest === 'absent' ? e.raw_digest === 'absent' : e.raw_digest === k.raw_digest && e.sig === k.sig));
}

function loadReported(root) {
  const m = new Map();
  for (const e of readJsonl(reportedFile(root))) if (e && e.path) m.set(e.path, e);
  return m;
}

function saveReported(root, m) {
  writeJsonl(reportedFile(root), [...m.values()]);
}

function dedupeEntry(f, reported) {
  const k = eventKey(f.after);
  let sig = k.sig;
  if (k.raw_digest === 'absent') {
    const prev = reported.get(f.path);
    const n = prev && prev.raw_digest === 'absent' && /^absent:(\d+)$/.test(prev.sig || '') ? Number(prev.sig.slice(7)) + 1 : 1;
    sig = `absent:${n}`;
  }
  return {
    path: f.path, raw_digest: k.raw_digest, sig, record_id: f.record_id, change: f.change,
    before: f.before, after: f.after, reported_at: new Date().toISOString(),
  };
}

/* ─────────────────────────── 反馈 ─────────────────────────── */

const CHANGE_LABEL = { added: '新增', deleted: '删除', type: '类型变化', modified: '内容变化' };

function shellQuote(s) {
  return /^[A-Za-z0-9._/@%+=:,-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

function restoreCommand(host, recordId, rel) {
  const eng = host === 'cursor' ? `node "${CURSOR_ENGINE_REL}"` : `node "$CLAUDE_PROJECT_DIR/${CLAUDE_ENGINE_REL}"`;
  return `${eng} restore ${recordId} -- ${shellQuote(rel)}`;
}

function restorable(f) {
  if (!f.before || !f.before.exists) return true;
  return !!f.before.recoverable && (f.before.type === 'file' || f.before.type === 'symlink');
}

function trunc(s, n = 200) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * 反馈文本：变化清单（逐项标明类型）、归因、恢复命令（不可恢复条目标明）、下一步、复合 git / openlogos 拆分提示。
 * 归因到本次调用 → 要求回滚或立案；无法唯一归因 → 需向用户确认，不要求回滚。
 */
function renderFeedback(findings, opts = {}) {
  const host = opts.host || 'claude';
  const lines = ['⛔ openlogos guard 事后检查：发现受保护内容被改动（项目处于 launched 生命周期且没有活跃的变更提案，修改受保护内容需要先立案）。'];
  const groups = [
    findings.filter(f => f.attribution && f.attribution.kind === 'self'),
    findings.filter(f => !f.attribution || f.attribution.kind !== 'self'),
  ];
  const listBlock = (items) => {
    lines.push('变化文件：');
    for (const f of items) lines.push(`  - ${f.path}（${CHANGE_LABEL[f.change] || f.change}）`);
    const rec = items.filter(restorable);
    const non = items.filter(f => !restorable(f));
    return { rec, non };
  };
  const nonBlock = (non) => {
    if (!non.length) return;
    lines.push('不可自动恢复（超过 5 MiB、无法读取或执行前为目录，只记录了摘要）：');
    for (const f of non) lines.push(`  - ${f.path}`);
  };
  const [self, other] = groups;
  if (self.length) {
    const cmd = self[0].attribution.command;
    lines.push('', `归因：本次调用（命令：${trunc(cmd)}）`);
    const { rec, non } = listBlock(self);
    if (rec.length) {
      lines.push('恢复命令（恢复为执行前的原始字节，请逐条执行）：');
      for (const f of rec) lines.push(`  ${restoreCommand(host, f.record_id, f.path)}`);
    }
    nonBlock(non);
    if (self.some(f => compoundGitOrOpenlogos(f.attribution.command))) {
      lines.push('提示：改动来自包含 git / openlogos 的复合调用——请把 git / openlogos 操作拆成单独调用后重试（独立的 git / openlogos 调用不报告）。');
    }
    lines.push('下一步：请回滚上述改动（执行上面的恢复命令），或先运行 `openlogos change <slug>` 立案后再修改。');
  }
  if (other.length) {
    lines.push('', '归因：无法唯一归因——可能来自未结束的后台调用或用户手动修改，需向用户确认，请勿自行回滚。');
    const cmds = [...new Set(other.flatMap(f => (f.attribution && f.attribution.commands) || []).filter(Boolean))];
    if (cmds.length) {
      lines.push('相关未关闭调用：');
      for (const c of cmds) lines.push(`  - ${trunc(c)}`);
    }
    const { rec, non } = listBlock(other);
    if (rec.length) {
      lines.push('如用户确认需要恢复，可执行以下恢复命令：');
      for (const f of rec) lines.push(`  ${restoreCommand(host, f.record_id, f.path)}`);
    }
    nonBlock(non);
    if (other.some(f => f.attribution && compoundGitOrOpenlogos(f.attribution.command))) {
      lines.push('提示：改动可能来自包含 git / openlogos 的复合调用——请把 git / openlogos 操作拆成单独调用后重试。');
    }
    lines.push('下一步：需向用户确认这些改动的来源，请勿自行回滚；如确需修改受保护内容，请先运行 `openlogos change <slug>` 立案。');
  }
  return lines.join('\n');
}

/** 同步写满 fd（macOS 上管道的 process.stdout/stderr 是异步写；非阻塞管道写满时 EAGAIN 重试）。 */
function writeAllSync(fd, str) {
  const buf = Buffer.from(str, 'utf-8');
  let off = 0;
  while (off < buf.length) {
    try {
      off += fs.writeSync(fd, buf, off, buf.length - off);
    } catch (e) {
      if (e.code !== 'EAGAIN') throw e;
      sleepMs(5);
    }
  }
}

/** 双通道反馈（stderr 可读文本 + stdout JSON），同步写出后才返回。 */
function emitBlock(text) {
  writeAllSync(2, `${text}\n`);
  writeAllSync(1, JSON.stringify({ reason: text }));
}

/* ─────────────────────────── 检查点核心 ─────────────────────────── */

/**
 * 与未关闭记录对比，产出去重后的新发现；同时清除已回到基线路径的去重条目。
 * 基线以最早的未关闭记录为准（新快照不吸收期间出现的变化）；此外任一较新记录的基线与当前不一致的路径同样计为变化
 * （多记录基线更新被中断时，部分记录仍是旧基线——只会多报、不会漏报）。同一路径取最早一个不一致的记录作为「执行前」。
 * cur 为本次调用自己的记录（仅 PostToolUse / PostToolUseFailure）。
 */
function findNew(ctx, normal, cur, states, reported, pending) {
  if (!normal.length) return [];
  const memo = new Map();
  const byPath = new Map();
  for (const rec of normal) {
    for (const ch of diffStates(ctx.root, rec.entries || {}, states, memo)) {
      if (!byPath.has(ch.path)) byPath.set(ch.path, { ...ch, base_id: rec.id });
    }
  }
  const changes = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // 去重条目清除：路径回到该报告的执行前状态（已恢复）即清除，同一内容再次出现时重新报告
  for (const [p, e] of [...reported]) {
    if (!e.before) continue;
    let now = states.get(p);
    if (!now) { now = memo.has(p) ? memo.get(p) : statePath(ctx.root, p); }
    if (sameState(now, e.before)) reported.delete(p);
  }
  const selfOnly = !!cur && normal.length === 1 && normal[0].id === cur.id;
  const others = normal.filter(r => !cur || r.id !== cur.id);
  const out = [];
  for (const ch of changes) {
    if (isDuplicate(ch, reported, pending)) continue;
    const { base_id: baseId, ...rest } = ch;
    out.push({
      ...rest,
      record_id: cur ? cur.id : baseId,
      attribution: selfOnly ? { kind: 'self', command: cur.command }
        : { kind: 'unattributed', commands: others.map(r => r.command), command: cur ? cur.command : null },
      found_at: new Date().toISOString(),
    });
  }
  return out;
}

/** 独立 git / openlogos 调用的基线局部更新：只把本次调用改动的路径在全部未关闭记录中更新为调用后内容。 */
function rebaseFrom(ctx, rb, normal, states, reported) {
  const changed = diffStates(ctx.root, rb.entries || {}, states);
  if (!changed.length) return [];
  applyRebase(ctx.root, normal, changed, reported);
  return changed.map(c => c.path);
}

/**
 * 把一组路径在多个记录中的基线更新为当前内容（逐记录落盘，代际 +1）。中途中断只会留下部分记录仍是旧基线，
 * 之后的检查对这些路径照常报告（多报不漏报）。清除这些路径的去重条目。
 */
function applyRebase(root, recs, changed, reported) {
  for (const n of recs) {
    n.entries = n.entries || {};
    for (const ch of changed) {
      if (ch.after.exists) n.entries[ch.path] = entryOf(ch.after);
      else delete n.entries[ch.path];
    }
    updateRecord(root, n);
  }
  for (const ch of changed) reported.delete(ch.path);
}

/* ─────────────────────────── 后台任务结束证据（BashOutput / TaskOutput / KillShell / TaskStop） ─────────────────────────── */

const BG_QUERY_TOOLS = new Set(['BashOutput', 'TaskOutput']);
const BG_KILL_TOOLS = new Set(['KillShell', 'TaskStop']);
const BG_ENDED = /^(completed|complete|succeeded|success|failed|failure|error|errored|killed|terminated|stopped|cancelled|canceled|exited|finished|done|timed_out)$/i;
const BG_RUNNING = /^(running|pending|in_progress|started|queued|not_ready)$/i;
const BG_ID_KEYS = ['backgroundTaskId', 'background_task_id', 'bash_id', 'bashId', 'shell_id', 'shellId', 'task_id', 'taskId'];

function parseMaybeJson(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return v;
  try { return JSON.parse(t); } catch { return v; }
}

/** 在对象树中按键收集字符串 / 数字值（深度受限，容错各版本字段位置）。 */
function collectByKeys(obj, keys, out = [], depth = 0) {
  obj = parseMaybeJson(obj);
  if (!obj || typeof obj !== 'object' || depth > 4) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k) && (typeof v === 'string' || typeof v === 'number') && String(v).trim()) out.push(String(v).trim());
    else if (v && typeof v === 'object') collectByKeys(v, keys, out, depth + 1);
  }
  return out;
}

/** 文本形态的 tool_response 中的任务标识（如 "Command running in background with ID: b1"）。 */
function idsFromText(v) {
  const out = [];
  const t = typeof v === 'string' ? v : (v && typeof v === 'object' ? JSON.stringify(v) : '');
  const re = /(?:background with ID|shell[_ ]id|task[_ ]id|bash[_ ]id)["']?\s*[:=]\s*["']?([A-Za-z0-9._-]+)/gi;
  let m;
  while ((m = re.exec(t))) out.push(m[1]);
  return out;
}

/** 后台调用的 PostToolUse 返回的后台任务标识（字段容错：tool_response 中各版本键名或文本）。 */
function backgroundTaskIdOf(input) {
  const ids = collectByKeys(input.tool_response, BG_ID_KEYS);
  if (ids.length) return ids[0];
  const t = idsFromText(input.tool_response);
  return t.length ? t[0] : null;
}

/** 任务状态：优先 task.status，其次顶层 status / state；文本形态取 <status>x</status> 或 status: x。 */
function taskStatusOf(resp) {
  resp = parseMaybeJson(resp);
  if (resp && typeof resp === 'object') {
    const task = parseMaybeJson(resp.task);
    for (const v of [task && task.status, task && task.state, resp.status, resp.state]) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    const deep = collectByKeys(resp, ['status', 'state']);
    if (deep.length) return deep[0];
    const exit = collectByKeys(resp, ['exitCode', 'exit_code']);
    if (exit.length && /^-?\d+$/.test(exit[0])) return Number(exit[0]) === 0 ? 'completed' : 'failed';
    return null;
  }
  if (typeof resp === 'string') {
    const m = /<status>\s*([A-Za-z_]+)\s*<\/status>/i.exec(resp) || /\bstatus["']?\s*[:=]\s*["']?([A-Za-z_]+)/i.exec(resp);
    return m ? m[1] : null;
  }
  return null;
}

/**
 * 后台任务结束确认（spec「执行记录生命周期」关闭条件 2）：返回 { ids, ended, status }。
 * 查询类工具：状态为完成 / 失败 / 被终止才算结束，运行中或无法识别不算；终止类工具：PostToolUse 且未显示失败即成功。
 */
function backgroundEndOf(tool, event, input) {
  const ids = [...new Set([...collectByKeys(input.tool_input, BG_ID_KEYS.concat(['id'])), ...collectByKeys(input.tool_response, BG_ID_KEYS), ...idsFromText(input.tool_response)])];
  if (event !== 'PostToolUse') return { ids, ended: false, status: 'failure-event' };
  if (BG_KILL_TOOLS.has(tool)) {
    const r = parseMaybeJson(input.tool_response);
    const failed = r && typeof r === 'object' && (r.success === false || r.is_error === true || !!r.error);
    return { ids, ended: !failed, status: failed ? 'kill-failed' : 'killed' };
  }
  const st = taskStatusOf(input.tool_response);
  if (!st || BG_RUNNING.test(st)) return { ids, ended: false, status: st || 'unknown' };
  return { ids, ended: BG_ENDED.test(st), status: st };
}

function readInput() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf-8'); } catch { return {}; }
  if (!raw.trim()) return {};
  try { const d = JSON.parse(raw); return d && typeof d === 'object' ? d : {}; } catch { return null; }
}

function hostOf(argv, input) {
  const i = argv.indexOf('--host');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (process.env.OPENLOGOS_GUARD_HOST) return process.env.OPENLOGOS_GUARD_HOST;
  if (input && /ShellExecution$/.test(String(input.hook_event_name || ''))) return 'cursor';
  return 'claude';
}

/* ─────────────────────────── 子命令 ─────────────────────────── */

function cmdSnapshot(argv, input) {
  if (input === null) return 1;
  const rebaseOnly = argv.includes('--rebase-only');
  const root = findRoot();
  if (!root) return 1;
  const gctx = gitContext(root);
  if (!gctx) return 1;
  if (rebaseOnly && !listRecordIds(root).length) return 0;
  const release = acquireLock(root);
  if (!release) return 1; // 拿不到锁：整体状态采集失败，guard-check 按非 git 回落判定
  try {
    housekeep(root);
    const recs = loadOpenRecords(root);
    const normal = recs.filter(r => !r.rebase_only);
    if (rebaseOnly && !normal.length) return 0;
    const pctx = makeProtectCtx(gctx);
    const scanned = scanProject(pctx);
    const { states, cache } = scanned;
    const proposal = guardFileExists(root);
    if (normal.length && !proposal) {
      const reported = loadReported(root);
      const pending = readJsonl(pendingFile(root));
      const found = findNew(pctx, normal, null, states, reported, pending);
      if (found.length) writeJsonl(pendingFile(root), [...pending, ...found]);
      saveReported(root, reported);
    }
    const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
    const ts = nowNs();
    const id = input.tool_use_id ? safeId(input.tool_use_id) : `anon-${ts}-${randTag()}`;
    const entries = {};
    for (const [p, s] of states) entries[p] = entryOf(s);
    const head = gitText(root, ['rev-parse', '-q', '--verify', 'HEAD']);
    const rec = {
      id,
      anonymous: !input.tool_use_id,
      host: hostOf(argv, input),
      session_id: input.session_id || null,
      command: typeof ti.command === 'string' ? ti.command : '',
      background: ti.run_in_background === true,
      background_task_id: null,
      created_at: new Date().toISOString(),
      seq: Number(process.hrtime.bigint() % 1000000000000000n),
      head: head ? head.trim() : '',
      index_tree: indexTree(root),
      entries,
      generation: 1,
      closed: false,
      rebase_only: rebaseOnly,
    };
    saveRecord(root, rec);
    if (scanned.cacheChanged || !fs.existsSync(cachePath(root))) saveCache(root, cache);
    process.stdout.write(`record=${id}\n`);
    return 0;
  } finally {
    release();
  }
}

/** 执行前索引对应的树对象：在索引副本上 write-tree，不触碰真实索引（不持有 index.lock）。 */
function indexTree(root) {
  const gd = gitText(root, ['rev-parse', '--git-path', 'index']);
  if (gd === null) return null;
  const idx = path.resolve(root, gd.trim());
  if (!fs.existsSync(idx)) return null;
  const tmp = path.join(os.tmpdir(), `openlogos-index-${process.pid}-${randTag()}`);
  try {
    fs.copyFileSync(idx, tmp);
    const out = gitText(root, ['write-tree'], { env: { ...process.env, GIT_INDEX_FILE: tmp } });
    return out ? out.trim() : null;
  } catch { return null; } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/** 检查点事件：{ event, post, tool }；不处理的输入返回 null。 */
function checkEvent(argv, input) {
  const event = argv.includes('--stop') ? 'Stop'
    : argv.includes('--session-start') ? 'SessionStart'
      : argv.includes('--pre-tool-use') ? 'PreToolUse'
        : (input.hook_event_name || 'PostToolUse');
  const post = event === 'PostToolUse' || event === 'PostToolUseFailure';
  const tool = post ? input.tool_name : null;
  if (post) {
    if (tool !== 'Bash' && tool !== 'PowerShell' && !BG_QUERY_TOOLS.has(tool) && !BG_KILL_TOOLS.has(tool)) return null;
  } else if (!['Stop', 'SessionStart', 'PreToolUse'].includes(event)) return null;
  return { event, post, tool, shell: tool === 'Bash' || tool === 'PowerShell' };
}

function dirNonEmpty(d) {
  try { return fs.readdirSync(d).length > 0; } catch { return false; }
}

function cmdCheck(argv, input) {
  if (input === null) return 0;
  const ev = checkEvent(argv, input);
  if (!ev) return 0;
  const root = findRoot();
  if (!root) return 0;
  const hasRecords = listRecordIds(root).length > 0;
  if (!ev.shell && ev.post && !hasRecords) return 0; // 后台查询 / 终止类工具只处理后台记录的关闭判定
  if (!hasRecords && !fileNonEmpty(pendingFile(root)) && !dirNonEmpty(rtPath(root, SPILL_DIR))
    && !(ev.event === 'SessionStart' && dirNonEmpty(rtPath(root, 'guard-records')))) return 0;
  const gctx = gitContext(root);
  if (!gctx) return 0;
  const host = hostOf(argv, input);
  const release = acquireLock(root);
  if (!release) {
    // 拿不到锁：PostToolUse / PostToolUseFailure / Stop（及补查）把新发现以 O_EXCL 写入 pending-spill/，下次持锁时合并送达
    if (ev.event !== 'SessionStart') {
      const n = spillCheck(gctx, ev, input);
      process.stderr.write(`openlogos guard：状态锁被占用，${n ? `${n} 项待报告变化已写入 ${RUNTIME_REL}/${SPILL_DIR}/，` : ''}将在之后的检查点送达（执行记录保持打开）。\n`);
    }
    return 0;
  }
  let result;
  try {
    result = checkLocked(gctx, ev, input, host);
  } finally {
    release();
  }
  if (result.emitted) return 2; // 反馈已在锁内、送达状态落盘之前写出
  if (result.text) { process.stdout.write(`${result.text}\n`); return 0; } // SessionStart 注入上下文
  return 0;
}

/** 不持锁的检查：只读状态、计算新发现并写入溢出文件；不关闭记录、不改基线与去重表、不写缓存。返回溢出项数。 */
function spillCheck(gctx, ev, input) {
  const root = gctx.root;
  const recs = loadOpenRecords(root, false);
  const normal = recs.filter(r => !r.rebase_only);
  if (!normal.length || guardFileExists(root)) return 0;
  const reported = loadReported(root);
  const pending = [...readJsonl(pendingFile(root)), ...readSpills(root).flatMap(sp => sp.items)];
  const curId = ev.shell && input.tool_use_id ? safeId(input.tool_use_id) : null;
  const cur = curId ? normal.find(r => r.id === curId) || null : null;
  const { states } = scanProject(makeProtectCtx(gctx));
  const found = findNew(gctx, normal, cur, states, reported, pending);
  if (found.length) writeSpill(root, found);
  return found.length;
}

/**
 * 持锁检查点（spec「执行记录生命周期」「送达渠道」）：
 * - Bash / PowerShell 的 PostToolUse / PostToolUseFailure：同标识非后台记录最终对比后关闭；后台记录回填 background_task_id、不关闭；
 *   无标识或标识已关闭（迟到）只做对比；rebase-only 记录按独立调用豁免局部更新基线后删除。
 * - BashOutput / TaskOutput / KillShell / TaskStop：后台任务确认结束时关闭对应后台记录，新发现写入待报告项。
 * - Stop：全部非后台记录最终对比后关闭；后台记录不受影响。
 * - SessionStart：清理墓碑，对比并把待报告项并入注入上下文（不移除，之后的 Bash 结束事件或 Stop 照常送达）；不关闭记录。
 * - PreToolUse 补查：新发现写入待报告项。
 * 有活跃提案时只维护记录（最终对比、关闭、去重），不报告新变化；已有待报告项照常送达。
 */
function checkLocked(gctx, ev, input, host) {
  const root = gctx.root;
  const { event } = ev;
  housekeep(root, { sessionStart: event === 'SessionStart' });
  const recs = loadOpenRecords(root);
  const proposal = guardFileExists(root);
  const reported = loadReported(root);
  let pending = readJsonl(pendingFile(root));
  let states = null;
  let cache = null;
  let cacheChanged = false;
  const scan = () => {
    if (!states) ({ states, cache, cacheChanged } = scanProject(makeProtectCtx(gctx)));
    return states;
  };

  const toClose = [];
  let cur = null;
  let rebaseRec = null;
  let backfill = null;
  if (ev.shell) {
    const curId = input.tool_use_id ? safeId(input.tool_use_id) : null;
    const r = curId ? recs.find(x => x.id === curId) : null;
    if (r && r.rebase_only) rebaseRec = r;
    else if (r) {
      cur = r;
      if (r.background) backfill = backgroundTaskIdOf(input);
      else toClose.push(r.id);
    }
  } else if (ev.post) {
    const end = backgroundEndOf(ev.tool, event, input);
    trace({ op: 'background-end', tool: ev.tool, ids: end.ids, ended: end.ended, status: end.status });
    if (end.ended) {
      for (const r of recs) if (r.background && r.background_task_id && end.ids.includes(String(r.background_task_id))) toClose.push(r.id);
    }
  } else if (event === 'Stop') {
    for (const r of recs) if (!r.background) toClose.push(r.id);
  }

  if (rebaseRec) {
    rebaseFrom(gctx, rebaseRec, recs.filter(r => !r.rebase_only), scan(), reported);
    closeRecord(root, rebaseRec.id);
  }
  const normal = recs.filter(r => !r.rebase_only);
  let found = normal.length ? findNew(gctx, normal, cur, scan(), reported, pending) : [];
  if (proposal) found = []; // 有活跃提案：只维护记录（最终对比、关闭、去重），不报告新变化
  if (cache && (cacheChanged || !fs.existsSync(cachePath(root)))) saveCache(root, cache);
  if (cur && backfill && cur.background_task_id !== backfill) {
    cur.background_task_id = backfill;
    updateRecord(root, cur);
  }

  let text = null;
  let emitted = false;
  if (event === 'PreToolUse' || event === 'SessionStart' || !ev.shell && ev.post) {
    if (found.length) { pending = [...pending, ...found]; writeJsonl(pendingFile(root), pending); }
    saveReported(root, reported);
    if (event === 'SessionStart' && pending.length) {
      text = [
        'OpenLogos guard：存在尚未送达的受保护内容变化（来自上一会话或会话之间仍在运行的后台调用）。',
        '这些变化会在下一次 Bash / PowerShell 调用结束或 Stop 时再次送达。',
        renderFeedback(pending, { host }),
      ].join('\n');
    }
  } else {
    const deliver = [...pending, ...found];
    if (deliver.length) {
      // 先把反馈完整同步写出，再更新去重表与送达状态：中断只会让同一事件下次再报一次，不会丢报告
      emitBlock(renderFeedback(deliver, { host }));
      emitted = true;
      const f = testFault();
      if (f && f.kind === 'kill-after-emit') process.kill(process.pid, 'SIGKILL');
      for (const it of deliver) reported.set(it.path, dedupeEntry(it, reported));
      writeJsonl(pendingFile(root), []);
    }
    saveReported(root, reported);
  }
  // 关闭放在送达状态落盘之后：中途中断时记录仍打开，之后的检查重新发现（多报不漏报）
  for (const id of toClose) closeRecord(root, id);
  return { text, emitted };
}

/** 提案边界（spec「提案边界」）：boundary-start 把未报告变化存为待报告项；boundary-end 把全部未关闭记录的基线整体更新为当前内容。 */
function cmdBoundary(name) {
  const out = (o) => { process.stdout.write(`${JSON.stringify({ subcommand: name, ...o })}\n`); };
  const root = findRoot();
  trace({ op: 'boundary', name, guard_exists: !!root && guardFileExists(root) });
  if (!root) { out({ status: 'skipped', reason: 'no-project' }); return 0; }
  if (!listRecordIds(root).length) { out({ status: 'ok', records: 0 }); return 0; }
  const gctx = gitContext(root);
  if (!gctx) { out({ status: 'skipped', reason: 'not-git' }); return 0; }
  const release = acquireLock(root);
  if (!release) {
    process.stderr.write(`openlogos guard ${name}：状态锁被占用，未能固定提案边界。\n`);
    out({ status: 'lock-timeout' });
    return 1;
  }
  try {
    housekeep(root);
    const normal = loadOpenRecords(root).filter(r => !r.rebase_only);
    if (!normal.length) { out({ status: 'ok', records: 0 }); return 0; }
    const { states, cache } = scanProject(makeProtectCtx(gctx));
    saveCache(root, cache);
    const reported = loadReported(root);
    const pending = readJsonl(pendingFile(root));
    if (name === 'boundary-start') {
      const found = findNew(gctx, normal, null, states, reported, pending);
      if (found.length) writeJsonl(pendingFile(root), [...pending, ...found]);
      saveReported(root, reported);
      out({ status: 'ok', records: normal.length, pending_added: found.map(f => f.path) });
      return 0;
    }
    // boundary-end：逐记录把基线整体替换为当前内容；基线变化的路径清除去重条目（待报告项保留，照常送达）
    const changedPaths = new Set();
    for (const r of normal) {
      for (const ch of diffStates(root, r.entries || {}, states)) changedPaths.add(ch.path);
    }
    for (const r of normal) {
      const entries = {};
      for (const [p, st] of states) entries[p] = entryOf(st);
      r.entries = entries;
      updateRecord(root, r);
    }
    for (const p of changedPaths) reported.delete(p);
    saveReported(root, reported);
    out({ status: 'ok', records: normal.length, rebased: [...changedPaths].sort() });
    return 0;
  } finally {
    release();
  }
}

function sameState(a, b) {
  if (!a.exists || !b.exists) return a.exists === b.exists;
  return a.type === b.type && a.digest === b.digest;
}

function blobBytes(root, oid) {
  const r = runGit(root, ['cat-file', 'blob', oid]);
  if (r.status !== 0) throw new Error(`对象库中找不到 ${oid}（可能已被 git 回收）`);
  return r.stdout;
}

/** 按目录项原子替换：同目录临时文件 .<name>.openlogos-restore-<pid>，写入后 rename，不沿符号链接写入。 */
function replaceEntry(abs, before, root) {
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(abs)}.openlogos-restore-${process.pid}`);
  try { fs.unlinkSync(tmp); } catch { /* 无残留 */ }
  if (before.type === 'symlink') {
    fs.symlinkSync(blobBytes(root, before.raw_oid).toString('utf-8'), tmp);
  } else {
    const data = blobBytes(root, before.raw_oid);
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeSync(fd, data);
      fs.fchmodSync(fd, before.mode & 0o7777);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  trace({ op: 'restore-rename', tmp: path.basename(tmp), dest: abs });
  fs.renameSync(tmp, abs);
}

function cmdRestore(argv) {
  const dd = argv.indexOf('--');
  const recordId = argv[0];
  const target = dd >= 0 ? argv[dd + 1] : undefined;
  if (!recordId || recordId === '--' || dd !== 1 || !target || argv.length !== 3) {
    process.stderr.write('用法：guard-post-check.cjs restore <record_id> -- <path>\n');
    return 64;
  }
  const root = findRoot();
  if (!root) { process.stderr.write('openlogos guard restore：找不到 OpenLogos 项目根。\n'); return 1; }
  const rel = relOfRoot(root, target);
  if (rel === '.' || rel === '..' || rel.startsWith('../')) { process.stderr.write(`openlogos guard restore：路径不在项目根之内：${target}\n`); return 1; }
  const release = acquireLock(root);
  if (!release) { process.stderr.write('openlogos guard restore：状态锁被占用，请稍后重试。\n'); return 1; }
  try {
    housekeep(root);
    const reported = loadReported(root);
    const entry = reported.get(rel);
    if (!entry || entry.record_id !== recordId) {
      process.stderr.write(`openlogos guard restore：没有找到记录 ${recordId} 对 ${rel} 的报告（可能已恢复或已被新的改动取代），未做任何修改。\n`);
      return 1;
    }
    const abs = path.join(root, rel);
    const now = statePath(root, rel);
    if (!sameState(now, entry.after)) {
      process.stderr.write(`openlogos guard restore：${rel} 的当前状态与报告记录的执行后状态不一致（报告之后又被修改过），拒绝恢复以免覆盖之后的修改。\n`);
      return 1;
    }
    const before = entry.before || { exists: false };
    if (!before.exists) {
      if (now.exists && now.type === 'dir') {
        process.stderr.write(`openlogos guard restore：${rel} 执行前不存在、当前是目录，拒绝自动恢复，请人工处理。\n`);
        return 1;
      }
      if (now.exists) fs.unlinkSync(abs);
    } else {
      if (before.type === 'dir' || !before.recoverable || !before.raw_oid) {
        process.stderr.write(`openlogos guard restore：${rel} 执行前的内容不可自动恢复（超过 5 MiB、无法读取或为目录），请人工处理。\n`);
        return 1;
      }
      if (now.exists && now.type === 'dir') {
        process.stderr.write(`openlogos guard restore：${rel} 当前是目录，拒绝自动恢复，请人工处理。\n`);
        return 1;
      }
      replaceEntry(abs, before, root);
    }
    // 恢复本身不产生新报告：被恢复路径在全部未关闭记录中的基线改回执行前状态，清除该路径的去重条目与待报告项
    for (const r of loadOpenRecords(root)) {
      if (!r.entries) continue;
      if (before.exists) r.entries[rel] = { ...before };
      else delete r.entries[rel];
      updateRecord(root, r);
    }
    reported.delete(rel);
    saveReported(root, reported);
    const pending = readJsonl(pendingFile(root));
    if (pending.some(i => i.path === rel)) writeJsonl(pendingFile(root), pending.filter(i => i.path !== rel));
    const cache = loadCache(root);
    if (before.exists && before.tracked && before.raw_oid) {
      const st = lstatSafe(abs);
      if (st) cache.tracked[rel] = { ...statSig(st), type: before.type, mode: before.mode, raw_oid: before.raw_oid, written: true, recorded_at_ns: String(nowNs()) };
      saveCache(root, cache);
    }
    process.stdout.write(`openlogos guard restore：已把 ${rel} 恢复为执行前状态（${before.exists ? '原始字节' : '删除新增的目录项'}）。\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`openlogos guard restore 失败：${e && e.message ? e.message : e}\n`);
    return 1;
  } finally {
    release();
  }
}

function cmdClassify(argv, input) {
  if (input === null) return 1;
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const cmd = typeof ti.command === 'string' ? ti.command.trim() : '';
  const host = hostOf(argv, input);
  const si = argv.indexOf('--shell');
  const shell = si >= 0 ? argv[si + 1] : 'bash';
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const lines = [];
  const ind = independentCall(cmd);
  let kind = 'other';
  if (ind.independent) kind = 'independent';
  else if (restoreCall(cmd, root, host)) kind = 'restore';
  else if (shell !== 'powershell' && readOnlyCall(cmd)) kind = 'readonly';
  lines.push(`kind=${kind}`);
  if (ind.violation) lines.push(`violation=${ind.violation.replace(/\n/g, '\\n')}`);
  if (shell !== 'powershell') {
    const targets = writeTargets(cmd, root);
    for (const t of targets) if (!t.path.includes('\n')) lines.push(`target=${t.path}`);
    for (const h of runtimeHits(root, targets)) if (!h.includes('\n')) lines.push(`runtime=${h}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

function main(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  switch (sub) {
    case 'snapshot': return cmdSnapshot(rest, readInput());
    case 'check': return cmdCheck(rest, readInput());
    case 'restore': return cmdRestore(rest);
    case 'boundary-start':
    case 'boundary-end': return cmdBoundary(sub);
    case 'classify': return cmdClassify(rest, readInput());
    default:
      process.stderr.write(`openlogos guard 事后检查引擎：未知子命令 ${sub === undefined ? '（空）' : sub}；可用：snapshot / check / restore / boundary-start / boundary-end\n`);
      return 64;
  }
}

module.exports = {
  RUNTIME_REL, WHITELIST_PREFIXES, BUILTIN_EXEMPT, MAX_RETAIN_BYTES,
  parseShell, independentCall, restoreCall, readOnlyCall, writeTargets, runtimeHits, compoundGitOrOpenlogos,
  loadExempt, exemptMatches, exemptInvalidReason, protectVerdict, makeProtectCtx, gitContext, relOfRoot,
  collectCandidates, scanProject, statePath, diffStates, entryOf, eventKey, isDuplicate, dedupeEntry,
  renderFeedback, restoreCommand, findNew, rebaseFrom, applyRebase, loadCache, main,
  acquireLock, lockStale, housekeep, writeAtomic, writeJsonl, readJsonl, writeSpill, readSpills, mergeSpills,
  saveRecord, updateRecord, closeRecord, loadRecord, loadOpenRecords, isClosed, loadReported,
  backgroundTaskIdOf, backgroundEndOf, taskStatusOf,
};

if (require.main === module) {
  let code;
  try {
    code = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`openlogos guard 事后检查引擎异常：${e && e.stack ? e.stack : e}\n`);
    code = 1;
  }
  process.exitCode = code;
}
