/**
 * `.gitignore` 托管区块渲染器（guard-versioned-content-scope，功能规格 §2.88.3）。
 *
 * 单一实现，供 `openlogos ignore`、`openlogos sync`（按配置重渲染）与 init / adopt（固定运行时条目）复用：
 * - 区块格式：起始标记、说明行、固定条目 `logos/.openlogos-runtime/`、`guard.unversioned` 条目（按配置顺序）、结束标记；
 * - 只处理项目根 `.gitignore`；无区块时追加到文件末尾（前面补一个空行）；文件不存在时新建仅含区块的文件；
 * - 区块外逐字节不变：以 Buffer 拼接，不做任何换行归一化或编码往返；
 * - 行尾沿用文件现有风格：首个换行为 CRLF 则整个区块用 CRLF，否则 LF；
 * - 损坏（多个起始标记、多个结束标记、只有起始或只有结束、结束先于起始）→ 不渲染，交调用方 fail loud；
 * - 幂等：渲染结果与现有字节相同时 `changed=false`，调用方据此不写盘。
 *
 * 本模块只做纯计算与（可注入的）原子写盘，不读写 logos.config.json。
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MANAGED_START = '# >>> openlogos managed >>>';
export const MANAGED_END = '# <<< openlogos managed <<<';
export const MANAGED_NOTE = '# 由 openlogos 维护，请用 `openlogos ignore` 修改；区块外内容不会被改动';
/** 托管区块唯一固定条目：guard 自有状态目录。 */
export const MANAGED_RUNTIME_ENTRY = 'logos/.openlogos-runtime/';

export interface ManagedBlockCorruption {
  /** 机读原因 */
  kind: 'multiple-start' | 'multiple-end' | 'start-without-end' | 'end-without-start' | 'end-before-start';
  /** 损坏标记所在行号（1 起） */
  lines: number[];
  detail: { en: string; zh: string };
}

interface LineInfo {
  /** 行内容起点（字节偏移） */
  start: number;
  /** 行内容终点（不含 `\r\n` / `\n`） */
  end: number;
}

/** 按字节切行；只认 `\n`（`\r\n` 中的 `\r` 计入终止符）。 */
function splitLines(buf: Buffer): LineInfo[] {
  const lines: LineInfo[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) {
      lines.push({ start: pos, end: buf.length });
      break;
    }
    const end = nl > pos && buf[nl - 1] === 0x0d ? nl - 1 : nl;
    lines.push({ start: pos, end });
    pos = nl + 1;
  }
  return lines;
}

/** 文件现有行尾：首个换行为 CRLF → `\r\n`，否则 `\n`（无换行也用 `\n`）。 */
export function detectEol(buf: Buffer | null): '\r\n' | '\n' {
  if (!buf) return '\n';
  const nl = buf.indexOf(0x0a);
  return nl > 0 && buf[nl - 1] === 0x0d ? '\r\n' : '\n';
}

export type ManagedBlockLocation =
  | { ok: true; block: { start: number; end: number } | null }
  | { ok: false; corruption: ManagedBlockCorruption };

/**
 * 定位托管区块：返回区块从起始标记行首到结束标记行内容末尾（不含其行尾符）的字节区间；无区块为 null。
 * 标记行按去掉首尾空白后与标记全等识别（标记均为 ASCII，latin1 解码与原字节一一对应）。
 */
export function locateManagedBlock(buf: Buffer | null): ManagedBlockLocation {
  if (!buf || buf.length === 0) return { ok: true, block: null };
  const lines = splitLines(buf);
  const starts: number[] = [];
  const ends: number[] = [];
  lines.forEach((l, i) => {
    const text = buf.subarray(l.start, l.end).toString('latin1').trim();
    if (text === MANAGED_START) starts.push(i);
    else if (text === MANAGED_END) ends.push(i);
  });
  const ln = (idx: number[]) => idx.map(i => i + 1);
  if (starts.length > 1) {
    const at = ln(starts).join(', ');
    return { ok: false, corruption: { kind: 'multiple-start', lines: ln(starts), detail: {
      en: `found ${starts.length} start markers at lines ${at}`,
      zh: `发现 ${starts.length} 个起始标记，位于第 ${at} 行`,
    } } };
  }
  if (ends.length > 1) {
    const at = ln(ends).join(', ');
    return { ok: false, corruption: { kind: 'multiple-end', lines: ln(ends), detail: {
      en: `found ${ends.length} end markers at lines ${at}`,
      zh: `发现 ${ends.length} 个结束标记，位于第 ${at} 行`,
    } } };
  }
  if (starts.length === 1 && ends.length === 0) {
    return { ok: false, corruption: { kind: 'start-without-end', lines: ln(starts), detail: {
      en: `start marker without end marker at line ${starts[0] + 1}`,
      zh: `只有起始标记没有结束标记，起始标记位于第 ${starts[0] + 1} 行`,
    } } };
  }
  if (starts.length === 0 && ends.length === 1) {
    return { ok: false, corruption: { kind: 'end-without-start', lines: ln(ends), detail: {
      en: `end marker without start marker at line ${ends[0] + 1}`,
      zh: `只有结束标记没有起始标记，结束标记位于第 ${ends[0] + 1} 行`,
    } } };
  }
  if (starts.length === 0) return { ok: true, block: null };
  if (ends[0] < starts[0]) {
    return { ok: false, corruption: { kind: 'end-before-start', lines: [ends[0] + 1, starts[0] + 1], detail: {
      en: `end marker at line ${ends[0] + 1} precedes start marker at line ${starts[0] + 1}`,
      zh: `结束标记（第 ${ends[0] + 1} 行）先于起始标记（第 ${starts[0] + 1} 行）`,
    } } };
  }
  return { ok: true, block: { start: lines[starts[0]].start, end: lines[ends[0]].end } };
}

/** 渲染区块本体（不含末尾行尾符）；条目中与固定条目重复者不重复输出。 */
export function renderManagedBlockBody(entries: readonly string[], eol: '\r\n' | '\n'): string {
  const seen = new Set<string>([MANAGED_RUNTIME_ENTRY]);
  const lines = [MANAGED_START, MANAGED_NOTE, MANAGED_RUNTIME_ENTRY];
  for (const e of entries) {
    if (seen.has(e)) continue;
    seen.add(e);
    lines.push(e);
  }
  lines.push(MANAGED_END);
  return lines.join(eol);
}

export type ManagedRenderResult =
  | { ok: true; next: Buffer; changed: boolean; created: boolean }
  | { ok: false; corruption: ManagedBlockCorruption };

/**
 * 计算写入后的 `.gitignore` 字节。`existing` 为 null 表示文件不存在。
 * - 有区块：只替换起始标记行首到结束标记行内容末尾之间的字节，前后字节原样保留；
 * - 无区块：原内容后补一个空行再追加区块（原内容无结尾换行时先补行尾）；空文件直接写区块；
 * - 文件不存在：新建仅含区块的文件。
 */
export function renderGitignoreWithManagedBlock(existing: Buffer | null, entries: readonly string[]): ManagedRenderResult {
  const loc = locateManagedBlock(existing);
  if (!loc.ok) return loc;
  const eol = detectEol(existing);
  const body = Buffer.from(renderManagedBlockBody(entries, eol), 'utf-8');
  const eolBuf = Buffer.from(eol, 'latin1');
  let next: Buffer;
  if (existing === null) {
    next = Buffer.concat([body, eolBuf]);
    return { ok: true, next, changed: true, created: true };
  }
  if (loc.block) {
    next = Buffer.concat([existing.subarray(0, loc.block.start), body, existing.subarray(loc.block.end)]);
  } else if (existing.length === 0) {
    next = Buffer.concat([body, eolBuf]);
  } else {
    const endsWithNl = existing[existing.length - 1] === 0x0a;
    next = Buffer.concat([existing, ...(endsWithNl ? [] : [eolBuf]), eolBuf, body, eolBuf]);
  }
  return { ok: true, next, changed: !next.equals(existing), created: false };
}

/** 可注入的写盘入口（测试以哨兵替换以断言零写入 / 注入失败）。 */
export interface ManagedWriteIo {
  writeFileSync: (path: string, data: Buffer | string) => void;
  renameSync: (from: string, to: string) => void;
  unlinkSync: (path: string) => void;
}

export const defaultManagedWriteIo: ManagedWriteIo = {
  writeFileSync: (p, d) => writeFileSync(p, d),
  renameSync: (a, b) => renameSync(a, b),
  unlinkSync: p => unlinkSync(p),
};

/** 同目录临时文件 + rename 的原子写；失败时清理临时文件并抛出原错误。 */
export function atomicWriteFile(target: string, data: Buffer | string, io: ManagedWriteIo = defaultManagedWriteIo): void {
  const tmp = `${target}.openlogos-tmp-${process.pid}-${Date.now()}`;
  try {
    io.writeFileSync(tmp, data);
    io.renameSync(tmp, target);
  } catch (error) {
    try { if (existsSync(tmp)) io.unlinkSync(tmp); } catch { /* 清理失败不掩盖原错误 */ }
    throw error;
  }
}

/** 读取项目根 `.gitignore` 原始字节；不存在为 null。 */
export function readRootGitignore(root: string): Buffer | null {
  const p = join(root, '.gitignore');
  return existsSync(p) ? readFileSync(p) : null;
}
