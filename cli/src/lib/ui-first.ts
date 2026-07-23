/**
 * ui-first — proposal-ui-ux-first 切片1 共享库。
 *
 * GUI 项目提案阶段前置 UI/UX 原型确认的公共判定：
 * - product_type 枚举 / GUI 集合 / module-aware 查询（唯一数据源 = logos-project.yaml modules[].product_type）；
 * - 「UI/UX 变更声明」段解析（ui_impact / design_system_mode / 结构化声明页清单）；
 * - module-aware `ui_impact` 派生；
 * - 原型 basename 校验（防路径穿越、命名规范）；
 * - GUI overlay（spec/flow/overlays/gui-ui-first.yaml）读取与项目实例 logos/flow/launched.yaml 的
 *   幂等注入/移除（按 node id 识别、保留用户自定义 ops）。
 *
 * 契约见 spec/proposal-ui-ux-first.md、spec/flow-spec.md、spec/logos-project.md、spec/cli-json-output.md。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { readProjectYaml, type ProjectYamlData, type ProjectYamlModule } from './project-yaml.js';
import { authorityScan } from './markdown-scan.js';

/** product_type 合法枚举（spec/logos-project.md）；固定顺序契约：扩展只允许尾部追加。 */
export const PRODUCT_TYPE_ENUM = ['web', 'desktop', 'mobile', 'cli', 'api', 'library', 'skills', 'service'] as const;
/** GUI 产品类型集合 = {web,desktop,mobile}。 */
export const GUI_PRODUCT_TYPES = new Set<string>(['web', 'desktop', 'mobile']);
/** 方法论 GUI overlay 注入的两个节点 id（按此识别以幂等注入/移除、保留用户 ops）。 */
export const GUI_OVERLAY_NODE_IDS = ['write-ui-prototype', 'verify-ui-provenance'] as const;

export function isValidProductType(pt: unknown): pt is string {
  return typeof pt === 'string' && (PRODUCT_TYPE_ENUM as readonly string[]).includes(pt);
}

/** GUI 判定：product_type ∈ {web,desktop,mobile}；缺失/非法一律非 GUI（安全默认）。 */
export function isGuiProductType(pt: unknown): boolean {
  return typeof pt === 'string' && GUI_PRODUCT_TYPES.has(pt);
}

/** 取某 module 的 product_type（缺失返回 undefined）。 */
export function moduleProductType(mod: ProjectYamlModule | undefined | null): string | undefined {
  return mod?.product_type;
}

/** 项目是否含 ≥1 个 GUI 模块（overlay 项目实例级注入判据）。 */
export function projectHasGuiModule(data: ProjectYamlData | null | undefined): boolean {
  const mods = data?.modules ?? [];
  return mods.some(m => isGuiProductType(m.product_type));
}

/**
 * 列出缺 `product_type` 字段的 launched 模块 id（用于 PRODUCT_TYPE_CONFIRMATION_REQUIRED 诊断）。
 * 仅对 lifecycle==='launched' 的模块检测；缺字段 = 需人工确认回填。按 modules[] 顺序返回（确定性）。
 */
export function modulesMissingProductType(data: ProjectYamlData | null | undefined): string[] {
  const mods = data?.modules ?? [];
  return mods
    .filter(m => m.lifecycle === 'launched' && (m.product_type === undefined || m.product_type === null))
    .map(m => m.id);
}

/** 从项目根读 logos-project.yaml 并返回缺字段 launched 模块 id 列表。 */
export function readModulesMissingProductType(root: string): string[] {
  return modulesMissingProductType(readProjectYaml(root).data);
}

// ── UI/UX 变更声明段解析 ──

export interface UiUxDeclarationPage {
  id: string;
  prototype: string; // basename，如 core-01-home.html
  description: string;
}

export interface UiUxDeclaration {
  ui_impact: boolean;
  design_system_mode?: 'generated' | 'fallback';
  design_system_fallback_reason?: string;
  pages: UiUxDeclarationPage[];
  /** 声明段是否存在。 */
  present: boolean;
}

/**
 * 解析 proposal.md 的「UI/UX 变更声明」段。用 YAML fenced block 承载机器可读字段，
 * 不打断 markdown 结构。段格式（模板注入，见 change.ts / cli-experience）：
 *
 * ## UI/UX 变更声明
 * ```yaml
 * ui_impact: true
 * design_system_mode: generated   # generated | fallback
 * design_system_fallback_reason: ""
 * pages:
 *   - id: home
 *     prototype: core-01-home.html
 *     description: 首页
 * ```
 *
 * 缺段/无法解析 → present:false, ui_impact:false（安全默认）。
 */
/**
 * 权威声明段唯一定位器（code-r2 F11）：结构检查与 legacy 解析消费**同一解析结果**，避免两套 parser 分叉。
 * 标题只认权威掩码外（围栏/缩进代码/HTML 注释之外）的**真实 heading 行**（无 `includes` 宽松分支——
 * 普通正文提及「## UI/UX 变更声明」不构成声明）；YAML fence 按 ```/~~~ 同字符配对。
 */
export function locateUiDeclarationYaml(proposalMd: string):
  | { found: false }
  | { found: true; yamlText: string | null } {
  const lines = proposalMd.split('\n');
  // r3 F11：定位器**全程**消费同一 authorityScan——标题只认掩码外精确 `## UI/UX 变更声明`，
  // fence 只认扫描器承认的权威围栏定界（region fence-open/close，≤3 空格缩进）；
  // HTML 注释、缩进代码中的 YAML fence（region comment/indented）一律不采信。
  const scan = authorityScan(lines);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (scan.masked[i]) continue;
    if (scan.text[i].trim() === '## UI/UX 变更声明') {
      start = i;
      break;
    }
  }
  if (start === -1) return { found: false };
  let fenceStart = -1;
  let fenceEnd = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (fenceStart === -1) {
      if (!scan.masked[i] && /^#{1,6}\s/.test(scan.text[i])) break; // 段结束、无权威 fence
      if (scan.region[i] === 'fence-open') { fenceStart = i; continue; }
      // comment / indented 区域直接跳过——不构成声明 fence
    } else if (scan.region[i] === 'fence-close') {
      fenceEnd = i;
      break;
    }
  }
  if (fenceStart === -1 || fenceEnd === -1) return { found: true, yamlText: null };
  return { found: true, yamlText: lines.slice(fenceStart + 1, fenceEnd).join('\n') };
}

export function parseUiUxDeclaration(proposalMd: string): UiUxDeclaration {
  const empty: UiUxDeclaration = { ui_impact: false, pages: [], present: false };
  if (!proposalMd) return empty;
  const located = locateUiDeclarationYaml(proposalMd);
  if (!located.found) return empty;
  if (located.yamlText === null) return { ...empty, present: true };
  let doc: unknown;
  try {
    doc = parseYaml(located.yamlText);
  } catch {
    return { ...empty, present: true };
  }
  const rec = (doc && typeof doc === 'object' && !Array.isArray(doc)) ? doc as Record<string, unknown> : {};
  const decl: UiUxDeclaration = {
    ui_impact: rec.ui_impact === true,
    pages: [],
    present: true,
  };
  if (rec.design_system_mode === 'generated' || rec.design_system_mode === 'fallback') {
    decl.design_system_mode = rec.design_system_mode;
  } else if (typeof rec.design_system_mode === 'string') {
    // 非法值保留原样以便 checker fail closed
    (decl as { design_system_mode?: string }).design_system_mode = rec.design_system_mode as 'generated' | 'fallback';
  }
  if (typeof rec.design_system_fallback_reason === 'string') {
    decl.design_system_fallback_reason = rec.design_system_fallback_reason;
  }
  if (Array.isArray(rec.pages)) {
    for (const p of rec.pages) {
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        const pr = p as Record<string, unknown>;
        decl.pages.push({
          id: typeof pr.id === 'string' ? pr.id : '',
          prototype: typeof pr.prototype === 'string' ? pr.prototype : '',
          description: typeof pr.description === 'string' ? pr.description : '',
        });
      }
    }
  }
  return decl;
}

/** 读提案目录的 proposal.md 并解析声明段。 */
export function readUiUxDeclaration(proposalDir: string): UiUxDeclaration {
  const p = join(proposalDir, 'proposal.md');
  if (!existsSync(p)) return { ui_impact: false, pages: [], present: false };
  return parseUiUxDeclaration(readFileSync(p, 'utf-8'));
}

// ── S35 change-lint L7：声明段结构分析（坏声明不得被 parse 降级成 false 吞掉）──

export type UiDeclarationStructure =
  | { ok: true; ui_impact: boolean }
  | { ok: false; problem: 'ui_declaration_missing' | 'ui_declaration_unparsable' | 'ui_impact_not_boolean'; detail: string };

/**
 * GUI 项目下声明段的结构化判定（与 parseUiUxDeclaration 的「安全默认」正交）：
 * 缺段 → ui_declaration_missing；无 fenced YAML / YAML 损坏 / 非对象 → ui_declaration_unparsable；
 * `ui_impact` 非布尔 → ui_impact_not_boolean；结构合法 → 返回 ui_impact 布尔值。
 */
export function analyzeUiDeclarationStructure(proposalMd: string): UiDeclarationStructure {
  // code-r2 F11：与 parseUiUxDeclaration 消费**同一个**权威定位器（locateUiDeclarationYaml）——
  // 围栏/缩进代码/HTML 注释内的示例、普通正文提及标题均不构成权威声明。
  const located = locateUiDeclarationYaml(proposalMd);
  if (!located.found) {
    return { ok: false, problem: 'ui_declaration_missing', detail: 'proposal.md 缺少「UI/UX 变更声明」段（GUI 项目为结构必填）' };
  }
  if (located.yamlText === null) {
    return { ok: false, problem: 'ui_declaration_unparsable', detail: '声明段缺少 fenced YAML block' };
  }
  let doc: unknown;
  try {
    doc = parseYaml(located.yamlText);
  } catch (e) {
    return { ok: false, problem: 'ui_declaration_unparsable', detail: `声明段 YAML 损坏：${String(e).slice(0, 120)}` };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, problem: 'ui_declaration_unparsable', detail: '声明段 YAML 不是对象' };
  }
  const uiImpact = (doc as Record<string, unknown>).ui_impact;
  if (typeof uiImpact !== 'boolean') {
    return { ok: false, problem: 'ui_impact_not_boolean', detail: `ui_impact 必须为布尔（得到 ${JSON.stringify(uiImpact)}）` };
  }
  return { ok: true, ui_impact: uiImpact };
}

// ── module-aware ui_impact 派生 ──

/**
 * module-aware `ui_impact` 派生（仿 delta_required）：
 *   = (活跃提案所属 module 的 product_type ∈ GUI) && proposal.md 声明段 ui_impact:true。
 * 非 GUI 模块（含缺字段）恒 false；声明 ui_impact:false 亦 false。
 */
export function deriveUiImpact(root: string, moduleId: string | undefined, proposalDir: string): boolean {
  const data = readProjectYaml(root).data;
  const mod = (data?.modules ?? []).find(m => m.id === moduleId);
  if (!isGuiProductType(mod?.product_type)) return false;
  const decl = readUiUxDeclaration(proposalDir);
  return decl.ui_impact === true;
}

// ── 原型 basename 校验（F3 路径安全 + 命名规范）──

const BASENAME_RE = /^core-\d+-[a-z0-9]+(?:-[a-z0-9]+)*\.html$/;

/**
 * 校验声明 `prototype` 为合法纯 basename：
 * - 无路径分隔（`/`、`\`）、无 `..` 段（防路径穿越）；
 * - 命名符合 `core-NN-<slug>.html`，slug 仅小写字母数字与连字符。
 */
export function isValidPrototypeBasename(s: unknown): s is string {
  if (typeof s !== 'string' || s.length === 0) return false;
  if (s.includes('/') || s.includes('\\')) return false;
  if (s.split(/[\\/]/).some(seg => seg === '..') || s.includes('..')) return false;
  return BASENAME_RE.test(s);
}

// ── GUI overlay 读取与项目实例注入/移除 ──

/** 定位随 CLI 分发的 spec 根（dev：仓库根 spec/；打包：cli/spec/）。 */
export function resolveSpecRoot(root: string): string {
  const candidates = [
    join(root, 'spec'),
    // 打包后 cli/spec（相对本模块 dist/lib/../../spec）
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'spec'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'spec'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'flow', 'overlays', 'gui-ui-first.yaml'))) return c;
  }
  return join(root, 'spec');
}

export interface OverlayAddOp {
  op: 'add' | 'skip' | 'modify' | 'reorder';
  after?: string;
  before?: string;
  target?: string;
  node?: Record<string, unknown>;
  [k: string]: unknown;
}

// ── 前置能力门（F2 R6）：会话 capability 输入通道 ──

/** runlogos → openlogos 的会话能力输入文件（gitignore、私有会话态）。 */
export const SESSION_CAPABILITIES_FILE = join('logos', '.session-capabilities.json');

export interface SessionCapabilities { ui_prototype_render?: boolean }

/**
 * 读 `logos/.session-capabilities.json`（runlogos 会话建立时写）。文件缺失/不可解析 → null（= 降级模式）。
 * **注意（F4 R7）**：capability 仅用于 plan-exit *之前*的模式选择；plan-exit *之后*的强制语义一律以持久化
 * `PLAN_APPROVED` provenance 为准，绝不因 capability 缺失降级。此处仅做「surface 输入」，不做强制判定。
 */
export function readSessionCapabilities(root: string): SessionCapabilities | null {
  const p = join(root, SESSION_CAPABILITIES_FILE);
  if (!existsSync(p)) return null;
  try {
    const doc = JSON.parse(readFileSync(p, 'utf-8'));
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      const rec = doc as Record<string, unknown>;
      return { ui_prototype_render: rec.ui_prototype_render === true };
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * 构造 status/next JSON 与会话上下文的 `capabilities` 段：
 * 仅当能力文件存在且 `ui_prototype_render:true` 时返回 `{ui_prototype_render:true}`；否则 undefined（省略=降级、golden 零漂移）。
 */
export function buildCapabilities(root: string): { ui_prototype_render: true } | undefined {
  const cap = readSessionCapabilities(root);
  return cap?.ui_prototype_render === true ? { ui_prototype_render: true } : undefined;
}

// ── 双阶段发布状态（F2 R7，契约侧判定）──

/** runlogos 关联件的具名依赖 slug。 */
export const UI_UX_PANEL_DEPENDENCY = 'ui-ux-first-panel';
export type ReleaseStatus = 'contract-ready' | 'feature-enabled';

/**
 * 双阶段发布状态机器判定（契约侧）：
 * - feature-enabled **当且仅当** 具名关联 change `ui-ux-first-panel` 已部署 **且** 跨仓端到端 smoke 全绿；
 * - 否则一律 contract-ready（capability-disabled）——只交付契约、默认降级、不得 claim「UI/UX 确认已前移」已启用。
 * 由验收结果机器判定，非人工声称。
 */
export function evaluateReleaseStatus(input: { panelDelivered: boolean; crossRepoSmokePassed: boolean }): ReleaseStatus {
  return input.panelDelivered && input.crossRepoSmokePassed ? 'feature-enabled' : 'contract-ready';
}

/** 读方法论 GUI overlay 唯一源（spec/flow/overlays/gui-ui-first.yaml）的 op 列表。 */
export function loadGuiOverlayOps(root: string): OverlayAddOp[] {
  const p = join(resolveSpecRoot(root), 'flow', 'overlays', 'gui-ui-first.yaml');
  if (!existsSync(p)) return [];
  try {
    const doc = parseYaml(readFileSync(p, 'utf-8'));
    const ops = (doc && typeof doc === 'object' && Array.isArray((doc as Record<string, unknown>).overlay))
      ? (doc as { overlay: OverlayAddOp[] }).overlay
      : [];
    return ops.filter(o => o && typeof o === 'object');
  } catch {
    return [];
  }
}

function overlayOpNodeId(op: OverlayAddOp): string | undefined {
  const node = op.node;
  if (node && typeof node === 'object' && typeof (node as Record<string, unknown>).id === 'string') {
    return (node as Record<string, unknown>).id as string;
  }
  return undefined;
}

const LAUNCHED_INSTANCE_REL = ['logos', 'flow', 'launched.yaml'];

function readInstanceFlow(root: string): { path: string; doc: Record<string, unknown> } {
  const path = join(root, ...LAUNCHED_INSTANCE_REL);
  let doc: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = parseYaml(readFileSync(path, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) doc = parsed as Record<string, unknown>;
    } catch {
      doc = {};
    }
  }
  return { path, doc };
}

/**
 * 幂等注入 GUI overlay 到项目实例 logos/flow/launched.yaml：
 * - 当项目含 ≥1 GUI 模块时调用；
 * - 把 gui-ui-first.yaml 的两个 op:add 并入实例 `overlay:` 列表；
 * - 按 node id 去重（重复 sync 不重复注入）；
 * - 保留实例中已有的用户自定义 overlay ops。
 * 返回是否发生写入变更。
 */
export function injectGuiOverlay(root: string): boolean {
  const ops = loadGuiOverlayOps(root);
  if (ops.length === 0) return false;
  const { path, doc } = readInstanceFlow(root);
  doc.version = doc.version ?? 1;
  doc.flow = doc.flow ?? 'launched';
  if (typeof doc.extends !== 'string') doc.extends = 'builtin:launched@v1';
  const existing: OverlayAddOp[] = Array.isArray(doc.overlay) ? doc.overlay as OverlayAddOp[] : [];
  const guiIds = new Set<string>(GUI_OVERLAY_NODE_IDS);
  const present = new Set(existing.map(overlayOpNodeId).filter(Boolean) as string[]);
  let changed = false;
  const merged = [...existing];
  for (const op of ops) {
    const id = overlayOpNodeId(op);
    if (id && guiIds.has(id) && !present.has(id)) {
      merged.push(op);
      present.add(id);
      changed = true;
    }
  }
  if (!changed && existsSync(path)) return false;
  doc.overlay = merged;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(doc, { lineWidth: 0 }));
  return changed;
}

/**
 * 幂等移除 GUI overlay ops（反向：项目不再含 GUI 模块时）：
 * - 按 node id 移除 write-ui-prototype / verify-ui-provenance；
 * - 用户自定义 overlay ops 一律保留。
 * 返回是否发生写入变更。
 */
export function removeGuiOverlay(root: string): boolean {
  const { path, doc } = readInstanceFlow(root);
  if (!existsSync(path)) return false;
  const existing: OverlayAddOp[] = Array.isArray(doc.overlay) ? doc.overlay as OverlayAddOp[] : [];
  const guiIds = new Set<string>(GUI_OVERLAY_NODE_IDS);
  const kept = existing.filter(op => {
    const id = overlayOpNodeId(op);
    return !(id && guiIds.has(id));
  });
  if (kept.length === existing.length) return false;
  doc.overlay = kept;
  writeFileSync(path, stringifyYaml(doc, { lineWidth: 0 }));
  return true;
}

/** 项目实例 launched.yaml 当前含哪些 GUI overlay 节点 id（用于测试/幂等判定）。 */
export function instanceGuiOverlayNodeIds(root: string): string[] {
  const { doc } = readInstanceFlow(root);
  const existing: OverlayAddOp[] = Array.isArray(doc.overlay) ? doc.overlay as OverlayAddOp[] : [];
  const guiIds = new Set<string>(GUI_OVERLAY_NODE_IDS);
  return existing.map(overlayOpNodeId).filter((id): id is string => Boolean(id) && guiIds.has(id!));
}

/**
 * sync 时按 product_type 幂等对齐 overlay：项目含 ≥1 GUI 模块 → 注入；否则移除。
 * 返回 'injected' | 'removed' | 'unchanged'。
 */
export function syncGuiOverlay(root: string): 'injected' | 'removed' | 'unchanged' {
  const data = readProjectYaml(root).data;
  if (projectHasGuiModule(data)) {
    return injectGuiOverlay(root) ? 'injected' : 'unchanged';
  }
  return removeGuiOverlay(root) ? 'removed' : 'unchanged';
}
