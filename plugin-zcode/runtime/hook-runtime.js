#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']);
const SAFE_BASH = /^(?:pwd|ls(?:\s|$)|cat\s|sed\s|rg\s|git\s+(?:status|log|diff|show|branch|rev-parse|ls-files)(?:\s|$)|openlogos\s+(?:status|next|flow)(?:\s|$))/;

class HookInputError extends Error {}

// >>> openlogos module-ownership v1（module-lifecycle-guard；spec/pretooluse-guard.md「按文件归属的模块生命周期判定」）
// 本段在事后检查引擎（plugin/bin/）与 Cursor、Qoder、WorkBuddy、ZCode 的 hook 运行时中逐字节相同（UT-S09-468 校验），
// 只依赖本文件顶部的 fs / path；plugin/bin/guard-check 以纯 bash 实现同一规则，共用测试向量
// plugin/test-vectors/guard-module-lifecycle.json。
const MLG_WHITELIST = [
  'logos/changes/', 'logos/.openlogos-guard', 'logos/logos-project.yaml', '.claude/', '.opencode/', '.codex-plugin/',
  '.cursor/', 'logos/skills/', 'logos/spec/', 'README', 'CLAUDE.md', 'AGENTS.md', 'opencode.json', '.openlogos',
];
const MLG_BUILTIN_EXEMPT = ['logos/resources/reference/', 'logos/resources/verify/baseline-seed-runs/*/staging/', 'logos/environments.yaml'];
const MLG_WALK_LIMIT = 5000;

function mlgTrim(s) {
  return s.replace(/^\s+/, '').replace(/\s+$/, '');
}

/**
 * YAML 子集标量：双引号（只支持 \" 与 \\ 两种转义）、单引号（不含 '' 转义）、无引号（` #` 起为注释）。
 * 返回 null 表示不可解析（code-r1 F1：锚点 / 别名 / 标签 / 块标量 / 其它转义等无法可靠解释的写法一律保守不解析）。
 * 无引号且按 YAML 1.2 core schema 解析为非字符串（数字、布尔、null）时返回 MLG_NON_STRING。
 */
const MLG_NON_STRING = Symbol('mlg-non-string');
const MLG_CORE_NON_STRING = /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
function mlgScalar(raw) {
  const t = mlgTrim(raw);
  if (t === '') return '';
  if (t[0] === '"' || t[0] === "'") {
    const q = t[0];
    let v = '';
    let j = 1;
    for (; j < t.length; j++) {
      const c = t[j];
      if (c === q) break;
      if (q === '"' && c === '\\') {
        const n = t[j + 1];
        if (n !== '"' && n !== '\\') return null;
        v += n;
        j += 1;
        continue;
      }
      v += c;
    }
    if (j >= t.length) return null;
    const rest = mlgTrim(t.slice(j + 1));
    if (rest !== '' && rest[0] !== '#') return null;
    return v;
  }
  if (t[0] === '#') return '';
  if ('|>*&!{}[]%@`,?:-'.includes(t[0]) && !(t[0] === '-' && /^-[^\s]/.test(t))) return null;
  const k = t.indexOf(' #');
  const v = mlgTrim(k >= 0 ? t.slice(0, k) : t);
  return MLG_CORE_NON_STRING.test(v) ? MLG_NON_STRING : v;
}

/** 流式序列 `[a, "b", 'c']`（不支持嵌套）。返回 null 表示不可解析。 */
function mlgFlow(raw) {
  const t = mlgTrim(raw);
  if (t[0] !== '[') return null;
  const pieces = [];
  let cur = '';
  let q = '';
  let end = -1;
  for (let i = 1; i < t.length; i++) {
    const c = t[i];
    if (q === '') {
      if (c === '"' || c === "'") q = c;
      else if (c === ',') { pieces.push(cur); cur = ''; continue; }
      else if (c === ']') { pieces.push(cur); end = i; break; }
    } else if (q === '"' && c === '\\') { cur += c + (t[i + 1] || ''); i += 1; continue; } else if (c === q) q = '';
    cur += c;
  }
  if (end < 0) return null;
  const rest = mlgTrim(t.slice(end + 1));
  if (rest !== '' && rest[0] !== '#') return null;
  const out = [];
  for (const p of pieces) {
    if (mlgTrim(p) === '') continue;
    const v = mlgScalar(p);
    if (v === null) return null;
    if (v !== MLG_NON_STRING) out.push(v);
  }
  return out;
}

/**
 * logos-project.yaml 子集解析：只取 modules[].id / lifecycle / paths 与 scenarios[].id / module。
 * 不可解析（含 modules 缺失或不是序列）返回 null——调用方不做按文件判定。
 */
function mlgParseProject(text) {
  const model = { modules: [], scenarios: [] };
  let section = null;
  let item = null;
  let dashIndent = -1;
  let inPaths = false;
  let skipIndent = -1;
  let sawModules = false;
  const applyKV = (body, indent) => {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/.exec(body);
    if (!m) return false;
    const key = m[1];
    const rawv = m[2];
    inPaths = false;
    if (section === 'modules' && key === 'paths') {
      const v = mlgTrim(rawv);
      if (v === '' || v[0] === '#') { item.paths = []; inPaths = true; return true; }
      if (v[0] === '[') {
        const list = mlgFlow(v);
        if (list === null) return false;
        item.paths = list;
        return true;
      }
      return false;
    }
    if ((section === 'modules' && (key === 'id' || key === 'lifecycle')) || (section === 'scenarios' && (key === 'id' || key === 'module'))) {
      const v = mlgScalar(rawv);
      if (v === null) return false;
      item[key] = v === MLG_NON_STRING ? '' : v;
      return true;
    }
    if (/^[|>]/.test(mlgTrim(rawv))) skipIndent = indent;
    return true;
  };
  for (const raw0 of String(text).split('\n')) {
    const raw = raw0.endsWith('\r') ? raw0.slice(0, -1) : raw0;
    if (/^\s*(#|$)/.test(raw)) continue;
    if (raw.includes('\t')) {
      if (section) return null;
      continue;
    }
    const top = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/.exec(raw);
    if (top) {
      section = top[1] === 'modules' ? 'modules' : top[1] === 'scenarios' ? 'scenarios' : null;
      item = null;
      dashIndent = -1;
      inPaths = false;
      skipIndent = -1;
      if (section === 'modules') sawModules = true;
      if (section) {
        const v = mlgTrim(top[2]);
        if (v !== '' && v[0] !== '#' && v !== '[]') return null;
      }
      continue;
    }
    if (!section) continue;
    const body = raw.replace(/^ +/, '');
    const indent = raw.length - body.length;
    if (skipIndent >= 0) {
      if (indent > skipIndent) continue;
      skipIndent = -1;
    }
    const dash = /^-(?:\s+(.*))?$/.exec(body);
    if (dash) {
      const rest = dash[1] === undefined ? '' : dash[1];
      if (inPaths && indent > dashIndent) {
        const v = mlgScalar(rest);
        if (v === null) return null;
        if (v !== MLG_NON_STRING) item.paths.push(v);
        continue;
      }
      if (dashIndent < 0 || indent === dashIndent) {
        dashIndent = indent;
        inPaths = false;
        item = section === 'modules' ? { id: '', lifecycle: '', paths: [] } : { id: '', module: '' };
        (section === 'modules' ? model.modules : model.scenarios).push(item);
        if (mlgTrim(rest) === '') continue;
        if (!applyKV(rest, indent)) return null;
        continue;
      }
      if (indent > dashIndent) continue;
      return null;
    }
    if (!item || indent <= dashIndent) return null;
    if (!applyKV(body, indent)) return null;
  }
  return sawModules ? model : null;
}

/** guard.exempt：缺省 → 内置默认；显式数组按原样（非字符串条目跳过）；损坏 → []。 */
function mlgLoadExempt(root) {
  let d;
  try {
    d = JSON.parse(fs.readFileSync(path.join(root, 'logos', 'logos.config.json'), 'utf-8'));
  } catch (e) {
    return e && e.code === 'ENOENT' ? MLG_BUILTIN_EXEMPT.slice() : [];
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return [];
  if (!Object.prototype.hasOwnProperty.call(d, 'guard')) return MLG_BUILTIN_EXEMPT.slice();
  const g = d.guard;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return [];
  if (!Object.prototype.hasOwnProperty.call(g, 'exempt')) return MLG_BUILTIN_EXEMPT.slice();
  if (!Array.isArray(g.exempt)) return [];
  return g.exempt.filter(e => typeof e === 'string' && e !== '');
}

/** exempt 条目完整段匹配：以 / 结尾匹配目录本身及后代；* 恰好匹配一个满足标识符约束的段。 */
function mlgExemptHit(e, rel) {
  if (`/${rel}/`.includes('//') || `/${rel}/`.includes('/./') || `/${rel}/`.includes('/../')) return false;
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

/** `paths` 条目合法性与 glob 语义均同 cli/src/lib/verify-scope.ts（isValidModulePath / globToRegExp）。 */
function mlgValidPath(entry) {
  if (typeof entry !== 'string' || mlgTrim(entry) === '') return false;
  if (entry.startsWith('/')) return false;
  return !entry.split('/').some(seg => seg === '..');
}

function mlgGlobRe(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const prevSlash = i === 0 || glob[i - 1] === '/';
        const nextSlash = glob[i + 2] === '/';
        if (prevSlash && nextSlash) { out += '(?:.*/)?'; i += 2; continue; }
        out += '.*'; i += 1; continue;
      }
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** 读取项目的归属上下文；yaml 缺失或不可解析返回 null（不做按文件判定）。 */
function mlgLoadModel(root) {
  let text;
  try { text = fs.readFileSync(path.join(root, 'logos', 'logos-project.yaml'), 'utf-8'); } catch { return null; }
  const model = mlgParseProject(text);
  if (!model) return null;
  return mlgContext(root, model, mlgLoadExempt(root));
}

function mlgContext(root, model, exempt) {
  const res = new Map();
  for (const m of model.modules) {
    if (!m.id || res.has(m.id)) continue;
    res.set(m.id, (m.paths || []).filter(mlgValidPath).map(mlgGlobRe));
  }
  return { root, model, exempt, res, hasInitial: model.modules.some(m => m.lifecycle === 'initial') };
}

/**
 * 归属判定（spec「归属判定」1～6 步）：返回 { verdict, step, modules }，
 * verdict ∈ initial | launched | unattributed | cross | not-applicable。
 */
function mlgOwnership(ctx, rel) {
  const NA = step => ({ verdict: 'not-applicable', step, modules: [] });
  if (!ctx || !ctx.model) return NA(0);
  if (typeof rel !== 'string' || rel === '' || rel === '.' || rel === '..' || rel.startsWith('../') || rel.startsWith('/')) return NA(0);
  const segs = rel.split('/');
  const base = segs[segs.length - 1];
  if (rel === 'logos/.openlogos-runtime' || rel.startsWith('logos/.openlogos-runtime/')) return NA(1);
  if (base === '.gitignore' || segs.includes('.git')) return NA(1);
  if (MLG_WHITELIST.some(p => rel.startsWith(p))) return NA(2);
  if (rel === 'logos/environments.yaml') return NA(2);
  if (rel === 'logos/resources/verify' || rel.startsWith('logos/resources/verify/')) return NA(2);
  if (ctx.exempt.some(e => mlgExemptHit(e, rel))) return NA(2);
  if (rel === 'logos/logos.config.json') return NA(3);
  const mods = ctx.model.modules;
  const ids = [];
  for (const m of mods) if (m.id && !ids.includes(m.id)) ids.push(m.id);
  let hit = null;
  let step = 0;
  if (rel.startsWith('logos/resources/')) {
    let best = '';
    for (const id of ids) if (base.startsWith(`${id}-`) && id.length > best.length) best = id;
    if (best) { hit = [best]; step = 4; }
  }
  if (!hit && rel.startsWith('logos/resources/api/')) {
    const m = /^(S[0-9]+)-.*\.ya?ml$/.exec(base);
    const sc = m ? ctx.model.scenarios.find(s => s.id === m[1]) : null;
    if (sc) {
      const mod = sc.module || 'core';
      if (ids.includes(mod)) { hit = [mod]; step = 5; }
    }
  }
  if (!hit) {
    hit = [];
    step = 6;
    for (const id of ids) if (ctx.res.get(id).some(re => re.test(rel))) hit.push(id);
  }
  if (hit.length === 0) return { verdict: 'unattributed', step, modules: [] };
  const lc = id => (mods.find(m => m.id === id) || {}).lifecycle;
  const initial = hit.filter(id => lc(id) === 'initial').length;
  const verdict = initial === hit.length ? 'initial' : initial === 0 ? 'launched' : 'cross';
  return { verdict, step, modules: hit };
}

/** 目录下现存文件（含符号链接，按路径判定）；超过上限或遍历出错返回 null。 */
function mlgWalk(root, rel) {
  const out = [];
  const walk = (r) => {
    for (const name of fs.readdirSync(path.join(root, r))) {
      const child = `${r}/${name}`;
      const st = fs.lstatSync(path.join(root, child));
      if (st.isDirectory()) walk(child);
      else out.push(child);
      if (out.length > MLG_WALK_LIMIT) throw new Error('limit');
    }
  };
  try { walk(rel); } catch { return null; }
  return out;
}

/**
 * 写入目标是否「仅归属 initial 模块」（initial_owned）。目录目标：目录本身与后代都不是不可豁免项，
 * 且枚举出的每个受保护后代都 initial_owned；opts.enumerate(rel) 给出候选（缺省为遍历现存文件），
 * opts.isProtected(rel) 给出受保护判定（缺省全部视为受保护），opts.nonExemptable(rel) 以完整上下文识别不可豁免项
 * （如 core.excludesFile，code-r1 F2）；枚举失败不豁免。符号链接分量一律不豁免。
 */
function mlgInitialOwned(ctx, rel, opts = {}) {
  if (!ctx || !ctx.hasInitial) return false;
  const own = mlgOwnership(ctx, rel);
  if (own.verdict === 'not-applicable' && own.step <= 1) return false;
  let walk = ctx.root;
  let st = null;
  for (const seg of rel.split('/')) {
    walk = path.join(walk, seg);
    try { st = fs.lstatSync(walk); } catch { st = null; break; }
    if (st.isSymbolicLink()) return false;
  }
  if (st && st.isDirectory()) {
    const list = opts.enumerate ? opts.enumerate(rel) : mlgWalk(ctx.root, rel);
    if (list === null) return false;
    if (list.length === 0) return own.verdict === 'initial';
    for (const f of list) {
      if (mlgOwnership(ctx, f).verdict === 'not-applicable' && mlgOwnership(ctx, f).step <= 1) return false;
      if (opts.nonExemptable && opts.nonExemptable(f)) return false;
      if (opts.isProtected && !opts.isProtected(f)) continue;
      if (mlgOwnership(ctx, f).verdict !== 'initial') return false;
    }
    return true;
  }
  return own.verdict === 'initial';
}
// <<< openlogos module-ownership v1

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function alias(record, camel, snake) {
  const hasCamel = Object.prototype.hasOwnProperty.call(record, camel);
  const hasSnake = Object.prototype.hasOwnProperty.call(record, snake);
  if (hasCamel && hasSnake && !sameValue(record[camel], record[snake])) {
    throw new HookInputError(`字段别名冲突：${camel}/${snake}`);
  }
  return hasCamel ? record[camel] : record[snake];
}

function normalizeHookEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HookInputError('Hook 输入必须是 JSON 对象');
  }
  const event = {
    sessionId: alias(input, 'sessionId', 'session_id'),
    hookEventName: alias(input, 'hookEventName', 'hook_event_name'),
    toolName: alias(input, 'toolName', 'tool_name'),
    toolInput: alias(input, 'toolInput', 'tool_input'),
    cwd: input.cwd,
  };
  if (event.toolInput !== undefined && (!event.toolInput || typeof event.toolInput !== 'object' || Array.isArray(event.toolInput))) {
    throw new HookInputError('toolInput/tool_input 必须是对象');
  }
  if (event.toolName !== undefined && typeof event.toolName !== 'string') {
    throw new HookInputError('toolName/tool_name 必须是字符串');
  }
  if (event.cwd !== undefined && typeof event.cwd !== 'string') {
    throw new HookInputError('cwd 必须是字符串');
  }
  return event;
}

function findProjectRoot(start) {
  let current = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(current, 'logos', 'logos.config.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isLaunched(root) {
  const projectFile = path.join(root, 'logos', 'logos-project.yaml');
  if (!fs.existsSync(projectFile)) return false;
  return /\blifecycle\s*:\s*[\"']?launched\b/.test(fs.readFileSync(projectFile, 'utf8'));
}

function codeTasks(content, section) {
  let active = false;
  const items = [];
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^## \[([a-z][a-z0-9-]*)\]/i.exec(line);
    if (heading) {
      active = heading[1].toLowerCase() === section;
      continue;
    }
    if (!active) continue;
    const item = /^- \[([ x])\]\s+(.+)$/i.exec(line);
    if (item) items.push({ checked: item[1].toLowerCase() === 'x', text: item[2] });
  }
  return items;
}

function deriveProposalStep(proposalDir) {
  if (fs.existsSync(path.join(proposalDir, 'SMOKE_PASS'))) return 'smoke-passed';
  if (fs.existsSync(path.join(proposalDir, 'DEPLOY_DONE'))) return 'ready-to-smoke';
  if (fs.existsSync(path.join(proposalDir, 'VERIFY_PASS'))) return 'ready-to-deploy';
  if (fs.existsSync(path.join(proposalDir, 'SPEC_MERGED'))) {
    const tasks = fs.readFileSync(path.join(proposalDir, 'tasks.md'), 'utf8');
    return codeTasks(tasks, 'code').every(item => item.checked) ? 'ready-to-verify' : 'coding';
  }
  const tasksFile = path.join(proposalDir, 'tasks.md');
  const tasks = fs.existsSync(tasksFile) ? fs.readFileSync(tasksFile, 'utf8') : '';
  const deltas = codeTasks(tasks, 'delta');
  if (fs.existsSync(path.join(proposalDir, 'PLAN_APPROVED'))) {
    return deltas.length > 0 && deltas.every(item => item.checked) ? 'ready-to-merge' : 'delta-writing';
  }
  return fs.existsSync(path.join(proposalDir, 'proposal.md')) && fs.existsSync(tasksFile)
    ? 'ready-to-delta'
    : 'writing';
}

function readSessionState(root) {
  const launched = isLaunched(root);
  const guardFile = path.join(root, 'logos', '.openlogos-guard');
  if (!fs.existsSync(guardFile)) {
    return { lifecycle: launched ? 'launched' : 'initial', slug: null, proposalStep: null, proposalDir: null };
  }
  const guard = readJson(guardFile);
  const slug = guard.activeChange;
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new HookInputError('guard.activeChange 非法');
  }
  const proposalDir = path.join(root, 'logos', 'changes', slug);
  return {
    lifecycle: launched ? 'launched' : 'initial',
    slug,
    proposalStep: deriveProposalStep(proposalDir),
    proposalDir,
  };
}

function sessionContext(root) {
  const state = readSessionState(root);
  const scope = state.slug
    ? `仅限活跃提案 ${state.slug} 与当前阶段允许的文件范围`
    : '无活跃提案，不允许修改源码';
  const nextGate = {
    writing: '完成提案后等待 plan-exit 确认',
    'ready-to-delta': '等待 plan-exit 确认',
    'delta-writing': '完成 delta 后等待 openlogos merge 人类确认',
    'ready-to-merge': '等待 openlogos merge 人类确认',
    coding: '完成代码与测试后等待 openlogos verify 人类确认',
    'ready-to-verify': '等待 openlogos verify 人类确认',
  }[state.proposalStep] || '创建变更提案后再修改源码';
  return [
    `OpenLogos lifecycle: ${state.lifecycle}`,
    `active change: ${state.slug || 'none'}`,
    `proposal_step: ${state.proposalStep || 'none'}`,
    `允许范围：${scope}`,
    '禁止动作：未经明确授权不得 merge、verify、deploy、smoke、archive 或 git push',
    `下一确认点：${nextGate}`,
  ].join('\n');
}

function resolveCandidate(root, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '' || rawPath.includes('\0')) {
    throw new HookInputError('写入目标路径缺失或非法');
  }
  const absolute = path.resolve(root, rawPath);
  let ancestor = absolute;
  const tail = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    tail.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);
  const resolved = path.join(realAncestor, ...tail);
  const realRoot = fs.realpathSync(root);
  const relative = path.relative(realRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new HookInputError('写入目标越出项目根目录');
  }
  return relative.split(path.sep).join('/');
}

function targetFromEvent(event) {
  const input = event.toolInput || {};
  if (event.toolName === 'Bash') {
    const command = input.command;
    if (typeof command !== 'string' || !SAFE_BASH.test(command.trim())) return null;
    return { safeBash: true };
  }
  const raw = input.filePath ?? input.file_path ?? input.path ?? input.notebook_path;
  return { path: raw };
}

function deny(reason) {
  return { decision: 'deny', reason };
}

function allow(reason = '当前 OpenLogos 阶段允许此操作') {
  return { decision: 'allow', reason };
}

/** 目标仅归属 initial 模块（module-lifecycle-guard）：路径不可解析时不判定，交由既有规则。 */
function initialOwnedTarget(root, rawPath) {
  let relative;
  try { relative = resolveCandidate(root, rawPath); } catch { return false; }
  return mlgInitialOwned(mlgLoadModel(root), relative);
}

// smoke-manual-acceptance（spec/pretooluse-guard.md「已知覆盖限制」第 5 条例外）：本宿主不能保证可靠的原生审批，
// 人工验收记录命令在任何提前放行（initial 生命周期、安全命令、initial 模块归属）之前一律拒绝。
const ACCEPT_COMMAND_RE = /(^|[^A-Za-z0-9_.-])openlogos(\.(c?js|cmd|exe|ps1))?["']?\s+(?:-[^\s]*\s+)*accept(\s|$|["'])/i;
function manualAcceptDenial(event) {
  const input = (event && event.toolInput) || {};
  const cmd = typeof input.command === 'string' ? input.command : (typeof input.cmd === 'string' ? input.cmd : '');
  if (!cmd || !ACCEPT_COMMAND_RE.test(cmd)) return null;
  return deny('人工验收结果只能由人记录：' + 'openlogos accept 不能经 AI 执行（本宿主无法保证原生审批）。请在终端执行，或在 RunLogos 界面逐条记录；不要由 AI 代记。');
}

function decideGuard(root, event) {
  const acceptDenial = manualAcceptDenial(event);
  if (acceptDenial) return acceptDenial;
  if (!WRITE_TOOLS.has(event.toolName)) return allow('非写入工具');
  if (!isLaunched(root)) return allow('initial 生命周期不启用变更硬门禁');
  const target = targetFromEvent(event);
  if (target && target.safeBash) return allow('只读命令');
  if (event.toolName === 'Bash') return deny('无法可靠证明 Bash 命令只读，按 fail-closed 阻断');
  if (initialOwnedTarget(root, target && target.path)) return allow('目标仅归属 initial 模块（按模块生命周期判定），无需变更提案');

  const state = readSessionState(root);
  if (!state.slug) return deny('launched 项目没有 guard；请先运行 openlogos change <slug>');
  const relative = resolveCandidate(root, target && target.path);
  const proposalPrefix = `logos/changes/${state.slug}/`;
  const taskPath = `${proposalPrefix}tasks.md`;
  const proposalPath = `${proposalPrefix}proposal.md`;
  const deltaPrefix = `${proposalPrefix}deltas/`;

  if (relative.startsWith('logos/changes/') && !relative.startsWith(proposalPrefix)) {
    return deny('目标属于其他提案，超出当前 guard 范围');
  }
  if (state.proposalStep === 'writing' || state.proposalStep === 'ready-to-delta') {
    return relative === proposalPath || relative === taskPath
      ? allow()
      : deny('plan 阶段仅允许当前提案 proposal.md 与 tasks.md');
  }
  if (state.proposalStep === 'delta-writing') {
    return relative === taskPath || relative.startsWith(deltaPrefix)
      ? allow()
      : deny('delta-writing 仅允许当前提案 deltas/** 与 tasks.md');
  }
  if (state.proposalStep === 'ready-to-merge') {
    return deny('delta 已完成；请等待 openlogos merge 人类确认，不得继续写入');
  }
  return allow();
}

function sessionOutput(context) {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  };
}

function guardOutput(result) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
    },
  };
  if (result.reason) output.hookSpecificOutput.permissionDecisionReason = result.reason;
  return output;
}

function protocolFailure(reason) {
  return guardOutput(deny(`OpenLogos Hook fail-closed：${reason}`));
}

function run(mode, raw, cwd) {
  const input = JSON.parse(raw);
  const event = normalizeHookEvent(input);
  const root = findProjectRoot(event.cwd || cwd);
  if (!root) throw new HookInputError('未找到 logos/logos.config.json');
  return mode === 'session'
    ? { output: sessionOutput(sessionContext(root)), exitCode: 0 }
    : (() => {
        const result = decideGuard(root, event);
        return { output: guardOutput(result), exitCode: result.decision === 'deny' ? 2 : 0 };
      })();
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'session' && mode !== 'guard') {
    process.stdout.write(JSON.stringify(protocolFailure('入口参数必须是 session 或 guard')) + '\n');
    process.exitCode = 2;
    return;
  }
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const result = run(mode, raw, process.cwd());
    process.stdout.write(JSON.stringify(result.output) + '\n');
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知运行时错误';
    process.stderr.write(`OpenLogos ZCode Hook: ${message}\n`);
    process.stdout.write(JSON.stringify(protocolFailure(message)) + '\n');
    process.exitCode = 2;
  }
}

module.exports = {
  mlgContext, mlgInitialOwned, mlgLoadModel, mlgOwnership, mlgParseProject,
  HookInputError,
  decideGuard,
  deriveProposalStep,
  findProjectRoot,
  guardOutput,
  normalizeHookEvent,
  readSessionState,
  resolveCandidate,
  run,
  sessionContext,
};

if (require.main === module) void main();
