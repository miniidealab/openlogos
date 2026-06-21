/**
 * flow loader — 加载内置 flow 模板、解析项目 overlay，输出 resolved flow。
 *
 * 规范来源：spec/flow-spec.md、spec/cli-json-output.md（§9 flow show）。
 * 切片 A（flow-engine-foundation）：仅供 `flow show` 消费，不接入 status / next 派生（零行为变更）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readProjectYaml } from './project-yaml.js';

export type Lifecycle = 'initial' | 'launched';

export type FlowErrorCode =
  | 'PROJECT_NOT_INITIALIZED'
  | 'FLOW_NOT_FOUND'
  | 'FLOW_SCHEMA_INVALID'
  | 'FLOW_CMD_SPAWN_FAILED';

export class FlowError extends Error {
  constructor(public code: FlowErrorCode, message: string) {
    super(message);
    this.name = 'FlowError';
  }
}

export type OverlayOp = 'skip' | 'add' | 'modify' | 'reorder';

export interface FlowGate {
  type: 'none' | 'human' | 'cmd';
  position?: 'entry' | 'exit';
  skippable?: boolean;
}

export interface FlowNode {
  id: string;
  name: string;
  skill?: string | null;
  working_agent?: string | null;
  review_agent?: string | null;
  when?: string | null;
  for_each?: string | null;
  produces?: string | null;
  done_when?: string | null;
  fail_when?: string | null;
  pre_script?: string | null;
  post_script?: string | null;
  cmd_timeout_seconds?: number | null; // M2-1b：节点级 cmd: 超时（整数 ≥1）
  // resolved 输出专用（见 spec/cli-json-output.md §9）
  skipped?: boolean;
  overlay_op?: OverlayOp | null;
}

/** subflow 循环（见 spec/flow-spec.md §6）。M2 切片 2：max_iters>1 + until:tests_green 点亮真迭代。 */
export interface FlowLoop {
  until?: string | null;       // 收敛谓词，本切片仅枚举 'tests_green'
  max_iters?: number | null;   // 整数 ≥1；>1 才真迭代（仅 overlay set-loop 激活）
}

export interface FlowSubflow {
  id: string;
  name: string;
  when?: string | null;
  loop?: FlowLoop | null;
  gate?: FlowGate;
  nodes: FlowNode[];
}

export interface Flow {
  flow: string;
  version: number;
  extends?: string | null;
  subflows: FlowSubflow[];
}

export interface FlowWarning {
  code: string;
  message: string;
}

export interface LoadFlowResult {
  lifecycle: Lifecycle;
  resolved: boolean;
  overlay_applied: boolean;
  builtin_version: string;
  warnings: FlowWarning[];
  flow: Flow;
}

/**
 * 内置模板内容版本来源（见 spec/flow-spec.md §10.1）：由 loader 维护映射，
 * 作为 builtin_version 输出与 overlay @vN 比对的唯一依据。内置模板内容破坏性变更时必须 bump。
 * 禁止复用文件 version（schema 版本）。
 */
export const BUILTIN_VERSIONS: Record<Lifecycle, string> = {
  initial: 'v1',
  launched: 'v1',
};

/**
 * 定位包内内置模板目录 spec/flow。覆盖 dev / test / prepack 三种运行路径：
 * - 已发布包 / prepack 后：<pkgroot>/spec/flow（= 模块目录上溯两级）
 * - dev / 测试（从仓库源码运行）：<repo>/spec/flow（= 上溯三级）
 */
function resolveBuiltinDir(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, '../../spec/flow'), // 发布包内 prepack 拷贝
    join(moduleDir, '../../../spec/flow'), // dev / 测试：仓库根
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function readYamlFile(path: string, what: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new FlowError('FLOW_NOT_FOUND', `${what} 不存在：${path}`);
  }
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `${what} YAML 解析失败：${(e as Error).message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `${what} 顶层必须是对象`);
  }
  return doc as Record<string, unknown>;
}

/** 基础 schema 校验（见 spec/flow-spec.md）。不合法抛 FLOW_SCHEMA_INVALID。 */
export function validateFlow(flow: unknown, what = 'flow'): asserts flow is Flow {
  const f = flow as Record<string, unknown>;
  if (typeof f.flow !== 'string') {
    throw new FlowError('FLOW_SCHEMA_INVALID', `${what} 缺少顶层 string 字段 \`flow\``);
  }
  if (typeof f.version !== 'number') {
    throw new FlowError('FLOW_SCHEMA_INVALID', `${what} 缺少顶层整数字段 \`version\``);
  }
  if (!Array.isArray(f.subflows)) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `${what} 缺少 \`subflows\` 数组`);
  }
  for (const [si, sub] of (f.subflows as unknown[]).entries()) {
    const s = sub as Record<string, unknown>;
    if (!s || typeof s.id !== 'string') {
      throw new FlowError('FLOW_SCHEMA_INVALID', `${what} subflows[${si}] 缺少 \`id\``);
    }
    if (!Array.isArray(s.nodes)) {
      throw new FlowError('FLOW_SCHEMA_INVALID', `${what} subflow \`${s.id}\` 缺少 \`nodes\` 数组`);
    }
    // M2-2：subflow.loop 校验——max_iters 整数 ≥1、until 仅 'tests_green'
    if (s.loop != null) {
      if (typeof s.loop !== 'object' || Array.isArray(s.loop)) {
        throw new FlowError('FLOW_SCHEMA_INVALID', `${what} subflow \`${s.id}\` 的 \`loop\` 须为对象`);
      }
      const lp = s.loop as Record<string, unknown>;
      if (lp.max_iters != null
        && (typeof lp.max_iters !== 'number' || !Number.isInteger(lp.max_iters) || lp.max_iters < 1)) {
        throw new FlowError('FLOW_SCHEMA_INVALID', `${what} subflow \`${s.id}\` 的 loop.max_iters 须为整数 ≥ 1`);
      }
      if (lp.until != null && lp.until !== 'tests_green') {
        throw new FlowError('FLOW_SCHEMA_INVALID', `${what} subflow \`${s.id}\` 的 loop.until 仅支持 \`tests_green\``);
      }
    }
    for (const [ni, node] of (s.nodes as unknown[]).entries()) {
      const n = node as Record<string, unknown>;
      if (!n || typeof n.id !== 'string') {
        throw new FlowError('FLOW_SCHEMA_INVALID', `${what} subflow \`${s.id}\` nodes[${ni}] 缺少 \`id\``);
      }
      if (typeof n.name !== 'string') {
        throw new FlowError('FLOW_SCHEMA_INVALID', `${what} node \`${n.id}\` 缺少 \`name\``);
      }
      // M2-1b：节点级 cmd_timeout_seconds 须整数 ≥1
      if (n.cmd_timeout_seconds != null
        && (typeof n.cmd_timeout_seconds !== 'number' || !Number.isInteger(n.cmd_timeout_seconds) || n.cmd_timeout_seconds < 1)) {
        throw new FlowError('FLOW_SCHEMA_INVALID', `${what} node \`${n.id}\` 的 cmd_timeout_seconds 须为整数 ≥ 1`);
      }
    }
  }
}

/** 读取并校验内置模板。lifecycle 对应模板缺失 → FLOW_NOT_FOUND。 */
export function loadBuiltinFlow(lifecycle: Lifecycle): Flow {
  const dir = resolveBuiltinDir();
  if (!dir) {
    throw new FlowError('FLOW_NOT_FOUND', '找不到内置 flow 模板目录 spec/flow');
  }
  const available = readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => f.replace(/\.yaml$/, ''));
  if (!available.includes(lifecycle)) {
    throw new FlowError(
      'FLOW_NOT_FOUND',
      `内置模板 spec/flow/${lifecycle}.yaml 不存在（可用：${available.join(', ') || '无'}）`,
    );
  }
  const doc = readYamlFile(join(dir, `${lifecycle}.yaml`), `内置模板 ${lifecycle}`);
  validateFlow(doc, `内置模板 ${lifecycle}`);
  return doc;
}

/** 由 logos-project.yaml 模块状态推断默认 lifecycle（任一 launched → launched）。 */
export function inferLifecycle(root: string): Lifecycle {
  const { data } = readProjectYaml(root);
  return data?.modules?.some(m => m.lifecycle === 'launched') ? 'launched' : 'initial';
}

interface OverlayDoc {
  extends?: string;
  overlay?: Array<Record<string, unknown>>;
}

/** 读取项目 overlay（logos/flow/<lifecycle>.yaml）；不存在返回 null。 */
export function readOverlay(root: string, lifecycle: Lifecycle): OverlayDoc | null {
  const path = join(root, 'logos', 'flow', `${lifecycle}.yaml`);
  if (!existsSync(path)) return null;
  const doc = readYamlFile(path, `overlay ${lifecycle}`);
  return doc as OverlayDoc;
}

/** 解析 `builtin:initial@v1` → { baseline, version }；无 @vN 时 version 为 null。 */
export function parseExtends(value: string): { baseline: string; version: string | null } {
  const m = /^builtin:([A-Za-z0-9_-]+)(?:@(v[0-9A-Za-z.]+))?$/.exec(value.trim());
  if (!m) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `overlay \`extends\` 格式非法：${value}`);
  }
  return { baseline: m[1], version: m[2] ?? null };
}

function findNode(flow: Flow, id: string): { subflow: FlowSubflow; index: number } | null {
  for (const sub of flow.subflows) {
    const index = sub.nodes.findIndex(n => n.id === id);
    if (index !== -1) return { subflow: sub, index };
  }
  return null;
}

/** 把 overlay 应用到内置 flow（深拷贝后修改），返回 resolved flow + 告警。 */
export function applyOverlay(
  builtin: Flow,
  overlay: OverlayDoc,
  lifecycle: Lifecycle,
): { flow: Flow; warnings: FlowWarning[] } {
  const flow: Flow = JSON.parse(JSON.stringify(builtin));
  const warnings: FlowWarning[] = [];

  if (overlay.extends != null) {
    if (typeof overlay.extends !== 'string') {
      throw new FlowError('FLOW_SCHEMA_INVALID', 'overlay `extends` 必须是字符串');
    }
    const { baseline, version } = parseExtends(overlay.extends);
    if (baseline !== lifecycle) {
      throw new FlowError(
        'FLOW_SCHEMA_INVALID',
        `overlay \`extends\` 基线 \`${baseline}\` 与当前 lifecycle \`${lifecycle}\` 不一致`,
      );
    }
    flow.extends = overlay.extends;
    if (version && version !== BUILTIN_VERSIONS[lifecycle]) {
      warnings.push({
        code: 'FLOW_VERSION_MISMATCH',
        message: `overlay 引用 ${overlay.extends}，内置模板当前为 ${BUILTIN_VERSIONS[lifecycle]}，请复核 overlay 是否仍引用有效 node id`,
      });
    }
  }

  if (overlay.overlay !== undefined && !Array.isArray(overlay.overlay)) {
    throw new FlowError('FLOW_SCHEMA_INVALID', 'overlay 的 `overlay` 字段必须是操作数组');
  }
  const ops = Array.isArray(overlay.overlay) ? overlay.overlay : [];
  for (const [oi, opRaw] of ops.entries()) {
    if (!opRaw || typeof opRaw !== 'object' || Array.isArray(opRaw)) {
      throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] 必须是对象`);
    }
    const op = opRaw as Record<string, unknown>;
    const kind = op.op;
    if (kind === 'skip') {
      const hit = findNode(flow, String(op.target));
      if (!hit) throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] skip 的 target \`${op.target}\` 不存在`);
      hit.subflow.nodes[hit.index].skipped = true;
      hit.subflow.nodes[hit.index].overlay_op = 'skip';
    } else if (kind === 'modify') {
      const hit = findNode(flow, String(op.target));
      if (!hit) throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] modify 的 target \`${op.target}\` 不存在`);
      if (!op.set || typeof op.set !== 'object' || Array.isArray(op.set)) {
        throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] modify 缺少合法 \`set\`（需为非空对象）`);
      }
      // op:modify 禁止覆盖 id——改写内置节点身份会破坏 node→phase 映射（见 spec/flow-spec.md §10）
      if ('id' in (op.set as Record<string, unknown>)) {
        throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] modify 不得覆盖 \`id\`（禁止改写节点身份）`);
      }
      Object.assign(hit.subflow.nodes[hit.index], op.set);
      hit.subflow.nodes[hit.index].overlay_op = 'modify';
    } else if (kind === 'add') {
      const node = op.node as FlowNode | undefined;
      if (!node || typeof node.id !== 'string' || typeof node.name !== 'string') {
        throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] add 缺少合法 \`node\`（需含 string \`id\` 与 \`name\`）`);
      }
      if (findNode(flow, node.id)) {
        throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] add 的 node id \`${node.id}\` 已存在（重复）`);
      }
      const anchorId = String(op.after ?? op.before ?? '');
      const hit = findNode(flow, anchorId);
      if (!hit) throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] add 的锚点 \`${anchorId}\` 不存在`);
      const at = op.after ? hit.index + 1 : hit.index;
      hit.subflow.nodes.splice(at, 0, { ...node, overlay_op: 'add' });
    } else if (kind === 'reorder') {
      const hit = findNode(flow, String(op.target));
      if (!hit) throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] reorder 的 target \`${op.target}\` 不存在`);
      const [moved] = hit.subflow.nodes.splice(hit.index, 1);
      moved.overlay_op = 'reorder';
      const anchorId = String(op.after ?? op.before ?? '');
      const anchor = findNode(flow, anchorId);
      if (!anchor) throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] reorder 的锚点 \`${anchorId}\` 不存在`);
      const at = op.after ? anchor.index + 1 : anchor.index;
      anchor.subflow.nodes.splice(at, 0, moved);
    } else if (kind === 'set-loop') {
      // M2 切片 2：覆盖某 subflow 的 loop（subflow 级，非 node 级）
      const subId = String(op.subflow ?? '');
      const sub = flow.subflows.find(s => s.id === subId);
      if (!sub) throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] set-loop 的 subflow \`${subId}\` 不存在`);
      if (!op.set || typeof op.set !== 'object' || Array.isArray(op.set)) {
        throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] set-loop 缺少合法 \`set\`（需为非空对象）`);
      }
      // set 字段白名单（R9）：仅 max_iters / until，未知 key → FLOW_SCHEMA_INVALID（不静默保留）
      for (const key of Object.keys(op.set as Record<string, unknown>)) {
        if (key !== 'max_iters' && key !== 'until') {
          throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] set-loop 的 set 含未知字段 \`${key}\`（仅允许 max_iters / until）`);
        }
      }
      // 本切片 loop 真迭代仅支持 implement(code/verify)；非 implement 上 max_iters>1 语义不成立（账本由 verify 写）→ fail loud
      const setMaxIters = (op.set as FlowLoop).max_iters;
      if (subId !== 'implement' && typeof setMaxIters === 'number' && setMaxIters > 1) {
        throw new FlowError('FLOW_SCHEMA_INVALID',
          `overlay[${oi}] set-loop 的真迭代（max_iters>1）本切片仅支持 \`implement\` 子流程，不支持 \`${subId}\``);
      }
      sub.loop = { ...(sub.loop ?? {}), ...(op.set as FlowLoop) };
    } else {
      throw new FlowError('FLOW_SCHEMA_INVALID', `overlay[${oi}] 含未知 op \`${String(kind)}\``);
    }
  }

  // 合并后对 resolved flow 做完整 schema 校验 + node id 全局唯一性兜底，杜绝半成品输出
  validateFlow(flow, 'resolved flow');
  const ids = flow.subflows.flatMap(s => s.nodes.map(n => n.id));
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `resolved flow 存在重复 node id \`${dup}\``);
  }

  return { flow, warnings };
}

/**
 * 找到被激活（loop.max_iters > 1）的 subflow；无则 null。本切片仅 implement 子流程会带。
 * 激活 = overlay `set-loop` 把 max_iters 设 >1（builtin 恒为 1，故无激活 → golden 零漂移）。
 */
export function findActivatedLoop(flow: Flow): { subflow_id: string; until: string; max_iters: number } | null {
  for (const sub of flow.subflows) {
    if (sub.id !== 'implement') continue; // 本切片真迭代仅 implement(code/verify)
    const mi = sub.loop?.max_iters;
    if (typeof mi === 'number' && mi > 1) {
      return { subflow_id: sub.id, until: sub.loop?.until ?? 'tests_green', max_iters: mi };
    }
  }
  return null;
}

export interface LoadFlowOptions {
  lifecycle?: Lifecycle;
  resolved?: boolean;
}

/**
 * 加载 flow：默认内置 raw flow；resolved=true 时叠加项目 overlay。
 * lifecycle 缺省按项目状态推断。
 */
export function loadFlow(root: string, opts: LoadFlowOptions = {}): LoadFlowResult {
  const lifecycle = opts.lifecycle ?? inferLifecycle(root);
  const builtin = loadBuiltinFlow(lifecycle);
  const builtin_version = BUILTIN_VERSIONS[lifecycle];

  if (!opts.resolved) {
    return { lifecycle, resolved: false, overlay_applied: false, builtin_version, warnings: [], flow: builtin };
  }

  const overlay = readOverlay(root, lifecycle);
  if (!overlay) {
    return { lifecycle, resolved: true, overlay_applied: false, builtin_version, warnings: [], flow: builtin };
  }

  const { flow, warnings } = applyOverlay(builtin, overlay, lifecycle);
  return { lifecycle, resolved: true, overlay_applied: true, builtin_version, warnings, flow };
}
