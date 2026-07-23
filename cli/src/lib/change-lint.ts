/**
 * S35 change-lint —— 提案计划产物左移硬检查的共享判据层（change-lint-shift-left）。
 *
 * 定位：`openlogos change-lint` 是既有共享判据函数的**打包调用层**（架构 §二十三）。
 * 不变量：严禁第二份判据——L1/L2/L3/L5 直接复用 proposal-lifecycle.ts 的既有导出；
 * L4（validateMarkdownDelta，fence-aware）在本文件单点实现并由 merge.ts 打包调用；
 * L6 与路径枚举归共享分类器 delta-classify.ts（merge 的 scanDeltas 为其投影）；
 * L7 复用 check-ui-prototype 的纯 evaluator。
 * 只读：本文件所有函数不写任何项目文件 / marker / 哈希清单。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseTaskSections,
  isCodeRequiredForProposal,
  resolveProposalDeploymentDecision,
  evaluateTestIdEvidence,
} from './proposal-lifecycle.js';
import { authorityScan, stripInlineCode } from './markdown-scan.js';
import {
  DELTA_TO_RESOURCE, classifyProposalDeltas, DeltaScanUnreadableError,
  type DeltaEntryClassification, type MergeDisposition, type LintValidity,
} from './delta-classify.js';
import { analyzeUiDeclarationStructure, isGuiProductType } from './ui-first.js';
import { readProjectYaml } from './project-yaml.js';
import { evaluateUiPrototype } from '../commands/check-ui-prototype.js';

// 单一事实源转发：分类器与类别映射归 delta-classify.ts；既有消费方（merge/tests）从本模块继续可见。
export { DELTA_TO_RESOURCE, classifyProposalDeltas, DeltaScanUnreadableError };
export type { DeltaEntryClassification, MergeDisposition, LintValidity };

// ── violation code 闭合注册表（23 码，spec/cli-json-output.md §3.15 为契约唯一枚举源）──

export const CHANGE_LINT_VIOLATION_CODES = [
  // L1–L6（7 码）
  'tasks_sections_unparsable',
  'tasks_code_header_missing',
  'code_change_requires_real_test_ids',
  'delta_missing_section_marker',
  'delta_template_skeleton',
  'deployment_decision_conflict',
  'delta_path_invalid',
  // L7 既有 checker 13 码
  'design_system_mode_invalid',
  'no_pages_declared',
  'prototype_path_traversal',
  'prototype_basename_invalid',
  'prototype_basename_duplicate',
  'prototype_missing',
  'prototype_extra',
  'prototype_empty',
  'design_system_missing',
  'design_system_invalid',
  'design_system_empty',
  'fallback_reason_missing',
  'fallback_token_forged',
  // L7 新增结构 3 码
  'ui_declaration_missing',
  'ui_declaration_unparsable',
  'ui_impact_not_boolean',
] as const;

export type ChangeLintViolationCode = typeof CHANGE_LINT_VIOLATION_CODES[number];

/** 仅 L2/L3/L5 三处语义真实重合携带可选 flow_reason（序列化类型恒为 string）。 */
const FLOW_REASON_MAP: Partial<Record<ChangeLintViolationCode, string>> = {
  tasks_code_header_missing: 'tasks-code-section-missing',
  code_change_requires_real_test_ids: 'code_change_requires_real_test_ids',
  deployment_decision_conflict: 'deployment_decision_conflict',
};

export interface ChangeLintViolation {
  code: ChangeLintViolationCode;
  /** 相对项目根路径。 */
  path: string;
  message: string;
  fix_hint: string;
  flow_reason?: string;
}

// ── L4：validateMarkdownDelta（前置重构②，fence-aware——F4 修正）──

export const SECTION_MARKER_RE = /^##\s+(ADDED|MODIFIED|REMOVED)\b/m;

/**
 * 权威模板占位字面量唯一常量表：覆盖两个权威模板
 * （spec/change-management.md 的 `[新增内容标题]` 系 + 根 Skill change-writer 的 `[新增章节标题]` 系）
 * × ADDED/MODIFIED/REMOVED 全部标题与正文占位变体。
 */
const TEMPLATE_PLACEHOLDER_TITLES = new Set([
  '[新增内容标题]', '[修改内容标题]', '[删除内容标题]',
  '[新增章节标题]', '[修改章节标题]', '[删除章节标题]',
]);
const TEMPLATE_PLACEHOLDER_BODY_LINES = new Set([
  '[新增的完整内容]',
  '[修改后的完整内容，替换主文档中同名章节]',
  '[说明删除原因]',
  '[修改后的完整内容，merge 时替换主文档中同名章节]',
  '[说明删除原因，merge 时删除主文档中同名章节]',
]);

export interface MarkdownDeltaValidation {
  missingSectionMarker: boolean;
  templateSkeleton: boolean;
  /** 命中的占位行/占位标题（供 message 定位）。 */
  skeletonHits: string[];
}

/**
 * `.md` delta 结构校验（结构规则而非全文词表，**同一份 fence-aware 扫描**同时判两结论——F4）：
 * - missingSectionMarker：围栏外无任何 ADDED/MODIFIED/REMOVED 段标记（围栏内示例不算权威标记）；
 * - templateSkeleton：围栏外 (a) marker 标题本身是占位标题，或 (b) 存在任一独占一行的权威模板
 *   占位符行——不要求正文全部由占位构成，真实内容与残留占位行混合的部分模板同样命中；
 *   行内代码、代码围栏中的引用不得命中。
 */
export function validateMarkdownDelta(content: string): MarkdownDeltaValidation {
  const lines = content.split(/\r?\n/);
  const scan = authorityScan(lines);
  let hasMarker = false;
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (scan.masked[i]) continue; // 围栏/缩进代码/HTML 注释内的引用不构成权威结构、不得命中
    const trimmed = scan.text[i].trim();
    const markerMatch = trimmed.match(/^##\s+(?:ADDED|MODIFIED|REMOVED)\b\s*(?:[—-]\s*(.+))?$/);
    if (markerMatch) {
      hasMarker = true;
      const title = stripInlineCode(markerMatch[1] ?? '').trim();
      if (TEMPLATE_PLACEHOLDER_TITLES.has(title)) hits.push((markerMatch[1] ?? '').trim());
      continue;
    }
    const body = stripInlineCode(trimmed).trim();
    if (TEMPLATE_PLACEHOLDER_BODY_LINES.has(body)) hits.push(trimmed);
  }
  return { missingSectionMarker: !hasMarker, templateSkeleton: hits.length > 0, skeletonHits: hits };
}

// ── 前置重构⑤：共享 proposal-context resolver（模块归属单一事实源）──

/**
 * 自 merge.ts 私有 readProposalModule 提取：读 proposal.md 头部 `> module: <id>`（持久事实源）。
 * F11：只认**围栏外**的头行——围栏内示例不构成权威 module 声明。
 */
export function readProposalModuleHeader(proposalDir: string): string | undefined {
  const p = join(proposalDir, 'proposal.md');
  if (!existsSync(p)) return undefined;
  try {
    const lines = readFileSync(p, 'utf-8').split(/\r?\n/);
    const scan = authorityScan(lines);
    for (let i = 0; i < lines.length; i++) {
      if (scan.masked[i]) continue; // r2 F11：围栏/缩进代码/HTML 注释内的示例头不构成权威 module 声明
      const m = /^>\s*module:\s*([a-z][a-z0-9-]*)\s*$/i.exec(scan.text[i].trim());
      if (m) return m[1];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readGuardFile(root: string): { activeChange?: string; module?: string } | null {
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (!existsSync(guardPath)) return null;
  try {
    const g = JSON.parse(readFileSync(guardPath, 'utf-8'));
    return (g && typeof g === 'object') ? g : null;
  } catch { return null; }
}

export type ProposalModuleResolution =
  | { ok: true; moduleId: string; productType?: string; isGui: boolean }
  | { ok: false; detail: string };

/**
 * 模块归属解析（module-aware 判据的唯一权威，含 L7 与 merge 的 UI 门——F1）：
 * ① proposal.md 头 `> module:` 优先（持久事实源）；② 头缺失且 guard.activeChange==slug 才回退 guard.module；
 * ③ 冲突以头为准；④ 无法解析或模块不在 logos-project.yaml → fail-closed（module_unresolved，不得静默按非 GUI 跳过）。
 */
export function resolveProposalModuleContext(root: string, proposalDir: string, slug: string): ProposalModuleResolution {
  const header = readProposalModuleHeader(proposalDir);
  let moduleId = header;
  if (!moduleId) {
    const guard = readGuardFile(root);
    if (guard && guard.activeChange === slug && typeof guard.module === 'string' && guard.module) {
      moduleId = guard.module;
    }
  }
  if (!moduleId) {
    return { ok: false, detail: '无法解析提案所属模块（proposal.md 缺 "> module:" 头且 guard 不指向该提案）' };
  }
  const modules = readProjectYaml(root).data?.modules ?? [];
  const mod = modules.find(m => m.id === moduleId);
  if (!mod) {
    return { ok: false, detail: `提案声明模块 '${moduleId}' 不存在于 logos-project.yaml` };
  }
  return { ok: true, moduleId, productType: mod.product_type, isGui: isGuiProductType(mod.product_type) };
}

// ── 打包调用层：L1–L7 聚合（纯 evaluator，只读）──

export type ChangeLintOpErrorCode =
  | 'not_initialized'
  | 'no_active_proposal'
  | 'slug_not_found'
  | 'slug_invalid'
  | 'module_unresolved'
  | 'artifact_unreadable';

export type ChangeLintRunResult =
  | { ok: true; slug: string; violations: ChangeLintViolation[]; checks: { id: number; label: string; violations: number }[] }
  | { ok: false; errorCode: ChangeLintOpErrorCode; message: string };

/** 严格 slug 词法（spec §2.30；r2 F18）：不匹配者仅当历史目录实际存在时走只读兼容，否则 slug_invalid。 */
export const SLUG_STRICT_RE = /^[a-z0-9][a-z0-9-]*$/;

/** slug 词法硬拒绝：空值、路径分隔符、`.`、`..`、绝对路径（F8：显式 flag 缺值同拒）。 */
export function isDangerousSlug(slug: string): boolean {
  if (!slug) return true;
  if (slug === '.' || slug === '..') return true;
  if (/[\\/]/.test(slug)) return true;
  if (slug.startsWith('/') || /^[A-Za-z]:/.test(slug)) return true;
  return false;
}

interface CheckAcc {
  violations: ChangeLintViolation[];
  seq: Map<string, number>;
  order: Map<ChangeLintViolation, { check: number; seq: number }>;
}

function pushViolation(acc: CheckAcc, check: number, v: ChangeLintViolation): void {
  const flowReason = FLOW_REASON_MAP[v.code];
  const out: ChangeLintViolation = flowReason ? { ...v, flow_reason: flowReason } : v;
  const key = `${check}|${out.path}`;
  const seq = acc.seq.get(key) ?? 0;
  acc.seq.set(key, seq + 1);
  acc.order.set(out, { check, seq });
  acc.violations.push(out);
}

/**
 * 对提案目录运行 L1–L7 全部检查并按全序稳定排序返回。
 * 读取顺序（操作错误即终止红线由调用方 change-lint 命令实现）：
 * proposal.md（含 module resolver）→ tasks.md → deltas/**（含全量可读性探测——F7）。
 */
export function runChangeLint(root: string, proposalDir: string, slug: string): ChangeLintRunResult {
  let proposalContent = '';
  let tasksContent = '';
  const proposalPath = join(proposalDir, 'proposal.md');
  const tasksPath = join(proposalDir, 'tasks.md');
  try {
    if (existsSync(proposalPath)) proposalContent = readFileSync(proposalPath, 'utf-8');
  } catch {
    return { ok: false, errorCode: 'artifact_unreadable', message: `无法读取 logos/changes/${slug}/proposal.md` };
  }

  // 模块归属解析（module-aware 判据的唯一权威；proposal.md 步内、tasks.md 前）
  const moduleCtx = resolveProposalModuleContext(root, proposalDir, slug);
  if (!moduleCtx.ok) {
    return { ok: false, errorCode: 'module_unresolved', message: moduleCtx.detail };
  }

  try {
    if (existsSync(tasksPath)) tasksContent = readFileSync(tasksPath, 'utf-8');
  } catch {
    return { ok: false, errorCode: 'artifact_unreadable', message: `无法读取 logos/changes/${slug}/tasks.md` };
  }

  // deltas/**：共享分类器一次遍历（F2）；枚举/元数据 IO 错误与任一 mergeable 条目不可读 → artifact_unreadable（F7）
  const deltaEntries = classifyProposalDeltas(proposalDir);
  const ioBroken = deltaEntries.find(e => e.ioError);
  if (ioBroken) {
    return { ok: false, errorCode: 'artifact_unreadable', message: `logos/changes/${slug}/${ioBroken.relativePath}：${ioBroken.ioError}` };
  }
  // r2 F3 + r5 F7：内容探测范围 = 分类器标记的 contentProbeEligible 条目（本地普通文件 / 边界内
  // 目标为普通文件的 symlink），与 mergeDisposition/lintValidity 正交——reference/隐藏/unknown 等
  // 被 L6 忽略或判非法的**本地**文件同样探测（「delta 任一不可读 → artifact_unreadable」是操作级
  // 红线）；逃逸/断链 symlink、目录与非常规文件恒不解引用（不读提案边界外目标）。按分类器输出的
  // 稳定路径序探测，首个失败即终止（不再读取后序产物）。
  const deltaContents = new Map<string, string>();
  for (const entry of deltaEntries) {
    if (!entry.contentProbeEligible) continue;
    try {
      deltaContents.set(entry.relativePath, readFileSync(join(proposalDir, entry.relativePath), 'utf-8'));
    } catch {
      return { ok: false, errorCode: 'artifact_unreadable', message: `无法读取 logos/changes/${slug}/${entry.relativePath}` };
    }
  }

  const relTasks = `logos/changes/${slug}/tasks.md`;
  const relProposal = `logos/changes/${slug}/proposal.md`;
  const acc: CheckAcc = { violations: [], seq: new Map(), order: new Map() };

  const sections = parseTaskSections(tasksContent);
  const codeRequired = isCodeRequiredForProposal(proposalDir, tasksContent, sections);

  // L1：tasks.md 结构可解析（≥1 个 `## [tag]` 标题）
  if (sections === null) {
    pushViolation(acc, 1, {
      code: 'tasks_sections_unparsable',
      path: relTasks,
      message: 'tasks.md 无任何 `## [tag]` section 标题，结构不可解析',
      fix_hint: '按 tasks 结构化格式补 `## [delta]` / `## [code]` / `## [deploy]` section 标题（至少一个）',
    });
  }

  // L2：需代码的提案有 `## [code]` 标题（空段占位合法）
  if (codeRequired && sections !== null && !Object.prototype.hasOwnProperty.call(sections, 'code')) {
    pushViolation(acc, 2, {
      code: 'tasks_code_header_missing',
      path: relTasks,
      message: '需代码的提案缺少 ## [code] 标题',
      fix_hint: '在 tasks.md 保留空 `## [code] 代码实现` 标题（切片由 merge 后 slice-planner 填写）',
    });
  }

  // L3：分阶段测试证据模型（仅 code_required 提案）
  if (codeRequired) {
    const evidence = evaluateTestIdEvidence(proposalDir, tasksContent);
    for (const entry of evidence.reuse.entries) {
      if (entry.problem === null) continue;
      const problemLabel = entry.problem === 'syntax' ? '语法非法（每行须为 `- <ID> — <一句话用途>` 且 ID 满足闭合文法）'
        : entry.problem === 'duplicate' ? '重复的复用 ID'
          : 'ID 不存在于已合并 logos/resources/test/ 规格的结构化 ID 列';
      pushViolation(acc, 3, {
        code: 'code_change_requires_real_test_ids',
        path: relProposal,
        message: `复用测试 ID 声明第 ${evidence.reuse.entries.indexOf(entry) + 1} 项${problemLabel}：${entry.line}`,
        fix_hint: '修正该行为 `- <已存在的具体 ID> — <一句话用途>`，或删除该行；ID 须精确存在于已合并测试规格表格首列',
      });
    }
    if (!evidence.evidenceOk) {
      pushViolation(acc, 3, {
        code: 'code_change_requires_real_test_ids',
        path: relTasks,
        message: `需代码的提案在当前证据等级（${evidence.stage}）下无可采信的 UT/ST/SMOKE ID`,
        fix_hint: '在 tasks.md 的 [delta] 规划测试规格 delta（目标含 `deltas/test/`），或在 proposal.md 的「## 复用测试 ID」小节按固定语法列出已存在的具体 ID（如 UT-S09-02）',
      });
    }
  }

  // L4 / L6：仅对已存在 delta 文件
  for (const entry of deltaEntries) {
    const relPath = `logos/changes/${slug}/${entry.relativePath}`;
    if (entry.lintValidity === 'invalid') {
      pushViolation(acc, 6, {
        code: 'delta_path_invalid',
        path: relPath,
        message: `delta 路径非法：${entry.invalidReason ?? '未知原因'}`,
        fix_hint: '把 delta 移到合法类别目录（prd/api/database/scenario/test/spec/skills），并确保不经 symlink 逃逸提案目录',
      });
    }
    const isPrototypeAsset = entry.relativePath.includes('/2-product-design/2-page-design/') && entry.relativePath.endsWith('.html');
    if (entry.mergeDisposition === 'mergeable' && entry.lintValidity === 'valid' && entry.relativePath.endsWith('.md') && !isPrototypeAsset) {
      const v = validateMarkdownDelta(deltaContents.get(entry.relativePath) ?? '');
      if (v.missingSectionMarker) {
        pushViolation(acc, 4, {
          code: 'delta_missing_section_marker',
          path: relPath,
          message: '`.md` delta 缺少围栏外的 ADDED/MODIFIED/REMOVED 段标记（围栏内示例不算权威标记）',
          fix_hint: '为每个变更章节添加 `## ADDED — <标题>` / `## MODIFIED — <标题>` / `## REMOVED — <标题>` 标记',
        });
      }
      if (v.templateSkeleton) {
        pushViolation(acc, 4, {
          code: 'delta_template_skeleton',
          path: relPath,
          message: `delta 残留未替换的模板占位字面量：${v.skeletonHits[0]}${v.skeletonHits.length > 1 ? ` 等 ${v.skeletonHits.length} 处` : ''}`,
          fix_hint: '把模板占位字面量（如 `[新增章节标题]`、`[新增的完整内容]`）替换为真实内容——只要残留任一独占占位行即被 lint 与 merge 拒绝',
        });
      }
    }
  }

  // L5：部署决策一致性
  const deployment = resolveProposalDeploymentDecision(proposalDir);
  if (deployment.deployment_decision_conflict) {
    pushViolation(acc, 5, {
      code: 'deployment_decision_conflict',
      path: relProposal,
      message: deployment.deployment_decision_conflict_reason ?? 'proposal 部署声明与 tasks.md [deploy] section 冲突',
      fix_hint: '需要部署 → tasks.md 增加 [deploy] section；无需部署 → 删除 [deploy] section 或把 proposal.md 部署影响改为「否」',
    });
  }

  // L7：仅 GUI 项目（resolver 判定 product_type ∈ GUI）
  const guiActive = moduleCtx.isGui;
  if (guiActive) {
    const structure = analyzeUiDeclarationStructure(proposalContent);
    if (!structure.ok) {
      pushViolation(acc, 7, {
        code: structure.problem,
        path: relProposal,
        message: structure.detail,
        fix_hint: '在 proposal.md 写入「## UI/UX 变更声明」段（fenced YAML：ui_impact 布尔、design_system_mode、pages 清单）',
      });
    } else if (structure.ui_impact) {
      const outcome = evaluateUiPrototype(proposalDir);
      if (outcome.code !== 0) {
        const code = (CHANGE_LINT_VIOLATION_CODES as readonly string[]).includes(outcome.errorCode ?? '')
          ? outcome.errorCode as ChangeLintViolationCode
          : 'design_system_mode_invalid';
        pushViolation(acc, 7, {
          code,
          path: relProposal,
          message: outcome.reason,
          fix_hint: '按 ui-ux-first 可交付要求补齐：声明清单 == 产出文件（逐页非空）、design_system_mode 分档令牌规则',
        });
      }
    }
  }

  // 全序稳定排序：①检查项 L1→L7；②path 字典序；③源位置出现序；④code；⑤message
  const sorted = [...acc.violations].sort((a, b) => {
    const oa = acc.order.get(a)!;
    const ob = acc.order.get(b)!;
    if (oa.check !== ob.check) return oa.check - ob.check;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (oa.seq !== ob.seq) return oa.seq - ob.seq;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });

  const mergeableCount = deltaEntries.filter(e => e.mergeDisposition === 'mergeable').length;
  const invalidCount = deltaEntries.filter(e => e.lintValidity === 'invalid').length;
  const mdDeltaCount = deltaEntries.filter(e => e.mergeDisposition === 'mergeable' && e.relativePath.endsWith('.md')).length;
  const countFor = (check: number) => sorted.filter(v => acc.order.get(v)!.check === check).length;

  const checks: { id: number; label: string; violations: number }[] = [
    { id: 1, label: 'tasks.md 结构可解析', violations: countFor(1) },
    { id: 2, label: '[code] 标题在场（空段占位合法）', violations: countFor(2) },
    { id: 3, label: '测试证据在场（分阶段证据模型）', violations: countFor(3) },
    { id: 4, label: `delta 段标记与脱模板（${mdDeltaCount} 个 .md delta）`, violations: countFor(4) },
    { id: 5, label: '部署决策一致', violations: countFor(5) },
    { id: 6, label: `delta 路径合法（${mergeableCount} mergeable / ${invalidCount} invalid）`, violations: countFor(6) },
    ...(guiActive ? [{ id: 7, label: 'UI 声明结构合法', violations: countFor(7) }] : []),
  ];

  return { ok: true, slug, violations: sorted, checks };
}
