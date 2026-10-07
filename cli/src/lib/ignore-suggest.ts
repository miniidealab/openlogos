/**
 * init / adopt 技术栈建议忽略（guard-versioned-content-scope，功能规格 §2.88.7；CLI 交互设计
 * 「S01 / S20: 技术栈建议忽略 — 交互规格」；场景 S01「技术栈建议忽略与 .gitignore 托管区块时序」、
 * S20「adopt 技术栈建议忽略确认时序」）。
 *
 * init 与 adopt 共用同一实现（S20 不变量 1）：
 * - 首写前预检 `.gitignore` 托管区块（损坏 → 调用方 exit 1，不创建任何文件）；
 * - 技术栈探测 → 候选条目（Node → Python → Rust 顺序合并去重）；
 * - 只建议尚未被忽略的条目：git 工作树内 `git check-ignore -q --no-index -- <探测路径>`，
 *   非 git 仓库按根 `.gitignore` 文本近似判定；
 * - 交互终端整份清单一次确认 `[Y/n]`（回车 = 接受），非交互不写建议条目、只输出 `openlogos ignore add …`；
 * - 写配置之后渲染托管区块（固定运行时条目不经询问写入并告知），接受时按实际匹配文件给出已跟踪文件移出命令。
 *
 * 进程调用层与写盘入口沿用 `openlogos ignore` 的可注入 ScopeIo，便于测试设哨兵。
 */
import type { Locale } from '../i18n.js';
import { atomicWriteFile, locateManagedBlock, renderGitignoreWithManagedBlock, MANAGED_RUNTIME_ENTRY } from './gitignore-managed-block.js';
import { defaultScopeIo, shellQuote, trackedHints, type ScopeIo } from '../commands/scope.js';
import { join } from 'node:path';

export type StackName = 'Node' | 'Python' | 'Rust';

/** 技术栈 → 识别依据（项目根清单文件）与建议条目；顺序即合并顺序。 */
export const STACK_SUGGESTIONS: ReadonlyArray<{ stack: StackName; manifests: readonly string[]; entries: readonly string[] }> = [
  { stack: 'Node', manifests: ['package.json'], entries: ['node_modules/', 'dist/', 'build/', 'coverage/'] },
  { stack: 'Python', manifests: ['pyproject.toml', 'requirements.txt', 'setup.py'], entries: ['__pycache__/', '.venv/', '*.pyc'] },
  { stack: 'Rust', manifests: ['Cargo.toml'], entries: ['target/'] },
];

/** 通配条目的代表性样例路径（目录条目以条目本身探测）。 */
const PROBE_SAMPLES: Readonly<Record<string, string>> = { '*.pyc': 'openlogos-probe.pyc' };

export interface Suggestion {
  entry: string;
  /** 该条目下已被跟踪的文件数（非 git 仓库或统计失败为 0） */
  tracked: number;
}

export interface IgnoreSuggestPlan {
  stacks: StackName[];
  /** 是否位于 git 工作树内（决定已忽略判定方式与已跟踪文件提示） */
  git: boolean;
  /** 过滤已忽略后的建议清单（保持候选顺序） */
  suggestions: Suggestion[];
  /** 交互结论：accepted / rejected；无建议为 none；非交互为 non-interactive */
  outcome: 'accepted' | 'rejected' | 'none' | 'non-interactive';
}

type Msg = Record<Locale, string>;
const M = {
  notGit: {
    en: "ℹ Not inside a git repository; guard's version-control criterion is not in effect.",
    zh: 'ℹ 当前目录不在 git 仓库中，guard 新判据不生效。',
  },
  header: {
    en: 'Detected {stacks} project. These paths are not ignored by git yet:',
    zh: '检测到 {stacks} 项目，以下路径尚未被 git 忽略：',
  },
  tracked: { en: ' (contains {n} tracked file(s))', zh: '（含 {n} 个已跟踪文件）' },
  ask: { en: 'Add them to .gitignore (openlogos managed block)? [Y/n]: ', zh: '是否加入 .gitignore（openlogos 托管区块）？[Y/n]：' },
  runtime: {
    en: `  ✓ .gitignore managed block: ${MANAGED_RUNTIME_ENTRY} (OpenLogos runtime files)`,
    zh: `  ✓ 已在 .gitignore 托管区块写入 ${MANAGED_RUNTIME_ENTRY}（OpenLogos 运行时文件）`,
  },
  accepted: { en: '  ✓ .gitignore managed block: added {list}', zh: '  ✓ 已加入 .gitignore 托管区块：{list}' },
  rejected: { en: '  · Skipped. You can add them later: {cmd}', zh: '  · 已跳过。之后可运行：{cmd}' },
  nonInteractive: {
    en: 'ℹ Suggested ignore entries were not written (non-interactive). To add them: {cmd}',
    zh: 'ℹ 非交互环境，未写入建议忽略条目。如需加入：{cmd}',
  },
  approvalNote: {
    en: '  This command changes guard\'s protection scope: if an AI runs it, the host asks the user to approve that call '
      + '(Claude Code default / acceptEdits modes only); in other permission modes, ask the user to run `! <command>` in the terminal.',
    zh: '  该命令会改变 guard 的保护范围：由 AI 代为执行时，宿主会对这次调用弹出原生审批、用户批准后执行'
      + '（仅 Claude Code default / acceptEdits 模式）；其他权限模式下，请用户在终端用 `! <命令>` 自行执行。',
  },
  corruptInit: {
    en: 'Error: The openlogos managed block in .gitignore is corrupted ({d}). Fix it manually and rerun; no files were created.',
    zh: 'Error: .gitignore 中的 openlogos 托管区块已损坏（{d}），请手工修复后重试，未创建任何文件。',
  },
  writeFail: { en: '⚠ Failed to write .gitignore managed block: {d}', zh: '⚠ 写入 .gitignore 托管区块失败：{d}' },
} satisfies Record<string, Msg>;

function fmt(locale: Locale, m: Msg, vars: Record<string, string | number> = {}): string {
  let s = m[locale];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/**
 * 首写前预检托管区块（Step 5c / EX-GV-S01-1 / EX-GV-S20-1）：完好或不存在返回 null；
 * 损坏返回本地化错误行（调用方写 stderr 并 exit 1）。
 */
export function managedBlockPrecheck(root: string, locale: Locale, io: Pick<ScopeIo, 'exists' | 'readFile'> = defaultScopeIo): string | null {
  const p = join(root, '.gitignore');
  const buf = io.exists(p) ? io.readFile(p) : null;
  const loc = locateManagedBlock(buf);
  return loc.ok ? null : fmt(locale, M.corruptInit, { d: loc.corruption.detail[locale] });
}

/** Step 5a / 5b：探测技术栈并按 Node → Python → Rust 合并去重候选条目。 */
export function detectStackCandidates(root: string, exists: (p: string) => boolean = defaultScopeIo.exists): { stacks: StackName[]; candidates: string[] } {
  const stacks: StackName[] = [];
  const candidates: string[] = [];
  for (const s of STACK_SUGGESTIONS) {
    if (!s.manifests.some(m => exists(join(root, m)))) continue;
    stacks.push(s.stack);
    for (const e of s.entries) if (!candidates.includes(e)) candidates.push(e);
  }
  return { stacks, candidates };
}

/** 条目的探测路径：通配条目用代表性样例，目录条目用条目本身。 */
export function probePathFor(entry: string): string {
  return PROBE_SAMPLES[entry] ?? entry;
}

/**
 * Step 5d'：非 git 仓库按根 `.gitignore` 文本近似判定。去首尾空白逐行比对；
 * 目录条目与去掉末尾 `/` 的同名行互认；注释行与 `!` 取反行不参与比对。
 */
export function ignoredByGitignoreText(text: string, entry: string): boolean {
  const bare = entry.endsWith('/') ? entry.slice(0, -1) : entry;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    if (line === entry) return true;
    if (entry.endsWith('/') && line === bare) return true;
  }
  return false;
}

export function isInsideGitWorkTree(root: string, io: Pick<ScopeIo, 'exec'> = defaultScopeIo): boolean {
  const r = io.exec('git', ['rev-parse', '--is-inside-work-tree'], root);
  return !r.error && r.status === 0 && r.stdout.toString('utf-8').trim() === 'true';
}

/**
 * Step 5d / 5e：过滤已忽略条目，得到建议清单（附已跟踪文件数）。
 * git 判定退出码 0 = 已忽略；1 = 未忽略；其他（含调用失败）按未忽略保留（宁可多问，不漏问）。
 */
export function computeSuggestions(root: string, candidates: readonly string[], io: Pick<ScopeIo, 'exec' | 'exists' | 'readFile'> = defaultScopeIo): { git: boolean; suggestions: Suggestion[] } {
  const git = isInsideGitWorkTree(root, io);
  const suggestions: Suggestion[] = [];
  if (git) {
    for (const entry of candidates) {
      const r = io.exec('git', ['check-ignore', '-q', '--no-index', '--', probePathFor(entry)], root);
      if (!r.error && r.status === 0) continue;
      const ls = io.exec('git', ['ls-files', '-z', '-ci', `--exclude=${entry}`], root);
      const tracked = !ls.error && ls.status === 0
        ? ls.stdout.toString('utf-8').split('\0').filter(f => f.length > 0).length
        : 0;
      suggestions.push({ entry, tracked });
    }
    return { git, suggestions };
  }
  const p = join(root, '.gitignore');
  const text = io.exists(p) ? io.readFile(p).toString('utf-8') : '';
  for (const entry of candidates) {
    if (!ignoredByGitignoreText(text, entry)) suggestions.push({ entry, tracked: 0 });
  }
  return { git, suggestions };
}

/** 可直接复制执行的 `openlogos ignore add …`：含通配或 shell 特殊字符的条目加单引号。 */
export function formatIgnoreAddCommand(entries: readonly string[]): string {
  const quoted = entries.map(e => (/^[A-Za-z0-9._/@+=:,-]+$/.test(e) ? e : shellQuote(e)));
  return `openlogos ignore add ${quoted.join(' ')}`;
}

function joinList(locale: Locale, items: readonly string[]): string {
  return items.join(locale === 'zh' ? '、' : ', ');
}

export interface PlanOptions {
  /** stdin 是否为 TTY（`--locale` / `--ai-tool` 不影响本问） */
  interactive: boolean;
  /** 交互提问（返回原始回答） */
  ask: (prompt: string) => Promise<string>;
  log: (line: string) => void;
  io?: Partial<ScopeIo>;
}

/** 回车、`y`、`Y`、`yes` 视为接受，其余视为拒绝。 */
export function isAcceptAnswer(answer: string): boolean {
  const a = answer.trim();
  return a === '' || a === 'y' || a === 'Y' || a === 'yes';
}

/**
 * Step 5a–5f：探测、过滤、（交互时）询问。只做只读查询与输出，不写盘——问答发生在写配置之前。
 */
export async function planIgnoreSuggestions(root: string, locale: Locale, opts: PlanOptions): Promise<IgnoreSuggestPlan> {
  const io: ScopeIo = { ...defaultScopeIo, ...opts.io };
  const { stacks, candidates } = detectStackCandidates(root, io.exists);
  if (candidates.length === 0) return { stacks, git: false, suggestions: [], outcome: 'none' };
  const { git, suggestions } = computeSuggestions(root, candidates, io);
  if (!git) opts.log(fmt(locale, M.notGit));
  if (suggestions.length === 0) return { stacks, git, suggestions, outcome: 'none' };

  opts.log('');
  opts.log(fmt(locale, M.header, { stacks: joinList(locale, stacks) }));
  for (const s of suggestions) {
    opts.log(`  ${s.entry}${s.tracked > 0 ? fmt(locale, M.tracked, { n: s.tracked }) : ''}`);
  }
  if (!opts.interactive) return { stacks, git, suggestions, outcome: 'non-interactive' };
  const answer = await opts.ask(fmt(locale, M.ask));
  return { stacks, git, suggestions, outcome: isAcceptAnswer(answer) ? 'accepted' : 'rejected' };
}

/** 接受时写入 `guard.unversioned` 的条目；其余情形为 null（不写该字段）。 */
export function acceptedEntries(plan: IgnoreSuggestPlan): string[] | null {
  return plan.outcome === 'accepted' ? plan.suggestions.map(s => s.entry) : null;
}

/**
 * Step 6a / 11：配置写入之后渲染托管区块并输出报告。返回是否写盘成功（失败只告警，不回滚已完成的初始化）。
 */
export function applyIgnoreBlock(
  root: string, locale: Locale, plan: IgnoreSuggestPlan,
  opts: { log: (line: string) => void; warn: (line: string) => void; io?: Partial<ScopeIo> },
): boolean {
  const io: ScopeIo = { ...defaultScopeIo, ...opts.io };
  const gitignorePath = join(root, '.gitignore');
  const existing = io.exists(gitignorePath) ? io.readFile(gitignorePath) : null;
  const entries = acceptedEntries(plan) ?? [];
  // 固定条目已在区块中 → 不输出告知行（交互规格「固定条目已存在：无输出」）
  const loc = locateManagedBlock(existing);
  const runtimePresent = loc.ok && loc.block !== null && existing !== null
    && existing.subarray(loc.block.start, loc.block.end).toString('utf-8').split(/\r?\n/).some(l => l.trim() === MANAGED_RUNTIME_ENTRY);
  const rendered = renderGitignoreWithManagedBlock(existing, entries);
  if (!rendered.ok) {
    // 首写前已预检；此处仅在预检之后被并发改坏时可达
    opts.warn(fmt(locale, M.writeFail, { d: rendered.corruption.detail[locale] }));
    return false;
  }
  if (rendered.changed) {
    try {
      atomicWriteFile(gitignorePath, rendered.next, io.write);
    } catch (e) {
      opts.warn(fmt(locale, M.writeFail, { d: (e as Error).message }));
      return false;
    }
  }
  if (!runtimePresent) opts.log(fmt(locale, M.runtime));

  const all = plan.suggestions.map(s => s.entry);
  if (plan.outcome === 'accepted') {
    opts.log(fmt(locale, M.accepted, { list: joinList(locale, all) }));
    if (plan.git) {
      const withTracked = plan.suggestions.filter(s => s.tracked > 0).map(s => s.entry);
      if (withTracked.length > 0) trackedHints({ out: opts.log }, locale, root, io, withTracked);
    }
  } else if (plan.outcome === 'rejected') {
    opts.log(fmt(locale, M.rejected, { cmd: formatIgnoreAddCommand(all) }));
  } else if (plan.outcome === 'non-interactive') {
    opts.log(fmt(locale, M.nonInteractive, { cmd: formatIgnoreAddCommand(all) }));
    opts.log(fmt(locale, M.approvalNote));
  }
  return true;
}
