/**
 * `openlogos sync` 按配置重渲染 `.gitignore` 托管区块（guard-versioned-content-scope，功能规格 §2.88.8；
 * 场景 S08「.gitignore 托管区块按配置重渲染时序」Step G1–G4、EX-GV-S08-1 / EX-GV-S08-2）。
 *
 * - 只读 `guard.unversioned`（缺省视为空数组），不读写 `guard.exempt`，不改写 logos.config.json；
 * - 渲染与 `openlogos ignore` / init 同一函数，结果相同不写盘（字节与 mtime 不变）；
 * - 区块损坏或配置条目非法：`.gitignore` 零写入，返回点名错误，由调用方继续其余同步并以 1 退出。
 */
import type { Locale } from '../i18n.js';
import { atomicWriteFile, defaultManagedWriteIo, readRootGitignore, renderGitignoreWithManagedBlock, type ManagedWriteIo } from './gitignore-managed-block.js';
import { ignorePatternInvalidReason } from './guard-scope-config.js';
import { join } from 'node:path';

export type GitignoreSyncResult =
  | { status: 'unchanged' }
  | { status: 'updated'; message: string }
  | { status: 'failed'; errors: string[]; partialLine: string };

const M = {
  updated: { en: '  ✓ .gitignore OpenLogos managed block updated', zh: '  ✓ .gitignore OpenLogos 托管区块已更新' },
  corrupt: {
    en: 'Error: The openlogos managed block in .gitignore is corrupted ({d}); .gitignore was not changed. Fix or remove the broken markers manually, then rerun openlogos sync.',
    zh: 'Error: .gitignore 中的 openlogos 托管区块已损坏（{d}），未改动 .gitignore。请手工修复或删除损坏的标记后重新运行 openlogos sync。',
  },
  badType: {
    en: 'Error: guard.unversioned in logos/logos.config.json must be an array of strings; .gitignore was not changed.',
    zh: 'Error: logos/logos.config.json 的 guard.unversioned 必须是字符串数组，未改动 .gitignore。',
  },
  badEntry: {
    en: 'Error: guard.unversioned in logos/logos.config.json contains an invalid entry "{v}": {r}; .gitignore was not changed. Fix it manually.',
    zh: 'Error: logos/logos.config.json 的 guard.unversioned 中有非法条目 "{v}"：{r}，未改动 .gitignore。请手工修正。',
  },
  writeFail: { en: 'Error: Failed to write .gitignore: {d}', zh: 'Error: 写入 .gitignore 失败：{d}' },
  partial: {
    en: 'Sync partially completed: .gitignore managed block was not updated.',
    zh: 'sync 部分完成：.gitignore 托管区块未更新。',
  },
} as const;

function fmt(locale: Locale, m: { en: string; zh: string }, vars: Record<string, string> = {}): string {
  let s = m[locale];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

/** Step G1：从已解析配置取 `guard.unversioned`；类型不符或含非法条目时返回点名错误。 */
export function readUnversionedForSync(config: Record<string, unknown>, locale: Locale): { ok: true; entries: string[] } | { ok: false; errors: string[] } {
  const guard = config.guard;
  if (guard === undefined) return { ok: true, entries: [] };
  if (!guard || typeof guard !== 'object' || Array.isArray(guard)) return { ok: false, errors: [fmt(locale, M.badType)] };
  const raw = (guard as Record<string, unknown>).unversioned;
  if (raw === undefined) return { ok: true, entries: [] };
  if (!Array.isArray(raw)) return { ok: false, errors: [fmt(locale, M.badType)] };
  const errors: string[] = [];
  const entries: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      errors.push(fmt(locale, M.badEntry, { v: JSON.stringify(item), r: locale === 'zh' ? '不是字符串' : 'not a string' }));
      continue;
    }
    const why = ignorePatternInvalidReason(item);
    if (why) errors.push(fmt(locale, M.badEntry, { v: item, r: why[locale] }));
    else entries.push(item);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries };
}

export function syncManagedGitignoreBlock(
  root: string, locale: Locale, config: Record<string, unknown>, io: ManagedWriteIo = defaultManagedWriteIo,
): GitignoreSyncResult {
  const partialLine = fmt(locale, M.partial);
  const read = readUnversionedForSync(config, locale);
  if (!read.ok) return { status: 'failed', errors: read.errors, partialLine };
  const existing = readRootGitignore(root);
  const rendered = renderGitignoreWithManagedBlock(existing, read.entries);
  if (!rendered.ok) return { status: 'failed', errors: [fmt(locale, M.corrupt, { d: rendered.corruption.detail[locale] })], partialLine };
  if (!rendered.changed) return { status: 'unchanged' };
  try {
    atomicWriteFile(join(root, '.gitignore'), rendered.next, io);
  } catch (e) {
    return { status: 'failed', errors: [fmt(locale, M.writeFail, { d: (e as Error).message })], partialLine };
  }
  return { status: 'updated', message: fmt(locale, M.updated) };
}
