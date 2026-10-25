/**
 * module-scoped-phase-reports：多模块项目中 initial 模块的阶段报告判定（功能规格 §2.99.3、§2.99.4，
 * spec/flow-spec.md §9）。
 *
 * 验收（phase.3-6）、部署（phase.3-7）、冒烟（phase.3-8）三个阶段的产物是全项目共用的报告文件；
 * 多模块项目中它们不能说明「属于哪个模块」，所以 initial 模块改认 `<m>-acceptance-report.md` /
 * `<m>-deployment-report.md` / `<m>-smoke-report.md`。本文件是该判定的**唯一实现**——phase 派生
 * （flow-derive）、overlay 派生（flow-overlay-derive 的 `file:` 谓词）、旧派生（status.ts，仅测试期等价断言）
 * 与 launch 共用，判据不得在调用方重写。
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';
import { readProjectYaml } from './project-yaml.js';

export type ReportPhase = 'acceptance' | 'deployment' | 'smoke';

export const VERIFY_REPORT_DIR = 'logos/resources/verify';

/** 内置 initial flow 三条报告节点的 produces（spec/flow/initial.yaml），即共用报告路径。 */
export const SHARED_REPORT_PATHS: Readonly<Record<ReportPhase, string>> = {
  acceptance: `${VERIFY_REPORT_DIR}/acceptance-report.md`,
  deployment: `${VERIFY_REPORT_DIR}/deployment-report.md`,
  smoke: `${VERIFY_REPORT_DIR}/smoke-report.md`,
};

/** phase key → 报告阶段（initial flow 的 node-id→phase-key 映射见 flow-derive.ts）。 */
export const REPORT_PHASE_BY_KEY: Readonly<Record<string, ReportPhase>> = {
  'phase.3-6': 'acceptance',
  'phase.3-7-deploy': 'deployment',
  'phase.3-8-smoke': 'smoke',
};

/** Summary 表 Gate 行的首列（与 verify / smoke 报告生成器同一字面量）。 */
const GATE_LABEL: Readonly<Record<'acceptance' | 'smoke', string>> = {
  acceptance: 'Gate 3.5',
  smoke: 'Gate 3.8',
};

/** 模块报告 Summary 表「模块 / Module」行的首列（writer 写 `MODULE_ROW_LABEL`，reader 兼容中英文写法）。 */
export const MODULE_ROW_LABEL = 'Module';
const MODULE_ROW_LABEL_RE = /^(?:模块|Module|模块\s*\/\s*Module|模块\s*[（(]\s*Module\s*[)）])$/;

/** 多模块项目中的 initial 模块才使用模块报告；单模块项目与 launched 模块不变。 */
export function usesModuleReports(mod: { lifecycle?: string }, isMultiModule: boolean): boolean {
  return isMultiModule && mod.lifecycle === 'initial';
}

export function moduleReportPath(moduleId: string, phase: ReportPhase): string {
  return `${VERIFY_REPORT_DIR}/${moduleId}-${phase}-report.md`;
}

/** 内置报告路径（`file:` 谓词原文去掉前缀后的值）→ 报告阶段；其他路径返回 null。 */
export function reportPhaseOfSharedPath(path: string): ReportPhase | null {
  const normalized = posix.normalize(path.trim().replace(/\\/g, '/')).replace(/^\.\//, '');
  for (const phase of Object.keys(SHARED_REPORT_PATHS) as ReportPhase[]) {
    if (SHARED_REPORT_PATHS[phase] === normalized) return phase;
  }
  return null;
}

function stripCell(cell: string): string {
  return cell.trim().replace(/^\*\*(.*)\*\*$/, '$1').replace(/^`(.*)`$/, '$1').trim();
}

/** 读取 `## Summary` 下第一张表的行（首列 → 第二列，均已去掉 `**` / 反引号）。 */
export function readSummaryRows(content: string): Map<string, string> {
  const rows = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => /^##\s+(?:Summary|摘要)\s*$/.test(line.trim()));
  if (start === -1) return rows;
  let inTable = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) {
      if (inTable || /^#{1,6}\s/.test(line)) break;
      continue;
    }
    inTable = true;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|'));
    if (cells.length < 2) continue;
    const key = stripCell(cells[0]);
    if (/^-+$/.test(key.replace(/:/g, ''))) continue; // 表头分隔行
    if (!rows.has(key)) rows.set(key, stripCell(cells[1]));
  }
  return rows;
}

function regularFileSize(fullPath: string): number | null {
  try {
    const st = statSync(fullPath);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

/**
 * 判定模块 m 的某个报告阶段是否已完成（不含前沿门；前沿门由派生方按阶段顺序施加）。
 * - 验收 / 冒烟：普通文件，Summary 表「模块」行等于 m，且 Gate 行为 PASS。只读这两行，不做全文匹配。
 * - 部署：普通文件且非空（同名目录、指向目录的链接、0 字节文件都不算）。
 */
export function isModuleReportComplete(root: string, moduleId: string, phase: ReportPhase): boolean {
  const full = join(root, moduleReportPath(moduleId, phase));
  const size = regularFileSize(full);
  if (size === null) return false;
  if (phase === 'deployment') return size > 0;
  let content: string;
  try {
    content = readFileSync(full, 'utf-8');
  } catch {
    return false;
  }
  const rows = readSummaryRows(content);
  let moduleValue: string | undefined;
  for (const [key, value] of rows) {
    if (MODULE_ROW_LABEL_RE.test(key)) { moduleValue = value; break; }
  }
  if (moduleValue !== moduleId) return false;
  return rows.get(GATE_LABEL[phase]) === 'PASS';
}

interface PhaseState { done: boolean; skipped: boolean }

/**
 * 「已完成 phase 之前的空 phase 标 skipped」兜底 + 报告阶段前沿门（§2.99.4）。
 * moduleReports=false 时与原兜底逐行等价；为 true 时报告阶段不作锚点、不被兜底标 skipped，
 * 且只有其前面每个阶段都已 done 或 skipped 才保留 done。
 */
export function applyFallbackSkipAndFrontier(
  keys: readonly string[],
  progress: Record<string, PhaseState>,
  nonFallback: ReadonlySet<string>,
  moduleReports: boolean,
): void {
  const isReport = (k: string) => moduleReports && k in REPORT_PHASE_BY_KEY;
  const lastDoneIdx = keys.reduce((acc, k, i) => (progress[k].done && !isReport(k) ? i : acc), -1);
  for (let i = 0; i < lastDoneIdx; i++) {
    const k = keys[i];
    if (!progress[k].done && !nonFallback.has(k) && !isReport(k)) progress[k].skipped = true;
  }
  if (!moduleReports) return;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!isReport(k) || !progress[k].done) continue;
    const blocked = keys.slice(0, i).some(prev => !progress[prev].done && !progress[prev].skipped);
    if (blocked) progress[k].done = false;
  }
}

/**
 * 原子发布模块报告（§2.99.2）：同目录写完整临时文件后 rename 替换正式路径。
 * 失败时删除临时文件并抛出原错误，正式路径保持写入前的状态（临时文件名以 `.` 开头、不匹配保留路径）。
 */
export function publishReportAtomically(
  fullPath: string,
  content: string,
  writeTmp: (tmpPath: string, content: string) => void = (tmpPath, data) => writeFileSync(tmpPath, data),
): void {
  const dir = dirname(fullPath);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(fullPath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    writeTmp(tmp, content);
    renameSync(tmp, fullPath);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** 已登记模块（含 lifecycle，缺省为 initial）；只读 `logos-project.yaml` 的 modules[]。 */
export function registeredModules(modules: Array<{ id?: unknown; lifecycle?: unknown }> | undefined): Array<{ id: string; lifecycle: 'initial' | 'launched' }> {
  return (modules ?? [])
    .filter(m => typeof m?.id === 'string' && m.id !== '')
    .map(m => ({ id: m.id as string, lifecycle: m.lifecycle === 'launched' ? 'launched' as const : 'initial' as const }));
}

/** 多模块项目中给定模块是否为 initial 模块（模块报告只为它们写入，§2.99.1）。 */
export function isMultiModuleInitial(root: string, moduleId: string | null): boolean {
  if (moduleId === null) return false;
  const modules = registeredModules(readProjectYaml(root).data?.modules);
  return modules.length >= 2 && modules.some(m => m.id === moduleId && m.lifecycle === 'initial');
}

/**
 * 向 `<m>-deployment-report.md` 追加一段（§2.99.7）：以「旧内容 + 新段落」原子发布，首次创建时先写标题。
 * 正式路径存在但不是普通文件（如同名目录）时抛错、不写入。返回相对路径。
 */
export function appendModuleDeploymentReport(
  root: string,
  moduleId: string,
  title: string,
  lines: string[],
  writeTmp?: (tmpPath: string, content: string) => void,
): string {
  const rel = moduleReportPath(moduleId, 'deployment');
  const full = join(root, rel);
  let current = '';
  let exists = false;
  try {
    const st = statSync(full);
    if (!st.isFile()) throw new Error(`${rel} exists but is not a regular file`);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (exists) current = readFileSync(full, 'utf-8');
  const prefix = current === '' ? `${title}\n` : (current.endsWith('\n') ? '' : '\n');
  publishReportAtomically(full, `${current}${prefix}\n${lines.join('\n')}\n`, writeTmp);
  return rel;
}

/** 规范化项目根相对路径（分隔符统一为 `/`，去掉 `./`），用于与保留路径比较。 */
export function normalizeRelPath(path: string): string {
  return posix.normalize(path.trim().replace(/\\/g, '/')).replace(/^\.\//, '');
}

/** 多模块项目中的模块报告保留路径（任一已登记模块的三类模块报告，§2.99.2）。单模块项目为空集。 */
export function reservedModuleReportPaths(root: string): Set<string> {
  const modules = registeredModules(readProjectYaml(root).data?.modules);
  const out = new Set<string>();
  if (modules.length < 2) return out;
  for (const m of modules) for (const phase of ['acceptance', 'deployment', 'smoke'] as const) out.add(moduleReportPath(m.id, phase));
  return out;
}

/** 给定的输出路径中落在保留路径上的项（按 [配置项, 原路径] 返回）。 */
export function reservedPathCollisions(root: string, paths: Array<[string, string | undefined | null]>): Array<[string, string]> {
  const reserved = reservedModuleReportPaths(root);
  if (reserved.size === 0) return [];
  return paths.filter((p): p is [string, string] => typeof p[1] === 'string' && reserved.has(normalizeRelPath(p[1])));
}
