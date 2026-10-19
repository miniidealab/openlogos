/**
 * smoke 按模块限定范围（module-scoped-env-smoke，spec/environments.md §14.5、§14.6；spec/test-results.md
 * 「按模块限定 smoke 范围的运行约定」）。
 *
 * - 应覆盖集合 S = 目标模块 `m-` 前缀规格（已登记模块 id 最长匹配）中的 SMOKE-* ∪ 不带任何已登记模块前缀的全局规格中的
 *   SMOKE-* ∪ C（提案上下文下本提案变更的 smoke 用例；版本上下文下为空）。覆盖与结果过滤只用这一个集合。
 * - smoke.modules.<id> 的命令与路径：未写的字段回落项目级；<id> 未登记时警告 smoke_module_unknown 并忽略。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { extractSmokeIdsFromContent } from './smoke-coverage.js';
import { readProjectYaml } from './project-yaml.js';

export const SMOKE_CASES_DIR = 'logos/resources/test/smoke';

/** 规格文件归属的模块：文件名以 `<id>-` 开头的已登记模块中 id 最长者；都不匹配为全局（null）。 */
export function smokeSpecModule(fileName: string, moduleIds: string[]): string | null {
  const name = basename(fileName);
  const owners = moduleIds.filter(id => name.startsWith(`${id}-`)).sort((a, b) => b.length - a.length);
  return owners[0] ?? null;
}

export interface SmokeCaseSet {
  /** 最终应覆盖集合 S（排序）。 */
  caseIds: string[];
  /** smoke 规格中定义的全部 ID（判定「已定义但不在 S 中」）。 */
  allDefined: string[];
}

/** 计算目标模块 m 的应覆盖集合 S（§14.5）。changed 为 C：提案上下文的变更用例，版本上下文传空数组。 */
export function resolveSmokeCaseSet(root: string, moduleIds: string[], target: string, changed: string[]): SmokeCaseSet {
  const dir = join(root, SMOKE_CASES_DIR);
  const inScope = new Set<string>(changed);
  const all = new Set<string>();
  if (existsSync(dir)) {
    try {
      const files = readdirSync(dir, { recursive: true }).map(f => String(f)).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const ids = extractSmokeIdsFromContent(readFileSync(join(dir, file), 'utf-8'));
        const owner = smokeSpecModule(file, moduleIds);
        for (const id of ids) {
          all.add(id);
          if (owner === null || owner === target) inScope.add(id);
        }
      }
    } catch { /* 目录读取失败：与 extractSmokeDefinedIds 同样容错 */ }
  }
  return { caseIds: [...inScope].sort(), allDefined: [...all].sort() };
}

export interface ModuleSmokeConfig {
  command?: string;
  result_path?: string;
  report_path?: string;
}

/** logos.config.json 中的 smoke.modules（只取对象形态的条目与字符串字段）。 */
export function readSmokeModules(root: string): Record<string, ModuleSmokeConfig> {
  const file = join(root, 'logos', 'logos.config.json');
  if (!existsSync(file)) return {};
  try {
    const raw = (JSON.parse(readFileSync(file, 'utf-8')) as { smoke?: { modules?: unknown } }).smoke?.modules;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, ModuleSmokeConfig> = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const v = value as Record<string, unknown>;
      const entry: ModuleSmokeConfig = {};
      for (const key of ['command', 'result_path', 'report_path'] as const) {
        if (typeof v[key] === 'string' && (v[key] as string).trim() !== '') entry[key] = (v[key] as string).trim();
      }
      out[id] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

/** smoke.modules 中未在 logos-project.yaml 登记的模块 id（§14.5：警告 smoke_module_unknown 并忽略）。 */
export function unknownSmokeModules(root: string): string[] {
  const registered = new Set((readProjectYaml(root).data?.modules ?? []).map(m => m.id));
  return Object.keys(readSmokeModules(root)).filter(id => !registered.has(id)).sort();
}

/** 目标模块 m 的 smoke.modules.<m>（m 未登记或未配置时为 null）。 */
export function moduleSmokeConfig(root: string, moduleId: string): ModuleSmokeConfig | null {
  if (unknownSmokeModules(root).includes(moduleId)) return null;
  return readSmokeModules(root)[moduleId] ?? null;
}
