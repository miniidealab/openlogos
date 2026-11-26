/**
 * Claude Code 项目 `.claude/settings.json` 托管 hook 的封闭表识别与迁移
 * （fix-claude-hook-windows-powershell-fallback，功能规格 §2.105.2～§2.105.4、spec/pretooluse-guard.md「hook 注册形态（规范性）」）。
 *
 * - 托管条目 = 位于托管分组内、且 hook 对象与封闭表某一行完全相同的条目；其余一律是用户条目，字节不变。
 * - 纯托管分组的 matcher 就地校正；混合分组保留原 matcher 与用户条目，只把托管条目移入标准分组。
 * - 全部以原文最小文本编辑写回（json-text-edit），不整文件重新序列化。
 */
import {
  insertArrayItem, memberOf, nodeValue, parseJsonText, removeArrayItem, replaceNode, replaceWithValue,
  setObjectMember, type JsonNode,
} from './json-text-edit.js';

// PreToolUse / SessionStart：bash 脚本型 hook，命令不变（bash 下直接执行，PowerShell 下无法求值 → 宿主阻断）。
export const CLAUDE_GUARD_HOOK_COMMAND = '"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check';
export const CLAUDE_GUARD_HOOK_LEGACY_COMMAND = '.claude/openlogos/bin/guard-check';
export const CLAUDE_PHASE_HOOK_COMMAND = '"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/openlogos-phase';
export const CLAUDE_PHASE_HOOK_LEGACY_COMMAND = '.claude/openlogos/bin/openlogos-phase';
export const CLAUDE_GUARD_HOOK_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell';
export const CLAUDE_GUARD_HOOK_LEGACY_MATCHER = 'Edit|Write|Bash';

// 事后检查引擎：node 类 hook，只用 Claude Code 自行处理的 ${CLAUDE_PROJECT_DIR} 占位符（架构 52.5 第 7 条）。
export const CLAUDE_ENGINE_REL = '.claude/openlogos/bin/guard-post-check.cjs';
const ENGINE_PLACEHOLDER_PATH = `\${CLAUDE_PROJECT_DIR}/${CLAUDE_ENGINE_REL}`;
export const CLAUDE_POST_CHECK_COMMAND = `node "${ENGINE_PLACEHOLDER_PATH}" check`;
export const CLAUDE_STOP_CHECK_COMMAND = `${CLAUDE_POST_CHECK_COMMAND} --stop`;
const CLAUDE_POST_CHECK_LEGACY_COMMAND = `node "$CLAUDE_PROJECT_DIR/${CLAUDE_ENGINE_REL}" check`;
export const CLAUDE_POST_MATCHER = 'Bash|PowerShell|BashOutput|TaskOutput|KillShell|TaskStop';
export const CLAUDE_POST_FAILURE_MATCHER = 'Bash|PowerShell';

export interface ClaudeHookExecRow { command: string; args: string[] }

export interface ClaudeHookEventSpec {
  event: string;
  /** 现行行。 */
  current: string;
  /** 历史字符串行。 */
  legacy: string[];
  /** 历史 exec 行（args 元素中的 `\` 视同 `/`）。 */
  exec: ClaudeHookExecRow[];
  /** 标准分组 matcher；null 表示无 matcher。 */
  matcher: string | null;
  /** 托管分组判据：现行 / 历史 matcher 集合、无 matcher 分组、或含封闭表完整调用的分组。 */
  groupRule: 'matcher-set' | 'no-matcher' | 'contains-row';
  legacyMatchers?: string[];
}

export const CLAUDE_HOOK_EVENT_SPECS: Readonly<Record<'PreToolUse' | 'SessionStart' | 'PostToolUse' | 'PostToolUseFailure' | 'Stop', ClaudeHookEventSpec>> = {
  PreToolUse: {
    event: 'PreToolUse', current: CLAUDE_GUARD_HOOK_COMMAND, legacy: [CLAUDE_GUARD_HOOK_LEGACY_COMMAND], exec: [],
    matcher: CLAUDE_GUARD_HOOK_MATCHER, groupRule: 'matcher-set', legacyMatchers: [CLAUDE_GUARD_HOOK_LEGACY_MATCHER],
  },
  SessionStart: {
    event: 'SessionStart', current: CLAUDE_PHASE_HOOK_COMMAND, legacy: [CLAUDE_PHASE_HOOK_LEGACY_COMMAND], exec: [],
    matcher: null, groupRule: 'no-matcher',
  },
  PostToolUse: {
    event: 'PostToolUse', current: CLAUDE_POST_CHECK_COMMAND, legacy: [CLAUDE_POST_CHECK_LEGACY_COMMAND],
    exec: [{ command: 'node', args: [ENGINE_PLACEHOLDER_PATH, 'check'] }],
    matcher: CLAUDE_POST_MATCHER, groupRule: 'contains-row',
  },
  PostToolUseFailure: {
    event: 'PostToolUseFailure', current: CLAUDE_POST_CHECK_COMMAND, legacy: [CLAUDE_POST_CHECK_LEGACY_COMMAND],
    exec: [{ command: 'node', args: [ENGINE_PLACEHOLDER_PATH, 'check'] }],
    matcher: CLAUDE_POST_FAILURE_MATCHER, groupRule: 'contains-row',
  },
  Stop: {
    event: 'Stop', current: CLAUDE_STOP_CHECK_COMMAND, legacy: [`${CLAUDE_POST_CHECK_LEGACY_COMMAND} --stop`],
    exec: [{ command: 'node', args: [ENGINE_PLACEHOLDER_PATH, 'check', '--stop'] }],
    matcher: null, groupRule: 'no-matcher',
  },
};

function sortedKeys(v: Record<string, unknown>): string {
  return Object.keys(v).sort().join(',');
}

/** hook 对象是否与本事件封闭表的某一行完全相同（只含 type / command，exec 行另含 args）。 */
export function isClosedTableEntry(value: unknown, spec: ClaudeHookEventSpec): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const h = value as Record<string, unknown>;
  if (h['type'] !== 'command' || typeof h['command'] !== 'string') return false;
  const keys = sortedKeys(h);
  if (keys === 'command,type') return h['command'] === spec.current || spec.legacy.includes(h['command'] as string);
  if (keys !== 'args,command,type' || !Array.isArray(h['args'])) return false;
  const args = h['args'] as unknown[];
  if (!args.every(a => typeof a === 'string')) return false;
  return spec.exec.some(row => row.command === h['command'] && row.args.length === args.length
    && row.args.every((a, i) => (args[i] as string).replace(/\\/g, '/') === a));
}

function isCurrentEntry(value: unknown, spec: ClaudeHookEventSpec): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const h = value as Record<string, unknown>;
  return sortedKeys(h) === 'command,type' && h['type'] === 'command' && h['command'] === spec.current;
}

function standardEntry(spec: ClaudeHookEventSpec): { type: string; command: string } {
  return { type: 'command', command: spec.current };
}

function standardGroup(spec: ClaudeHookEventSpec): Record<string, unknown> {
  return spec.matcher === null
    ? { hooks: [standardEntry(spec)] }
    : { matcher: spec.matcher, hooks: [standardEntry(spec)] };
}

interface Located { root: JsonNode; arr: JsonNode }

function locateEvent(text: string, event: string): Located {
  const root = parseJsonText(text);
  const arr = memberOf(memberOf(root, 'hooks')!.value, event)!.value;
  return { root, arr };
}

function groupHooks(group: JsonNode): JsonNode {
  return memberOf(group, 'hooks')!.value;
}

/**
 * 对单个事件执行封闭表迁移，返回新原文（无变化时与输入相同）。
 * 调用方保证 text 是顶层为对象的合法 JSON。
 */
export function mergeClaudeHookEvent(text: string, spec: ClaudeHookEventSpec): string {
  const root = parseJsonText(text);
  if (root.kind !== 'object') return text;
  const hooksMember = memberOf(root, 'hooks');
  if (!hooksMember || hooksMember.value.kind !== 'object') {
    return setObjectMember(text, root, root, 'hooks', { [spec.event]: [standardGroup(spec)] });
  }
  const eventMember = memberOf(hooksMember.value, spec.event);
  if (!eventMember || eventMember.value.kind !== 'array') {
    return setObjectMember(text, root, hooksMember.value, spec.event, [standardGroup(spec)]);
  }

  // ① 识别托管分组与其中的托管条目
  const arr = eventMember.value as Extract<JsonNode, { kind: 'array' }>;
  const moved: Array<{ gi: number; ii: number }> = [];
  const candidates: Array<{ gi: number; ii: number }> = [];
  const fixGroups: number[] = [];
  let firstMovedGi = -1;
  let standardGi = -1; // 已有标准分组：只含托管条目的分组（matcher 校正后即为现行值）
  arr.items.forEach((group, gi) => {
    if (group.kind !== 'object') return;
    const hm = memberOf(group, 'hooks');
    if (!hm || hm.value.kind !== 'array') return;
    const items = hm.value.items;
    const managedIdx = items.flatMap((it, ii) => (isClosedTableEntry(nodeValue(text, it), spec) ? [ii] : []));
    if (managedIdx.length === 0) return;
    const mm = memberOf(group, 'matcher');
    const matcher = mm ? nodeValue(text, mm.value) : undefined;
    const managedGroup = spec.groupRule === 'contains-row'
      || (spec.groupRule === 'no-matcher' && !mm)
      || (spec.groupRule === 'matcher-set' && typeof matcher === 'string'
        && [spec.matcher, ...(spec.legacyMatchers ?? [])].includes(matcher));
    if (!managedGroup) return; // 非托管分组里的同名命令按用户条目保留，不计入“已注册”
    const pure = managedIdx.length === items.length;
    const needsFix = spec.matcher !== null && matcher !== spec.matcher;
    if (needsFix && !pure) {
      // 混合分组：保留原 matcher 与用户条目，托管条目移入标准分组
      for (const ii of managedIdx) moved.push({ gi, ii });
      if (firstMovedGi < 0) firstMovedGi = gi;
      return;
    }
    if (needsFix) fixGroups.push(gi);
    if (pure && standardGi < 0) standardGi = gi;
    for (const ii of managedIdx) candidates.push({ gi, ii });
  });

  // ② 先完成混合分组迁移、再按迁移后的顺序收敛（评审 code-r1 F2，§2.105.4「移动之后再执行多条收敛为一条」）：
  // 被移出的托管条目并入已有标准分组（其位置上的条目本就在 candidates 中）；没有标准分组时，
  // 它们落在紧接首个移出分组之后新建的标准分组——该虚拟位置与其余托管条目一起按文档顺序比较，只保留第一条。
  const order = (gi: number, ii: number): number => gi * 1_000_000 + ii;
  const virtualNew = moved.length > 0 && standardGi < 0;
  const keepIsNew = virtualNew && (candidates.length === 0 || order(firstMovedGi, 999_999) < order(candidates[0].gi, candidates[0].ii));
  const keep = keepIsNew ? undefined : candidates[0];
  const removals = [...moved, ...(keep ? candidates.slice(1) : candidates)];
  let t = text;

  // ③ 保留条目改写为现行行（exec 形式的 args 一并移除）
  if (keep) {
    const { arr: a } = locateEvent(t, spec.event);
    const item = (groupHooks((a as Extract<JsonNode, { kind: 'array' }>).items[keep.gi]) as Extract<JsonNode, { kind: 'array' }>).items[keep.ii];
    if (!isCurrentEntry(nodeValue(t, item), spec)) t = replaceWithValue(t, item, standardEntry(spec));
  }
  // ④ 纯托管分组 matcher 就地校正
  for (const gi of fixGroups) {
    const { root: r, arr: a } = locateEvent(t, spec.event);
    const group = (a as Extract<JsonNode, { kind: 'array' }>).items[gi];
    const mm = memberOf(group, 'matcher');
    t = mm ? replaceNode(t, mm.value, JSON.stringify(spec.matcher)) : setObjectMember(t, r, group, 'matcher', spec.matcher);
  }
  // 插入标准分组：保留位置为新建分组（紧接首个移出分组之后），或本事件没有任何托管条目（追加到末尾）
  let insertAt = -1;
  if (!keep) {
    const { root: r, arr: a } = locateEvent(t, spec.event);
    insertAt = firstMovedGi >= 0 ? firstMovedGi + 1 : (a as Extract<JsonNode, { kind: 'array' }>).items.length;
    t = insertArrayItem(t, r, a, insertAt, standardGroup(spec));
  }
  // ⑤ 删除被移出 / 被收敛的托管条目；因此变空的分组整组删除（自后向前，索引不漂移）
  const byGroup = new Map<number, number[]>();
  for (const { gi, ii } of removals) byGroup.set(gi, [...(byGroup.get(gi) ?? []), ii]);
  for (const gi of [...byGroup.keys()].sort((x, y) => y - x)) {
    const shifted = insertAt >= 0 && gi >= insertAt ? gi + 1 : gi;
    const idxs = byGroup.get(gi)!.sort((x, y) => y - x);
    const { arr: a } = locateEvent(t, spec.event);
    const group = (a as Extract<JsonNode, { kind: 'array' }>).items[shifted];
    const hooksArr = groupHooks(group) as Extract<JsonNode, { kind: 'array' }>;
    if (idxs.length === hooksArr.items.length) {
      t = removeArrayItem(t, a, shifted);
      continue;
    }
    for (const ii of idxs) {
      const { arr: a2 } = locateEvent(t, spec.event);
      t = removeArrayItem(t, groupHooks((a2 as Extract<JsonNode, { kind: 'array' }>).items[shifted]), ii);
    }
  }
  return t;
}
