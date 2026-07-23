/**
 * S35 前置重构③（code-r1 F2/F3/F7 重写）：delta 正交双结论分类器——
 * merge（`scanDeltas` 投影读 `mergeDisposition`）、change-lint L6（读 `lintValidity`）与
 * L3 测试证据清单（只消费 mergeable+valid 的 test 条目）**共享同一次遍历判定**，路径枚举 /
 * 隐藏规则 / symlink containment / IO 错误只实现一次（单一事实源）。
 *
 * 判定规则：
 * - `mergeDisposition`：已知类别下非隐藏、非 .gitkeep 的普通文件与文件 symlink → mergeable
 *   （与既有 merge 消费行为一致）；目录 symlink 逃逸提案目录 → 不递归、ignored（安全边界）。
 * - `lintValidity`：unknown 类别 / deltas 根下直接放文件 / 断链 / 任一层级 symlink 解析后
 *   逃逸提案目录 → invalid；reference 类别、隐藏路径、.gitkeep → explicitly_ignored；其余 valid。
 * - 目录枚举 / 元数据读取失败不吞且 **fail-fast**（r3 F7）：首个 readdir/lstat/realpath 错误即
 *   终止整个分类（内部哨兵异常），返回仅含该 `ioError` 条目的结果——错误确定后不再读取任何后续产物；
 *   命令层立即映射 `artifact_unreadable`。
 * - symlink 解析失败按错误码分流（r4 F7）：仅确认的断链码（ENOENT/ELOOP/ENOTDIR）构成 L6 invalid；
 *   EACCES/EPERM/EIO 等真实读取失败一律走上述 fail-fast——不得伪装成「断链」继续扫描后续条目。
 *   消费边界（merge `scanDeltas`）遇 ioError 条目抛 `DeltaScanUnreadableError`，错误条目绝不混入普通投影。
 */
import { existsSync, readdirSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

export const DELTA_TO_RESOURCE: Record<string, string> = {
  'prd': 'logos/resources/prd',
  'api': 'logos/resources/api',
  'database': 'logos/resources/database',
  'scenario': 'logos/resources/scenario',
  'test': 'logos/resources/test',
  'spec': 'spec',
  'skills': 'skills',
};

export type MergeDisposition = 'mergeable' | 'ignored';
export type LintValidity = 'valid' | 'explicitly_ignored' | 'invalid';

export interface DeltaEntryClassification {
  /** 相对提案目录，如 `deltas/prd/x.md`（POSIX 分隔）。 */
  relativePath: string;
  /** deltas 下的一级类别；根条目为 ''。 */
  category: string;
  mergeDisposition: MergeDisposition;
  lintValidity: LintValidity;
  invalidReason?: string;
  /** 枚举/元数据读取失败：命令层立即映射 artifact_unreadable（fail loud，不吞）。 */
  ioError?: string;
  /**
   * r5 F7：提案边界内、可安全做内容可读性探测的条目——本地普通文件，或解析后落在提案目录内
   * 且目标为普通文件的 symlink。与 mergeDisposition/lintValidity **正交**：reference/隐藏/unknown/
   * 根下直放等被 L6 忽略或判非法的**本地**文件同样必须探测（「delta 任一不可读 → artifact_unreadable」
   * 是操作级红线，不因消费集合排除而豁免）；逃逸/断链 symlink、目录与非常规文件恒不解引用（F3 边界保持）。
   */
  contentProbeEligible?: boolean;
}

function isHiddenOrKeep(parts: string[]): boolean {
  // r6 F21(a)：空数组安全定义——隐藏规则只对类别内路径有意义，根级条目（空段）恒为非隐藏，
  // 任何调用点不得再触发 parts[-1].endsWith 崩溃。
  if (parts.length === 0) return false;
  return parts.some(p => p.startsWith('.')) || parts[parts.length - 1].endsWith('.gitkeep');
}

/** r3 F7：IO 错误的 fail-fast 内部哨兵——携带唯一 ioError 条目，终止整个遍历。 */
class DeltaScanIoError extends Error {
  constructor(public readonly entry: DeltaEntryClassification) {
    super(entry.ioError ?? 'delta scan io error');
  }
}

/**
 * r4 F7：消费边界的错误态显式化——分类结果含 ioError 条目时，投影型消费方（merge `scanDeltas`）
 * 抛本错误而非把错误条目过滤成空清单（否则「产物不可读」会被 no-delta 早退写成 SPEC_MERGED 假成功）。
 */
export class DeltaScanUnreadableError extends Error {
  constructor(public readonly entry: DeltaEntryClassification) {
    super(entry.ioError ?? 'delta scan io error');
  }
}

/** r4 F7：确认的断链错误码——目标不存在/链路自环/中间段非目录才构成 L6 invalid；其余 IO code 一律 fail-fast。 */
const BROKEN_LINK_CODES = new Set(['ENOENT', 'ELOOP', 'ENOTDIR']);

function ioCode(e: unknown): string {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : '';
}

export function classifyProposalDeltas(proposalDir: string): DeltaEntryClassification[] {
  const out: DeltaEntryClassification[] = [];
  const deltasDir = join(proposalDir, 'deltas');

  let proposalReal: string;
  try {
    proposalReal = realpathSync(proposalDir);
  } catch (e) {
    return [{ relativePath: 'deltas', category: '', mergeDisposition: 'ignored', lintValidity: 'invalid', ioError: `无法解析提案目录：${String(e).slice(0, 120)}` }];
  }
  const contained = (p: string) => (p + sep).startsWith(proposalReal + sep);
  const visitedDirs = new Set<string>();

  // r2 F3：deltas 根自身先 lstat——根是 symlink 时必须 realpath 落在提案目录内，
  // 否则整棵外部目录都会以「普通文件」形态绕过子条目的 symlink 分支。断链/逃逸 → 单条 invalid、不递归。
  let rootLst;
  try {
    rootLst = lstatSync(deltasDir);
  } catch (e) {
    if (ioCode(e) === 'ENOENT') return out; // deltas/ 不存在：无条目
    // r4 F7：EACCES 等真实读取失败不得伪装成「无 deltas」——fail-fast 映射 artifact_unreadable
    return [{ relativePath: 'deltas', category: '', mergeDisposition: 'ignored', lintValidity: 'invalid', ioError: `无法读取 deltas 元数据：${String(e).slice(0, 120)}` }];
  }
  if (rootLst.isSymbolicLink()) {
    let rootResolved: string;
    try {
      rootResolved = realpathSync(deltasDir);
    } catch (e) {
      // r4 F7：仅确认断链码构成 invalid；其余 IO code（EACCES/EPERM/EIO…）fail-fast
      if (BROKEN_LINK_CODES.has(ioCode(e))) {
        return [{ relativePath: 'deltas', category: '', mergeDisposition: 'ignored', lintValidity: 'invalid', invalidReason: 'deltas 根 symlink 目标无法解析（断链）' }];
      }
      return [{ relativePath: 'deltas', category: '', mergeDisposition: 'ignored', lintValidity: 'invalid', ioError: `无法解析 deltas 根 symlink：${String(e).slice(0, 120)}` }];
    }
    if (!contained(rootResolved)) {
      return [{ relativePath: 'deltas', category: '', mergeDisposition: 'ignored', lintValidity: 'invalid', invalidReason: `deltas 根为 symlink 且解析后逃逸提案目录（${rootResolved}）` }];
    }
  }
  if (!existsSync(deltasDir)) return out;

  const walk = (dirAbs: string, relParts: string[], category: string | null): void => {
    let names: string[];
    try {
      names = readdirSync(dirAbs).sort();
    } catch (e) {
      // r3 F7：fail-fast——错误一旦确定，不再读取任何后续产物（兄弟目录/后序条目一律不枚举）
      throw new DeltaScanIoError({
        relativePath: ['deltas', ...relParts].join('/'), category: category ?? '',
        mergeDisposition: 'ignored', lintValidity: 'invalid',
        ioError: `无法枚举目录 deltas/${relParts.join('/')}：${String(e).slice(0, 120)}`,
      });
    }
    for (const name of names) {
      const full = join(dirAbs, name);
      const parts = [...relParts, name];
      const relPath = ['deltas', ...parts].join('/');
      const cat = category ?? name; // 顶层目录名即类别
      const knownCategory = Object.prototype.hasOwnProperty.call(DELTA_TO_RESOURCE, cat);

      let lst;
      try {
        lst = lstatSync(full);
      } catch (e) {
        throw new DeltaScanIoError({ relativePath: relPath, category: category ?? '', mergeDisposition: 'ignored', lintValidity: 'invalid', ioError: `无法读取 ${relPath} 元数据：${String(e).slice(0, 120)}` });
      }

      if (lst.isSymbolicLink()) {
        let resolved: string;
        let target;
        try {
          resolved = realpathSync(full);
          target = statSync(full);
        } catch (e) {
          // r4 F7：仅确认断链码构成 L6 invalid 并继续；EACCES/EPERM/EIO 等真实读取失败
          // 一律 fail-fast——错误确定后不再读取任何后续产物（字典序后续条目一律不枚举）
          if (BROKEN_LINK_CODES.has(ioCode(e))) {
            out.push({ relativePath: relPath, category: category ?? cat, mergeDisposition: 'ignored', lintValidity: 'invalid', invalidReason: 'symlink 目标无法解析（断链）' });
            continue;
          }
          throw new DeltaScanIoError({ relativePath: relPath, category: category ?? cat, mergeDisposition: 'ignored', lintValidity: 'invalid', ioError: `无法解析 symlink ${relPath} 目标：${String(e).slice(0, 120)}` });
        }
        if (target.isDirectory()) {
          if (!contained(resolved)) {
            // 目录 symlink 逃逸：不递归、不消费（安全边界优先于枚举）
            out.push({ relativePath: relPath, category: category ?? cat, mergeDisposition: 'ignored', lintValidity: 'invalid', invalidReason: `目录 symlink 解析后逃逸提案目录（${resolved}）` });
            continue;
          }
          if (visitedDirs.has(resolved)) continue; // 环路保护
          visitedDirs.add(resolved);
          walk(full, parts, category ?? name);
          continue;
        }
        // 文件 symlink：merge 照旧跟随（消费行为零改动）；lint 对逃逸目标判 invalid
        // r5 F7：仅「解析后落在提案目录内且目标为普通文件」的 symlink 可安全探测内容（F3 边界保持）
        const symlinkProbe = contained(resolved) && target.isFile();
        // r6 F21(a)：根级 symlink 先于隐藏规则处理——与根级普通文件同判 L6 invalid，绝不崩溃
        if (category === null) {
          out.push({ relativePath: relPath, category: '', mergeDisposition: 'ignored', lintValidity: 'invalid', invalidReason: 'deltas 根下不允许直接放置文件（须置于类别目录）', contentProbeEligible: symlinkProbe });
          continue;
        }
        // r6 F21(b)：目录之外，仅普通文件目标可作「文件 symlink」消费——FIFO/socket 等非常规目标
        // 一律 ignored + invalid（merge 消费零漂移：变更前 scanDeltas 经 statSync().isFile() 过滤即不消费）
        if (!target.isFile()) {
          out.push({ relativePath: relPath, category: cat, mergeDisposition: 'ignored', lintValidity: 'invalid', invalidReason: `非常规 symlink 目标（${resolved}）` });
          continue;
        }
        const hidden = isHiddenOrKeep(parts.slice(1));
        out.push({
          relativePath: relPath, category: cat,
          mergeDisposition: knownCategory && !hidden ? 'mergeable' : 'ignored',
          lintValidity: !contained(resolved)
            ? 'invalid'
            : (!knownCategory ? (cat === 'reference' ? 'explicitly_ignored' : 'invalid') : (hidden ? 'explicitly_ignored' : 'valid')),
          ...(contained(resolved) ? {} : { invalidReason: `symlink 解析后逃逸提案目录（${resolved}）` }),
          contentProbeEligible: symlinkProbe,
        });
        continue;
      }

      if (lst.isDirectory()) {
        let resolved: string;
        try {
          resolved = realpathSync(full);
        } catch (e) {
          throw new DeltaScanIoError({ relativePath: relPath, category: category ?? '', mergeDisposition: 'ignored', lintValidity: 'invalid', ioError: `无法解析目录 ${relPath}：${String(e).slice(0, 120)}` });
        }
        if (visitedDirs.has(resolved)) continue;
        visitedDirs.add(resolved);
        walk(full, parts, category ?? name);
        continue;
      }

      if (lst.isFile()) {
        // r5 F7：本地普通文件一律可安全探测内容——含根下直放/unknown/reference/隐藏等 L6 忽略或判非法条目
        if (category === null) {
          out.push({ relativePath: relPath, category: '', mergeDisposition: 'ignored', lintValidity: 'invalid', invalidReason: 'deltas 根下不允许直接放置文件（须置于类别目录）', contentProbeEligible: true });
          continue;
        }
        const hidden = isHiddenOrKeep(parts.slice(1));
        out.push({
          relativePath: relPath, category: cat,
          mergeDisposition: knownCategory && !hidden ? 'mergeable' : 'ignored',
          lintValidity: !knownCategory
            ? (cat === 'reference' ? 'explicitly_ignored' : 'invalid')
            : (hidden ? 'explicitly_ignored' : 'valid'),
          ...(!knownCategory && cat !== 'reference'
            ? { invalidReason: `未知 delta 类别目录 deltas/${cat}/（合法：${Object.keys(DELTA_TO_RESOURCE).join('/')}、reference）` }
            : {}),
          contentProbeEligible: true,
        });
        continue;
      }

      // FIFO / socket 等非常规条目
      out.push({ relativePath: relPath, category: category ?? '', mergeDisposition: 'ignored', lintValidity: 'invalid', invalidReason: '非常规文件类型' });
    }
  };

  try {
    walk(deltasDir, [], null);
  } catch (e) {
    if (e instanceof DeltaScanIoError) {
      // r3 F7：错误确定即终止——只返回该 ioError 条目（此前已收集的条目一并丢弃，
      // 命令层立即映射 artifact_unreadable，绝不基于半份清单继续检查）。
      return [e.entry];
    }
    throw e;
  }
  out.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  return out;
}

/** L3 证据清单的唯一来源（F6）：本提案 deltas/test/** 中实际可合并且路径合法的条目（相对 deltas/test/ 的路径）。 */
export function listEvidenceTestDeltaFiles(proposalDir: string): string[] {
  return classifyProposalDeltas(proposalDir)
    .filter(e => e.category === 'test' && e.mergeDisposition === 'mergeable' && e.lintValidity === 'valid')
    .map(e => e.relativePath.replace(/^deltas\/test\//, ''));
}
