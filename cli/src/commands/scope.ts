/**
 * `openlogos ignore` / `openlogos exempt`（guard-versioned-content-scope，S40；功能规格 §2.88.4 / §2.88.5，
 * CLI 交互设计「S40: 版本管理范围配置 — 交互规格」）。
 *
 * - ignore：维护 `guard.unversioned` 并渲染 `.gitignore` 托管区块（先写配置、后写区块；区块写失败回滚配置）；
 *   add 成功后按 gitignore 语义统计新增模式命中的已跟踪文件，按实际文件生成移出命令（不代为执行）。
 * - exempt：维护 `guard.exempt`（缺省时先物化内置默认；删光写显式 []）。
 * - 参数校验在写盘前对整批完成：任一非法，整批不写。
 * - CLI 本身不做审批；AI 发起时由 guard 交宿主原生审批（spec/pretooluse-guard.md「保护范围变更的宿主原生审批（C14）」）。
 *
 * 核心逻辑 `runScopeCommand` 不直接触碰 process：文件写入口与进程调用层均可注入，供测试设哨兵。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readLocale, type Locale } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import {
  atomicWriteFile, defaultManagedWriteIo, renderGitignoreWithManagedBlock, MANAGED_RUNTIME_ENTRY,
  type ManagedWriteIo,
} from '../lib/gitignore-managed-block.js';
import {
  BUILTIN_EXEMPT, GUARD_CONFIG_REL, exemptEntryInvalidReason, ignorePatternInvalidReason, isRuntimeIgnoreEntry,
  readGuardScopeConfig, serializeGuardConfig, type GuardConfigError, type InvalidReason,
} from '../lib/guard-scope-config.js';

export type ScopeKind = 'ignore' | 'exempt';

export interface ScopeExecResult { status: number | null; stdout: Buffer; stderr: Buffer; error?: Error }

export interface ScopeIo {
  exists: (p: string) => boolean;
  readFile: (p: string) => Buffer;
  write: ManagedWriteIo;
  mkdirp: (p: string) => void;
  /** 进程调用层（只用于 git 只读查询；CLI 从不执行 git rm） */
  exec: (cmd: string, args: string[], cwd: string) => ScopeExecResult;
  now: () => Date;
}

export const defaultScopeIo: ScopeIo = {
  exists: p => existsSync(p),
  readFile: p => readFileSync(p),
  write: defaultManagedWriteIo,
  mkdirp: p => { mkdirSync(p, { recursive: true }); },
  exec: (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, maxBuffer: 256 * 1024 * 1024 });
    return {
      status: r.status,
      stdout: r.stdout ?? Buffer.alloc(0),
      stderr: r.stderr ?? Buffer.alloc(0),
      ...(r.error ? { error: r.error } : {}),
    };
  },
  now: () => new Date(),
};

export interface ScopeResult { exitCode: number; stdout: string; stderr: string }

const EXAMPLES_SHOWN = 5;
const INLINE_FILE_LIMIT = 20;

/* ───────────────────────────── 文案（en / zh） ───────────────────────────── */

type Msg = Record<Locale, string>;
const M = {
  ignoreHeader: { en: 'Updating ignore list...', zh: '更新忽略清单...' },
  exemptHeader: { en: 'Updating exempt list...', zh: '更新免立案清单...' },
  added: { en: '  ✓ Added: {v}', zh: '  ✓ 已添加：{v}' },
  removed: { en: '  ✓ Removed: {v}', zh: '  ✓ 已移除：{v}' },
  present: { en: '  · Already present: {v}', zh: '  · 已存在：{v}' },
  notFound: { en: '  · Not found: {v}', zh: '  · 不存在：{v}' },
  runtimeFixed: {
    en: `  · ${MANAGED_RUNTIME_ENTRY} is always ignored by the managed block`,
    zh: `  · ${MANAGED_RUNTIME_ENTRY} 已固定在托管区块中`,
  },
  configWritten: { en: '  ✓ logos/logos.config.json updated', zh: '  ✓ 已更新 logos/logos.config.json' },
  blockWritten: { en: '  ✓ .gitignore managed block updated', zh: '  ✓ 已更新 .gitignore 托管区块' },
  blockCreated: { en: '  ✓ .gitignore created with openlogos managed block', zh: '  ✓ 已新建 .gitignore（含 openlogos 托管区块）' },
  noChanges: { en: 'No changes; no files were written.', zh: '无变化，未写入任何文件。' },
  notGit: {
    en: "ℹ Not inside a git repository; guard's version-control criterion is not in effect.",
    zh: 'ℹ 当前目录不在 git 仓库中，guard 新判据不生效。',
  },
  materialized: {
    en: '  · Built-in defaults written to guard.exempt so they can be edited',
    zh: '  · 已将内置默认项写入 guard.exempt，便于修改',
  },
  exemptEmptied: {
    en: '  ℹ guard.exempt is now empty; built-in defaults no longer apply',
    zh: '  ℹ guard.exempt 已清空，内置默认项不再生效',
  },
  exemptEffect: {
    en: 'ℹ Writes under these paths no longer require a change proposal; they are still committed to git.',
    zh: 'ℹ 这些路径下的写入不再需要立案，仍会正常入库。',
  },
  trackedHead: {
    en: '⚠ {n} tracked file(s) match "{p}". They stay in version control and remain protected by guard:',
    zh: '⚠ 有 {n} 个已跟踪文件命中 "{p}"，它们仍在版本控制中，继续受 guard 保护：',
  },
  trackedMore: { en: '    ... and {n} more', zh: '    …… 另有 {n} 个' },
  trackedList: { en: '  The full list was written to {f}.', zh: '  完整清单已写入 {f}。' },
  trackedRun: {
    en: '  To stop tracking them, run this yourself (openlogos does not run it):',
    zh: '  如需移出版本控制，请自行执行（openlogos 不会代为执行）：',
  },
  trackedFail: { en: '⚠ Could not check tracked files for "{p}": {e}', zh: '⚠ 无法统计 "{p}" 命中的已跟踪文件：{e}' },
  ignoreListHead: { en: 'Ignored by openlogos (guard.unversioned):', zh: 'openlogos 忽略清单（guard.unversioned）：' },
  exemptListHead: { en: 'Exempt from change proposals (guard.exempt):', zh: '免立案清单（guard.exempt）：' },
  none: { en: '  (none)', zh: '  （无）' },
  defaultTag: { en: '(default)', zh: '（内置默认）' },
  errNotInit: { en: 'Error: logos/logos.config.json not found.', zh: 'Error: logos/logos.config.json not found.' },
  errNotInitHint: { en: "Run 'openlogos init' first to initialize the project.", zh: "Run 'openlogos init' first to initialize the project." },
  errConfigInvalid: { en: 'Error: logos/logos.config.json is not valid JSON: {d}', zh: 'Error: logos/logos.config.json 不是合法 JSON：{d}' },
  errEntryInvalid: {
    en: 'Error: guard.{f} contains an invalid entry "{v}": {r}. Fix it manually; no files were changed.',
    zh: 'Error: guard.{f} 中有非法条目 "{v}"：{r}。请手工修正，未改动任何文件。',
  },
  errMissingIgnore: { en: 'Error: Missing pattern.', zh: 'Error: 缺少参数。' },
  errMissingExempt: { en: 'Error: Missing path.', zh: 'Error: 缺少参数。' },
  errUnknownAction: { en: "Error: Unknown action '{a}'.", zh: "Error: 未知动作 '{a}'。" },
  errBadPattern: { en: 'Error: Invalid ignore pattern "{v}": {r}.', zh: 'Error: 忽略模式 "{v}" 非法：{r}。' },
  errBadPath: { en: 'Error: Invalid exempt path "{v}": {r}.', zh: 'Error: 免立案路径 "{v}" 非法：{r}。' },
  errRuntimeRemove: {
    en: `Error: ${MANAGED_RUNTIME_ENTRY} is a fixed entry of the managed block and cannot be removed.`,
    zh: `Error: ${MANAGED_RUNTIME_ENTRY} 是托管区块的固定条目，不能移除。`,
  },
  errBlockCorrupt: {
    en: 'Error: The openlogos managed block in .gitignore is corrupted ({d}). Fix it manually; no files were changed.',
    zh: 'Error: .gitignore 中的 openlogos 托管区块已损坏（{d}），请手工修复，未改动任何文件。',
  },
  errWrite: { en: 'Error: Failed to write {p}: {d}. Changes were rolled back.', zh: 'Error: 写入 {p} 失败：{d}，已回滚。' },
} satisfies Record<string, Msg>;

function fmt(locale: Locale, m: Msg, vars: Record<string, string | number> = {}): string {
  let s = m[locale];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** POSIX 单引号转义：`'` 写作 `'\''`。 */
export function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/** `20261007T080000Z` 形态的 UTC 时间戳。 */
export function compactTimestamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/* ───────────────────────────── 核心 ───────────────────────────── */

class Out {
  stdout: string[] = [];
  stderr: string[] = [];
  out(line: string): void { this.stdout.push(line); }
  err(line: string): void { this.stderr.push(line); }
  result(exitCode: number): ScopeResult {
    return {
      exitCode,
      stdout: this.stdout.length ? `${this.stdout.join('\n')}\n` : '',
      stderr: this.stderr.length ? `${this.stderr.join('\n')}\n` : '',
    };
  }
}

/** 剥离 `--format <v>` 与 `--format=<v>`，返回其余参数与是否 json。 */
function splitArgs(argv: string[]): { rest: string[]; json: boolean } {
  const rest: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--format') { json = argv[i + 1] === 'json'; i++; continue; }
    if (argv[i].startsWith('--format=')) { json = argv[i].slice('--format='.length) === 'json'; continue; }
    rest.push(argv[i]);
  }
  return { rest, json };
}

function configError(o: Out, locale: Locale, kind: ScopeKind, err: GuardConfigError, json: boolean, listCmd: boolean): ScopeResult {
  const command = `${kind} list`;
  let text: string[];
  let message: string;
  switch (err.code) {
    case 'PROJECT_NOT_INITIALIZED':
      text = [fmt(locale, M.errNotInit), fmt(locale, M.errNotInitHint)];
      message = 'logos/logos.config.json not found.';
      break;
    case 'CONFIG_INVALID':
      text = [fmt(locale, M.errConfigInvalid, { d: err.detail })];
      message = `logos/logos.config.json is not valid JSON: ${err.detail}`;
      break;
    case 'GUARD_ENTRY_INVALID':
      text = [fmt(locale, M.errEntryInvalid, { f: err.field, v: err.value, r: err.reason[locale] })];
      message = `guard.${err.field} contains an invalid entry "${err.value}": ${err.reason.en}.`;
      break;
  }
  if (json && listCmd) o.err(JSON.stringify(makeErrorEnvelope(command, err.code, message)));
  else for (const l of text) o.err(l);
  return o.result(1);
}

/** 统计并输出新增模式命中的已跟踪文件提示（只读 git 查询；不代为执行任何 git 写命令）。init / adopt 接受建议后复用。 */
export function trackedHints(o: { out(line: string): void }, locale: Locale, root: string, io: ScopeIo, patterns: string[]): void {
  for (const pattern of patterns) {
    const r = io.exec('git', ['ls-files', '-z', '-ci', `--exclude=${pattern}`], root);
    if (r.error || r.status !== 0) {
      const detail = (r.error?.message ?? r.stderr.toString('utf-8').trim().split('\n')[0]) || `exit ${String(r.status)}`;
      o.out(fmt(locale, M.trackedFail, { p: pattern, e: detail }));
      continue;
    }
    const raw = r.stdout;
    const files = raw.toString('utf-8').split('\0').filter(f => f.length > 0);
    if (files.length === 0) continue;
    o.out(fmt(locale, M.trackedHead, { n: files.length, p: pattern }));
    for (const f of files.slice(0, EXAMPLES_SHOWN)) o.out(`    ${f}`);
    if (files.length > EXAMPLES_SHOWN) o.out(fmt(locale, M.trackedMore, { n: files.length - EXAMPLES_SHOWN }));
    if (files.length <= INLINE_FILE_LIMIT) {
      o.out(fmt(locale, M.trackedRun));
      o.out(`    git --literal-pathspecs rm --cached -- ${files.map(shellQuote).join(' ')}`);
      continue;
    }
    // 超过 20 个：NUL 清单与 `git ls-files -z` 输出逐字节一致
    const runtimeDir = join(root, 'logos', '.openlogos-runtime');
    const stamp = compactTimestamp(io.now());
    let rel = '';
    try {
      io.mkdirp(runtimeDir);
      for (let n = 1; ; n++) {
        const name = n === 1 ? `untrack-${stamp}.lst` : `untrack-${stamp}-${n}.lst`;
        if (!io.exists(join(runtimeDir, name))) { rel = `logos/.openlogos-runtime/${name}`; break; }
      }
      atomicWriteFile(join(root, rel), raw, io.write);
    } catch (e) {
      o.out(fmt(locale, M.trackedFail, { p: pattern, e: (e as Error).message }));
      continue;
    }
    o.out(fmt(locale, M.trackedList, { f: rel }));
    o.out(fmt(locale, M.trackedRun));
    o.out(`    git --literal-pathspecs rm --cached --pathspec-file-nul --pathspec-from-file=${rel}`);
  }
}

function insideGitRepo(root: string, io: ScopeIo): boolean {
  const r = io.exec('git', ['rev-parse', '--is-inside-work-tree'], root);
  return !r.error && r.status === 0 && r.stdout.toString('utf-8').trim() === 'true';
}

export function runScopeCommand(kind: ScopeKind, argv: string[], root: string, ioOverride: Partial<ScopeIo> = {}): ScopeResult {
  const io: ScopeIo = { ...defaultScopeIo, ...ioOverride };
  const o = new Out();
  const configPath = join(root, GUARD_CONFIG_REL);
  const locale: Locale = readLocale(root);
  const { rest, json } = splitArgs(argv);
  const action = rest[0];
  const values = rest.slice(1);
  const usageAction = kind === 'ignore' ? 'openlogos ignore <add|remove|list>' : 'openlogos exempt <add|remove|list>';

  if (action !== 'add' && action !== 'remove' && action !== 'list') {
    o.err(fmt(locale, M.errUnknownAction, { a: action ?? '' }));
    o.err(`Usage: ${usageAction}`);
    return o.result(1);
  }

  const loaded = readGuardScopeConfig(configPath, io.exists(configPath));
  if (!loaded.ok) return configError(o, locale, kind, loaded.error, json, action === 'list');
  const cfg = loaded.value;

  /* ── list：只读，不调用 git ── */
  if (action === 'list') {
    const entries = kind === 'ignore'
      ? cfg.unversioned.map(value => ({ value, source: 'config' as const }))
      : (cfg.exempt === null
        ? BUILTIN_EXEMPT.map(value => ({ value, source: 'default' as const }))
        : cfg.exempt.map(value => ({ value, source: 'config' as const })));
    if (json) {
      o.out(JSON.stringify(makeEnvelope(`${kind} list`, { entries })));
      return o.result(0);
    }
    o.out(fmt(locale, kind === 'ignore' ? M.ignoreListHead : M.exemptListHead));
    if (entries.length === 0) o.out(fmt(locale, M.none));
    const width = Math.max(0, ...entries.map(e => e.value.length)) + 6;
    for (const e of entries) {
      o.out(e.source === 'default' ? `  ${e.value.padEnd(width)}${fmt(locale, M.defaultTag)}` : `  ${e.value}`);
    }
    return o.result(0);
  }

  /* ── add / remove：整批校验 ── */
  if (values.length === 0) {
    o.err(fmt(locale, kind === 'ignore' ? M.errMissingIgnore : M.errMissingExempt));
    o.err(`Usage: openlogos ${kind} ${action} <${kind === 'ignore' ? 'pattern' : 'path'}...>`);
    return o.result(1);
  }
  const invalid: string[] = [];
  for (const v of values) {
    if (kind === 'ignore') {
      if (action === 'remove' && isRuntimeIgnoreEntry(v)) { invalid.push(fmt(locale, M.errRuntimeRemove)); continue; }
      const why: InvalidReason | null = ignorePatternInvalidReason(v);
      if (why) invalid.push(fmt(locale, M.errBadPattern, { v, r: why[locale] }));
    } else {
      const why = exemptEntryInvalidReason(v);
      if (why) invalid.push(fmt(locale, M.errBadPath, { v, r: why[locale] }));
    }
  }
  if (invalid.length > 0) {
    for (const l of invalid) o.err(l);
    return o.result(1);
  }

  if (kind === 'ignore') return runIgnoreWrite(o, locale, root, io, cfg, action, values);
  return runExemptWrite(o, locale, root, io, cfg, action, values);
}

function runIgnoreWrite(
  o: Out, locale: Locale, root: string, io: ScopeIo,
  cfg: Exclude<ReturnType<typeof readGuardScopeConfig>, { ok: false }>['value'],
  action: 'add' | 'remove', values: string[],
): ScopeResult {
  const gitignorePath = join(root, '.gitignore');
  // 区块检查先于任何写入（损坏 → 零写入）
  let existing: Buffer | null = null;
  try {
    existing = io.exists(gitignorePath) ? io.readFile(gitignorePath) : null;
  } catch (e) {
    o.err(fmt(locale, M.errWrite, { p: '.gitignore', d: (e as Error).message }));
    return o.result(1);
  }
  const probe = renderGitignoreWithManagedBlock(existing, cfg.unversioned);
  if (!probe.ok) {
    o.err(fmt(locale, M.errBlockCorrupt, { d: probe.corruption.detail[locale] }));
    return o.result(1);
  }

  o.out(fmt(locale, M.ignoreHeader));
  const next = [...cfg.unversioned];
  const added: string[] = [];
  for (const v of values) {
    if (action === 'add') {
      if (isRuntimeIgnoreEntry(v)) { o.out(fmt(locale, M.runtimeFixed)); continue; }
      if (next.includes(v)) { o.out(fmt(locale, M.present, { v })); continue; }
      next.push(v);
      added.push(v);
      o.out(fmt(locale, M.added, { v }));
    } else {
      const idx = next.indexOf(v);
      if (idx === -1) { o.out(fmt(locale, M.notFound, { v })); continue; }
      next.splice(idx, 1);
      o.out(fmt(locale, M.removed, { v }));
    }
  }
  if (next.length === cfg.unversioned.length && next.every((v, i) => v === cfg.unversioned[i])) {
    o.out(fmt(locale, M.noChanges));
    return o.result(0);
  }

  const rendered = renderGitignoreWithManagedBlock(existing, next);
  if (!rendered.ok) { // 与 probe 同一输入，不可达；保守处理
    o.err(fmt(locale, M.errBlockCorrupt, { d: rendered.corruption.detail[locale] }));
    return o.result(1);
  }
  const configPath = join(root, GUARD_CONFIG_REL);
  try {
    atomicWriteFile(configPath, serializeGuardConfig(cfg, { unversioned: next }), io.write);
  } catch (e) {
    o.err(fmt(locale, M.errWrite, { p: GUARD_CONFIG_REL, d: (e as Error).message }));
    return o.result(1);
  }
  o.out(fmt(locale, M.configWritten));
  if (rendered.changed) {
    try {
      atomicWriteFile(gitignorePath, rendered.next, io.write);
    } catch (e) {
      // 区块写失败：把配置回滚为写入前字节，整体表现为零写入
      try { atomicWriteFile(configPath, cfg.raw, io.write); } catch { /* 回滚失败时仍按失败退出 */ }
      o.err(fmt(locale, M.errWrite, { p: '.gitignore', d: (e as Error).message }));
      return o.result(1);
    }
    o.out(fmt(locale, rendered.created ? M.blockCreated : M.blockWritten));
  }

  if (action === 'add' && added.length > 0) {
    if (!insideGitRepo(root, io)) o.out(fmt(locale, M.notGit));
    else trackedHints(o, locale, root, io, added);
  }
  return o.result(0);
}

function runExemptWrite(
  o: Out, locale: Locale, root: string, io: ScopeIo,
  cfg: Exclude<ReturnType<typeof readGuardScopeConfig>, { ok: false }>['value'],
  action: 'add' | 'remove', values: string[],
): ScopeResult {
  o.out(fmt(locale, M.exemptHeader));
  const materialize = cfg.exempt === null;
  const base = cfg.exempt ?? [...BUILTIN_EXEMPT];
  const next = [...base];
  const lines: string[] = [];
  let anyAdded = false;
  for (const v of values) {
    if (action === 'add') {
      if (next.includes(v)) { lines.push(fmt(locale, M.present, { v })); continue; }
      next.push(v);
      anyAdded = true;
      lines.push(fmt(locale, M.added, { v }));
    } else {
      const idx = next.indexOf(v);
      if (idx === -1) { lines.push(fmt(locale, M.notFound, { v })); continue; }
      next.splice(idx, 1);
      lines.push(fmt(locale, M.removed, { v }));
    }
  }
  // 清单内容无变化即不写（缺省时也不为物化本身写盘）
  if (next.length === base.length && next.every((v, i) => v === base[i])) {
    for (const l of lines) o.out(l);
    o.out(fmt(locale, M.noChanges));
    return o.result(0);
  }
  if (materialize) o.out(fmt(locale, M.materialized));
  for (const l of lines) o.out(l);
  try {
    atomicWriteFile(join(root, GUARD_CONFIG_REL), serializeGuardConfig(cfg, { exempt: next }), io.write);
  } catch (e) {
    o.err(fmt(locale, M.errWrite, { p: GUARD_CONFIG_REL, d: (e as Error).message }));
    return o.result(1);
  }
  if (next.length === 0) o.out(fmt(locale, M.exemptEmptied));
  o.out(fmt(locale, M.configWritten));
  if (anyAdded) o.out(fmt(locale, M.exemptEffect));
  return o.result(0);
}

/** CLI 入口：执行并写出 stdout / stderr，按结果退出。 */
export function scopeCommand(kind: ScopeKind, argv: string[]): void {
  const r = runScopeCommand(kind, argv, process.cwd());
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.exitCode;
}
