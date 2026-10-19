/**
 * 项目生命周期视图（module-lifecycle-guard，spec/agents-md.md「混合生命周期项目的变更管理条款生成」）。
 *
 * 持久化指令（AGENTS.md / CLAUDE.md 托管段、宿主指令段、Cursor policy）按视图生成变更管理条款：
 * - initial：没有 launched 模块，或 logos-project.yaml 缺失 / 不可解析；
 * - launched：至少一个 launched 模块，且没有显式 initial 模块；
 * - mixed：至少一个 launched 模块，且至少一个显式 initial 模块。
 * initial、launched 视图的文字与引入本模块前逐字节一致；mixed 视图在 launched 文字基础上列出 initial 模块的豁免范围，
 * 并把「无 guard 禁止修改」等条款限定为 launched 模块文件、共享配置与未归属文件。归属口径与 guard 相同
 * （spec/pretooluse-guard.md「按文件归属的模块生命周期判定」）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface InitialModuleScope {
  id: string;
  /** 合法的 `paths` 条目；为空表示未声明（代码仍需提案）。 */
  paths: string[];
  /** `scenarios[].module` 归属本模块的场景 id（API 规格 `SXX-*.yaml` 按此归属）。 */
  scenarios: string[];
}

export interface LifecycleView {
  kind: 'initial' | 'launched' | 'mixed';
  initialModules: InitialModuleScope[];
}

/** 修改前的布尔入参（是否存在 launched 模块）与视图的统一入参。 */
export type LifecycleInput = boolean | LifecycleView;

export function toLifecycleView(input: LifecycleInput | undefined): LifecycleView {
  if (typeof input === 'object' && input !== null) return input;
  return { kind: input ? 'launched' : 'initial', initialModules: [] };
}

/** 是否存在 launched 模块（Skills 与宿主资产部署等沿用的布尔口径）。 */
export function viewIsLaunched(input: LifecycleInput | undefined): boolean {
  return toLifecycleView(input).kind !== 'initial';
}

function validPath(entry: unknown): entry is string {
  if (typeof entry !== 'string' || entry.trim() === '') return false;
  if (entry.startsWith('/')) return false;
  return !entry.split('/').some(seg => seg === '..');
}

/**
 * 读取 logos-project.yaml 得出生命周期视图。opts.launched：按「这些模块已切换为 launched」计算（launch 在提交
 * lifecycle 之前刷新指令时使用）。
 */
export function readLifecycleView(root: string, opts: { launched?: string[] } = {}): LifecycleView {
  const initialView: LifecycleView = { kind: 'initial', initialModules: [] };
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) return initialView;
  let yaml: unknown;
  try {
    yaml = parseYaml(readFileSync(yamlPath, 'utf-8'));
  } catch {
    return initialView;
  }
  const record = (yaml && typeof yaml === 'object' ? yaml : {}) as Record<string, unknown>;
  if (!Array.isArray(record.modules)) return initialView;
  const forced = new Set(opts.launched ?? []);
  const modules = (record.modules as unknown[])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && !Array.isArray(m))
    .map(m => ({
      id: typeof m.id === 'string' ? m.id : '',
      lifecycle: typeof m.id === 'string' && forced.has(m.id) ? 'launched' : m.lifecycle,
      paths: Array.isArray(m.paths) ? m.paths.filter(validPath) : [],
    }));
  const anyLaunched = modules.some(m => m.lifecycle === 'launched');
  const initials = modules.filter(m => m.lifecycle === 'initial' && m.id !== '');
  if (!anyLaunched) return initialView;
  if (initials.length === 0) return { kind: 'launched', initialModules: [] };
  const scenarios = Array.isArray(record.scenarios)
    ? (record.scenarios as unknown[]).filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && !Array.isArray(s))
    : [];
  const seen = new Set<string>();
  const initialModules: InitialModuleScope[] = [];
  for (const m of initials) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    initialModules.push({
      id: m.id,
      paths: m.paths,
      scenarios: scenarios
        .filter(s => typeof s.id === 'string' && (typeof s.module === 'string' && s.module !== '' ? s.module : 'core') === m.id)
        .map(s => s.id as string),
    });
  }
  return { kind: 'mixed', initialModules };
}

type Locale = 'zh' | 'en';

function code(s: string): string {
  return `\`${s}\``;
}

function moduleLine(locale: Locale, m: InitialModuleScope): string {
  const api = m.scenarios.length > 0
    ? (locale === 'zh'
      ? `，以及场景 ${m.scenarios.join('、')} 的 ${m.scenarios.map(s => code(`logos/resources/api/${s}-*.yaml`)).join('、')}`
      : `, plus ${m.scenarios.map(s => code(`logos/resources/api/${s}-*.yaml`)).join(', ')} for scenario${m.scenarios.length > 1 ? 's' : ''} ${m.scenarios.join(', ')}`)
    : '';
  const codePart = m.paths.length > 0
    ? (locale === 'zh' ? `代码——${m.paths.map(code).join('、')}` : `code — ${m.paths.map(code).join(', ')}`)
    : (locale === 'zh' ? `代码仍需提案（未声明 ${code('paths')}）` : `code still requires a proposal (no ${code('paths')} declared)`);
  return locale === 'zh'
    ? `- ${code(m.id)}：规格——${code('logos/resources/**')} 下 ${code(`${m.id}-`)} 前缀文件${api}；${codePart}`
    : `- ${code(m.id)}: specs — files prefixed ${code(`${m.id}-`)} under ${code('logos/resources/**')}${api}; ${codePart}`;
}

/** mixed 视图新增的「按模块生命周期豁免（initial 模块）」小节（AGENTS.md / CLAUDE.md 与 Cursor policy 共用）。 */
export function mixedExemptionSection(locale: Locale, view: LifecycleView): string {
  const lines = view.initialModules.map(m => moduleLine(locale, m)).join('\n');
  return locale === 'zh'
    ? `### 按模块生命周期豁免（initial 模块）
本项目同时有 launched 与 initial 模块（混合生命周期）。只归属下列 initial 模块的文件按 Phase 推进，**无需变更提案**；其他模块有活跃提案时，也不受该提案范围限制：
${lines}

同时归属 launched 模块的文件、共享配置（如 ${code('logos/logos.config.json')}）与归不到任何模块的文件不在豁免之列，仍按本节的变更管理规则处理。归属口径与 guard 相同，以 guard 的判定为准。
`
    : `### Module Lifecycle Exemption (initial modules)
This project has both launched and initial modules (mixed lifecycle). Files that belong only to the initial modules below follow the Phase progression and **need no change proposal**, and they are not limited by another module's active proposal:
${lines}

Files that also belong to a launched module, shared configuration (such as ${code('logos/logos.config.json')}) and files that belong to no module are not exempt and still follow the change management rules in this section. Attribution matches the guard; the guard's decision is authoritative.
`;
}

/** 宿主指令段（ZCode / Qoder / WorkBuddy / Cursor）在 mixed 视图下追加的一句。 */
export function mixedHostNote(locale: Locale, view: LifecycleView): string {
  const parts = view.initialModules.map(m => {
    const codePart = m.paths.length > 0 ? m.paths.join(locale === 'zh' ? '、' : ', ') : (locale === 'zh' ? '代码仍需提案' : 'code still needs a proposal');
    return locale === 'zh' ? `${m.id}（规格 ${m.id}- 前缀；代码 ${codePart}）` : `${m.id} (specs prefixed ${m.id}-; code ${codePart})`;
  });
  return locale === 'zh'
    ? `混合生命周期：initial 模块 ${parts.join('、')}的文件按 Phase 推进、无需变更提案，其他模块有活跃提案时也不受其范围限制；launched 模块文件、共享配置与未归属文件仍须先立案。`
    : `Mixed lifecycle: files of initial modules ${parts.join(', ')} follow the Phase progression without a change proposal, even while another module has an active proposal; launched module files, shared configuration and unattributed files still require a proposal first.`;
}

/**
 * 把 launched 文字改写为 mixed 文字：按表逐条替换限定禁令，并在锚点前插入豁免小节。任一原文缺失即抛错，
 * 防止模板改动后静默留下覆盖 initial 模块的全局禁令。
 */
export function applyMixedLifecycle(
  text: string, view: LifecycleView, section: string, insertBefore: string, replacements: Array<[string, string]>,
): string {
  if (view.kind !== 'mixed') return text;
  let out = text;
  for (const [from, to] of replacements) {
    if (!out.includes(from)) throw new Error(`mixed 指令改写缺少原文：${from.slice(0, 60)}`);
    out = out.split(from).join(to);
  }
  const at = out.indexOf(insertBefore);
  if (at < 0) throw new Error(`mixed 指令改写缺少插入锚点：${insertBefore}`);
  return `${out.slice(0, at)}${section}\n${out.slice(at)}`;
}
