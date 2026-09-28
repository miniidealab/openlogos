/**
 * 存量 CRLF 工作区的受控恢复（架构 §五十二 52.4 第 2 条）。
 *
 * 只处理「哈希绑定」的规格与原型：活跃提案 `SPEC_MERGED.test_change_set.targets[].after_sha256`
 * 与 `PLAN_APPROVED.hashes`（原型 delta 源与 resources 落盘位）。托管钩子与运行时脚本由 sync 以随包字节重写，不在此处。
 *
 * 判据以 Git index 中该路径的权威 blob 为基准：
 * - 仅当工作区字节 === 「blob 的 LF→CRLF 转换结果」（除换行外无任何本地修改），且 blob 自身哈希等于既有登记哈希时，
 *   才把工作区写回 blob 原始字节，并读回复验哈希；
 * - 含换行以外的本地修改、非 Git 仓库、index 无该路径 / 不可读、哈希复验失败：一律不动，逐路径报告。
 *
 * 禁止：改哈希算法（哈希前归一化 `\r\n`）、批量改换行、重签哈希——本模块只写回 index 字节，不触碰任何登记哈希。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_APPROVED_MARKER, SPEC_MERGED_MARKER } from './proposal-markers.js';
import { readPlanApproved } from './ui-provenance.js';

const PROTOTYPE_DELTA_REL = 'deltas/prd/2-product-design/2-page-design';
const PROTOTYPE_RESOURCE_REL = 'logos/resources/prd/2-product-design/2-page-design';

export type CrlfRecoveryStatus =
  | 'restored'
  | 'local-modification'
  | 'not-git'
  | 'index-unreadable'
  | 'hash-mismatch';

export interface CrlfRecoveryEntry {
  /** 项目相对 posix 路径 */
  path: string;
  status: CrlfRecoveryStatus;
}

export interface HashBoundFile {
  path: string;
  sha256: string;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Git `core.autocrlf=true` 签出对 blob 做的转换：孤立 LF → CRLF（已有 CRLF 保持）。 */
export function lfToCrlf(bytes: Buffer): Buffer {
  return Buffer.from(bytes.toString('latin1').replace(/(?<!\r)\n/g, '\r\n'), 'latin1');
}

function listActiveProposalDirs(root: string): Array<{ slug: string; dir: string }> {
  const changesDir = join(root, 'logos', 'changes');
  if (!existsSync(changesDir)) return [];
  return readdirSync(changesDir)
    .filter(name => name !== 'archive' && statSync(join(changesDir, name)).isDirectory())
    .sort()
    .map(slug => ({ slug, dir: join(changesDir, slug) }));
}

/** 收集活跃提案中登记了哈希的规格与原型路径（去重；同一路径多份登记按首条）。 */
export function collectHashBoundFiles(root: string): HashBoundFile[] {
  const out = new Map<string, string>();
  const add = (path: string, hash: unknown) => {
    if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) && !out.has(path)) out.set(path, hash);
  };
  for (const { slug, dir } of listActiveProposalDirs(root)) {
    const markerPath = join(dir, SPEC_MERGED_MARKER);
    if (existsSync(markerPath)) {
      try {
        const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { test_change_set?: { targets?: unknown } };
        const targets = marker?.test_change_set?.targets;
        if (Array.isArray(targets)) {
          for (const row of targets as Array<Record<string, unknown>>) {
            if (typeof row?.target_path === 'string') add(row.target_path, row.after_sha256);
          }
        }
      } catch { /* marker 不可解析：由既有读取入口诊断，本模块不接管 */ }
    }
    if (existsSync(join(dir, PLAN_APPROVED_MARKER))) {
      const hashes = readPlanApproved(dir).hashes ?? {};
      for (const [page, hash] of Object.entries(hashes)) {
        add(`logos/changes/${slug}/${PROTOTYPE_DELTA_REL}/${page}`, hash);
        add(`${PROTOTYPE_RESOURCE_REL}/${page}`, hash);
      }
    }
  }
  return [...out.entries()].map(([path, hash]) => ({ path, sha256: hash }));
}

function git(root: string, args: string[]): { ok: boolean; stdout: Buffer } {
  const r = spawnSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0 && !r.error, stdout: r.stdout ?? Buffer.alloc(0) };
}

/**
 * 刷新该路径的 index stat 缓存：CRLF 签出时 index 记录的是 CRLF 文件大小，写回后大小不同，
 * Git 仅凭大小即判「已修改」而不比对内容。工作区此时等于 index blob，重新登记只更新 stat，blob 不变；
 * 若 blob 意外改变则按原 oid 还原登记。
 */
function refreshIndexStat(root: string, path: string): void {
  const before = git(root, ['ls-files', '-s', '--', path]).stdout.toString('utf8').trim();
  const match = /^(\d+) ([0-9a-f]+) 0\t/.exec(before);
  if (!match) return;
  git(root, ['update-index', '--', path]);
  const after = git(root, ['ls-files', '-s', '--', path]).stdout.toString('utf8').trim();
  if (after !== before) git(root, ['update-index', '--cacheinfo', `${match[1]},${match[2]},${path}`]);
}

/**
 * 对「当前字节漂移且含 CRLF」的哈希绑定文件执行受控恢复；未漂移或不含 CRLF 的文件不在本恢复范围内，不报告。
 */
export function recoverCrlfWorkspace(root: string, files = collectHashBoundFiles(root)): CrlfRecoveryEntry[] {
  const candidates = files.filter(file => {
    const abs = join(root, ...file.path.split('/'));
    if (!existsSync(abs)) return false;
    const bytes = readFileSync(abs);
    return sha256(bytes) !== file.sha256 && bytes.includes('\r\n');
  });
  if (candidates.length === 0) return [];

  const inRepo = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inRepo.ok || inRepo.stdout.toString('utf8').trim() !== 'true') {
    return candidates.map(file => ({ path: file.path, status: 'not-git' as const }));
  }

  const results: CrlfRecoveryEntry[] = [];
  for (const file of candidates) {
    const abs = join(root, ...file.path.split('/'));
    const blob = git(root, ['cat-file', 'blob', `:./${file.path}`]);
    if (!blob.ok) {
      results.push({ path: file.path, status: 'index-unreadable' });
      continue;
    }
    const workspace = readFileSync(abs);
    if (!workspace.equals(lfToCrlf(blob.stdout))) {
      results.push({ path: file.path, status: 'local-modification' });
      continue;
    }
    // 先验：blob 本身必须满足既有登记哈希，否则写回也无法复验通过——不动。
    if (sha256(blob.stdout) !== file.sha256) {
      results.push({ path: file.path, status: 'hash-mismatch' });
      continue;
    }
    writeFileSync(abs, blob.stdout);
    if (sha256(readFileSync(abs)) !== file.sha256) {
      writeFileSync(abs, workspace);
      results.push({ path: file.path, status: 'hash-mismatch' });
      continue;
    }
    refreshIndexStat(root, file.path);
    results.push({ path: file.path, status: 'restored' });
  }
  return results;
}

const REASON_ZH: Record<Exclude<CrlfRecoveryStatus, 'restored'>, string> = {
  'local-modification': '含换行以外的本地修改',
  'not-git': '非 Git 仓库，无权威 blob 可对照',
  'index-unreadable': 'Git index 中无该路径或不可读',
  'hash-mismatch': '写回后哈希复验失败',
};
const REASON_EN: Record<Exclude<CrlfRecoveryStatus, 'restored'>, string> = {
  'local-modification': 'has local modifications beyond line endings',
  'not-git': 'not a Git repository, no authoritative blob',
  'index-unreadable': 'path missing from Git index or unreadable',
  'hash-mismatch': 'hash re-verification failed',
};

/** sync 输出行：已恢复路径与需人工处理路径逐条列出。 */
export function formatCrlfRecoveryReport(entries: CrlfRecoveryEntry[], locale: 'zh' | 'en'): string[] {
  return entries.map(entry => {
    if (entry.status === 'restored') {
      return locale === 'zh'
        ? `  ✓ 存量 CRLF 已恢复为 index 字节（哈希复验通过）：${entry.path}`
        : `  ✓ CRLF working copy restored to index bytes (hash verified): ${entry.path}`;
    }
    return locale === 'zh'
      ? `  ⚠ 存量 CRLF 需人工处理：${entry.path}（${REASON_ZH[entry.status]}；未改写、未重签哈希）`
      : `  ⚠ CRLF working copy needs manual handling: ${entry.path} (${REASON_EN[entry.status]}; left untouched, hash not re-signed)`;
  });
}
