/**
 * guard 保护范围配置（guard-versioned-content-scope，功能规格 §2.88.1 / §2.88.2）：
 * `logos/logos.config.json` 的 `guard.unversioned`（不入库，渲染进 `.gitignore` 托管区块）与
 * `guard.exempt`（入库但写入不需立案）的条目语法、匹配与读取。
 *
 * 条目语法与 `plugin/bin/guard-check` 的 exempt_entry_invalid_reason / exempt_entry_matches 同口径；
 * CLI 读取时对非法条目以退出码 1 报告（guard 判定时跳过并警告，不扩大豁免）。
 */
import { readFileSync } from 'node:fs';

export const GUARD_CONFIG_REL = 'logos/logos.config.json';
export const GUARD_RUNTIME_REL = 'logos/.openlogos-runtime';

/** `guard.exempt` 缺省时的内置默认（与原 R-REF / R-STAGING 等价）。 */
export const BUILTIN_EXEMPT: readonly string[] = Object.freeze([
  'logos/resources/reference/',
  'logos/resources/verify/baseline-seed-runs/*/staging/',
]);

export interface InvalidReason { en: string; zh: string }

const SEGMENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** exempt 条目语法：合法返回 null，非法返回原因（中英）。 */
export function exemptEntryInvalidReason(entry: string): InvalidReason | null {
  if (entry === '' || entry === '/' || entry === '*') {
    return { en: "must not be empty, '/' or a lone '*'", zh: '不能为空串、/ 或单独的 *' };
  }
  if (/[\n\r\t\0]/.test(entry)) return { en: 'must be a single line', zh: '不能含换行或控制字符' };
  if (entry.includes('\\')) return { en: "must use '/' as separator and must not contain '\\'", zh: '只能用 / 分隔，不能含 \\' };
  if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) {
    return { en: "must be a project-relative path without '..', '.' or empty segments", zh: '必须是不含 ..、. 或空段的项目根相对路径' };
  }
  const body = entry.endsWith('/') ? entry.slice(0, -1) : entry;
  const segs = body.split('/');
  if (body === '' || segs.some(s => s === '' || s === '.' || s === '..')) {
    return { en: "must be a project-relative path without '..', '.' or empty segments", zh: '必须是不含 ..、. 或空段的项目根相对路径' };
  }
  if (body === '*') return { en: "must not be empty, '/' or a lone '*'", zh: '不能为空串、/ 或单独的 *' };
  if (segs.some(s => s !== '*' && s.includes('*'))) {
    return { en: "'*' must occupy a whole path segment", zh: '* 必须独占一个路径段' };
  }
  if (body === GUARD_RUNTIME_REL || body.startsWith(`${GUARD_RUNTIME_REL}/`)) {
    return { en: `${GUARD_RUNTIME_REL}/ is guard's own state and cannot be exempted`, zh: `${GUARD_RUNTIME_REL}/ 是 guard 自有状态，不能豁免` };
  }
  if (segs.includes('.gitignore') || segs[0] === '.git' || body === GUARD_CONFIG_REL) {
    return {
      en: 'ignore-rule sources, logos/logos.config.json and paths under .git/ cannot be exempted',
      zh: '忽略规则来源、logos/logos.config.json 与 .git/ 下的路径不能豁免',
    };
  }
  return null;
}

export interface ExemptEntryShape { kind: 'dir' | 'file'; segments: string[] }

/** 解析合法 exempt 条目：以 `/` 结尾为目录（完整段匹配其本身及后代），否则为单个文件。 */
export function parseExemptEntry(entry: string): ExemptEntryShape | null {
  if (exemptEntryInvalidReason(entry)) return null;
  const isDir = entry.endsWith('/');
  return { kind: isDir ? 'dir' : 'file', segments: (isDir ? entry.slice(0, -1) : entry).split('/') };
}

/** exempt 条目是否命中项目根相对路径 `rel`（`*` 恰好匹配一个满足标识符约束的段）。 */
export function exemptEntryMatches(entry: string, rel: string): boolean {
  const shape = parseExemptEntry(entry);
  if (!shape) return false;
  const rs = rel.split('/');
  if (rs.some(s => s === '' || s === '.' || s === '..')) return false;
  if (shape.kind === 'dir' ? rs.length < shape.segments.length : rs.length !== shape.segments.length) return false;
  return shape.segments.every((seg, i) => (seg === '*' ? SEGMENT_ID_RE.test(rs[i]) && !rs[i].includes('..') : seg === rs[i]));
}

/** unversioned（gitignore 模式）语法：合法返回 null，非法返回原因。 */
export function ignorePatternInvalidReason(pattern: string): InvalidReason | null {
  if (pattern === '') return { en: 'must not be empty', zh: '不能为空串' };
  if (/[\n\r]/.test(pattern)) return { en: 'must be a single line', zh: '不能含换行' };
  if (pattern.includes('\0')) return { en: 'must not contain NUL', zh: '不能含 NUL 字符' };
  if (pattern.startsWith('#') || pattern.startsWith('!')) return { en: "must not start with '#' or '!'", zh: '不能以 # 或 ! 开头' };
  if (pattern.split('/').some(s => s === '..')) return { en: "must not contain '..' segments", zh: '不能含 .. 段' };
  return null;
}

/** 固定运行时条目的各种书写（`logos/.openlogos-runtime`、`/logos/.openlogos-runtime/` 等）。 */
export function isRuntimeIgnoreEntry(pattern: string): boolean {
  let p = pattern.trim();
  while (p.startsWith('/')) p = p.slice(1);
  while (p.endsWith('/')) p = p.slice(0, -1);
  return p === GUARD_RUNTIME_REL;
}

export type GuardConfigError =
  | { code: 'PROJECT_NOT_INITIALIZED' }
  | { code: 'CONFIG_INVALID'; detail: string }
  | { code: 'GUARD_ENTRY_INVALID'; field: 'exempt' | 'unversioned'; value: string; reason: InvalidReason };

export interface GuardScopeConfig {
  /** 原始字节（回滚用） */
  raw: Buffer;
  /** 解析后的整份配置（写回时只改 guard 字段） */
  config: Record<string, unknown>;
  /** guard.unversioned（缺省为 []） */
  unversioned: string[];
  /** guard.exempt 显式值；缺省为 null（按内置默认） */
  exempt: string[] | null;
}

/**
 * 读取并严格校验保护范围配置：配置缺失 / 不可解析 / 字段类型不符 / 已有非法条目 → 返回错误（CLI 零写入、exit 1）。
 * 两张清单一并校验，保证任一子命令写回时不会把损坏内容原样带回。
 */
export function readGuardScopeConfig(configPath: string, exists: boolean): { ok: true; value: GuardScopeConfig } | { ok: false; error: GuardConfigError } {
  if (!exists) return { ok: false, error: { code: 'PROJECT_NOT_INITIALIZED' } };
  let raw: Buffer;
  try {
    raw = readFileSync(configPath);
  } catch (e) {
    return { ok: false, error: { code: 'CONFIG_INVALID', detail: (e as Error).message } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf-8'));
  } catch (e) {
    return { ok: false, error: { code: 'CONFIG_INVALID', detail: (e as Error).message } };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: { code: 'CONFIG_INVALID', detail: 'top-level value is not an object' } };
  }
  const config = parsed as Record<string, unknown>;
  let unversioned: string[] = [];
  let exempt: string[] | null = null;
  if (Object.prototype.hasOwnProperty.call(config, 'guard')) {
    const g = config.guard;
    if (!g || typeof g !== 'object' || Array.isArray(g)) {
      return { ok: false, error: { code: 'CONFIG_INVALID', detail: 'guard must be an object' } };
    }
    const guard = g as Record<string, unknown>;
    for (const field of ['unversioned', 'exempt'] as const) {
      if (!Object.prototype.hasOwnProperty.call(guard, field)) continue;
      const v = guard[field];
      if (!Array.isArray(v)) {
        return { ok: false, error: { code: 'CONFIG_INVALID', detail: `guard.${field} must be an array of strings` } };
      }
      for (const item of v) {
        if (typeof item !== 'string') {
          return { ok: false, error: { code: 'GUARD_ENTRY_INVALID', field, value: JSON.stringify(item), reason: { en: 'not a string', zh: '不是字符串' } } };
        }
        const why = field === 'exempt' ? exemptEntryInvalidReason(item) : ignorePatternInvalidReason(item);
        if (why) return { ok: false, error: { code: 'GUARD_ENTRY_INVALID', field, value: item, reason: why } };
      }
      if (field === 'unversioned') unversioned = [...v] as string[];
      else exempt = [...v] as string[];
    }
  }
  return { ok: true, value: { raw, config, unversioned, exempt } };
}

/** 把新的 guard 字段写进配置对象并序列化（沿用项目 2 空格缩进；保留原文件末尾换行习惯）。 */
export function serializeGuardConfig(
  base: GuardScopeConfig,
  patch: { unversioned?: string[]; exempt?: string[] },
): string {
  const config: Record<string, unknown> = { ...base.config };
  const guard: Record<string, unknown> = config.guard && typeof config.guard === 'object' && !Array.isArray(config.guard)
    ? { ...(config.guard as Record<string, unknown>) }
    : {};
  if (patch.unversioned !== undefined) guard.unversioned = patch.unversioned;
  if (patch.exempt !== undefined) guard.exempt = patch.exempt;
  config.guard = guard;
  const trailingNl = base.raw.length > 0 && base.raw[base.raw.length - 1] === 0x0a;
  return JSON.stringify(config, null, 2) + (trailingNl ? '\n' : '');
}
