import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export type AiToolId = 'claude-code' | 'opencode' | 'codex' | 'cursor' | 'zcode' | 'other';
export type AiTool = AiToolId | 'all';

export interface AiToolCapabilities {
  lifecycle: Array<'init' | 'sync' | 'launch' | 'adopt'>;
  assets: Array<'agents' | 'plugin' | 'hooks'>;
}

export interface AiToolAdapterDefinition {
  id: AiToolId;
  capabilities: AiToolCapabilities;
}

const DEFAULT_ADAPTERS: AiToolAdapterDefinition[] = [
  { id: 'claude-code', capabilities: { lifecycle: ['init', 'sync', 'launch', 'adopt'], assets: ['agents', 'plugin', 'hooks'] } },
  { id: 'opencode', capabilities: { lifecycle: ['init', 'sync', 'launch', 'adopt'], assets: ['agents', 'plugin', 'hooks'] } },
  { id: 'codex', capabilities: { lifecycle: ['init', 'sync', 'launch', 'adopt'], assets: ['agents', 'plugin', 'hooks'] } },
  { id: 'cursor', capabilities: { lifecycle: ['init', 'sync', 'launch', 'adopt'], assets: ['agents'] } },
  { id: 'zcode', capabilities: { lifecycle: ['init', 'sync', 'launch', 'adopt'], assets: ['agents', 'plugin', 'hooks'] } },
  { id: 'other', capabilities: { lifecycle: ['init', 'sync', 'launch', 'adopt'], assets: ['agents'] } },
];

export class AiToolAdapterRegistry {
  private readonly definitions = new Map<AiToolId, AiToolAdapterDefinition>();

  constructor(definitions: AiToolAdapterDefinition[] = DEFAULT_ADAPTERS) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.id)) {
        throw new Error(`重复的 AI Adapter id：${definition.id}`);
      }
      this.definitions.set(definition.id, definition);
    }
  }

  get(id: string): AiToolAdapterDefinition {
    const definition = this.definitions.get(id as AiToolId);
    if (!definition) throw new Error(`未知的 AI Adapter id：${id}`);
    return definition;
  }

  has(id: unknown): id is AiToolId {
    return typeof id === 'string' && this.definitions.has(id as AiToolId);
  }

  list(options: { deployableOnly?: boolean } = {}): AiToolAdapterDefinition[] {
    const values = [...this.definitions.values()];
    return options.deployableOnly ? values.filter(item => item.id !== 'other') : values;
  }
}

export const aiToolAdapterRegistry = new AiToolAdapterRegistry();

export function parseRegisteredAiTool(value: unknown): AiTool | undefined {
  if (value === 'all') return 'all';
  return aiToolAdapterRegistry.has(value) ? value : undefined;
}

export function expandRegisteredAiTools(rawAiTool: unknown): AiToolId[] {
  const rawValues = Array.isArray(rawAiTool) ? rawAiTool : [rawAiTool];
  const result: AiToolId[] = [];
  for (const value of rawValues) {
    if (value === 'all') {
      result.push(...aiToolAdapterRegistry.list({ deployableOnly: true }).map(item => item.id));
    } else if (aiToolAdapterRegistry.has(value)) {
      result.push(value);
    }
  }
  const unique = Array.from(new Set(result));
  return unique.length > 0 ? unique : ['cursor'];
}

export const ZCODE_PLUGIN_REL_DIR = '.zcode/plugins/openlogos';

export interface ZCodeDeploymentResult {
  target: string;
  status: 'installed' | 'updated' | 'unchanged';
  preserved: string[];
}

function sourceTreeMatches(source: string, target: string): boolean {
  if (!existsSync(target)) return false;
  for (const entry of readdirSync(source)) {
    const sourceEntry = join(source, entry);
    const targetEntry = join(target, entry);
    if (!existsSync(targetEntry)) return false;
    const sourceStat = statSync(sourceEntry);
    const targetStat = statSync(targetEntry);
    if (sourceStat.isDirectory() !== targetStat.isDirectory()) return false;
    if (sourceStat.isDirectory()) {
      if (!sourceTreeMatches(sourceEntry, targetEntry)) return false;
    } else if (!readFileSync(sourceEntry).equals(readFileSync(targetEntry))) {
      return false;
    }
  }
  return true;
}

function parseManifest(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`ZCode manifest 无法解析：${file}（${error instanceof Error ? error.message : '未知错误'}）`);
  }
}

function walkFiles(root: string, prefix = ''): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) result.push(...walkFiles(full, relative));
    else result.push(relative);
  }
  return result.sort();
}

export function validateZCodeTemplate(source: string): void {
  const required = [
    '.zcode-plugin/plugin.json',
    'skills',
    'commands',
    'agents',
    'hooks/hooks.json',
    'runtime/hook-runtime.js',
  ];
  for (const relative of required) {
    if (!existsSync(join(source, relative))) throw new Error(`ZCode 模板缺少：${relative}`);
  }
  const manifest = parseManifest(join(source, '.zcode-plugin', 'plugin.json'));
  if (manifest.name !== 'openlogos') throw new Error('ZCode plugin identity 必须为 openlogos');
  parseManifest(join(source, 'hooks', 'hooks.json'));
  for (const file of walkFiles(source).filter(file =>
    /^skills\/[^/]+\/SKILL\.md$/.test(file)
      || /^commands\/[^/]+\.md$/.test(file)
      || /^agents\/[^/]+\.md$/.test(file))) {
    const content = readFileSync(join(source, file), 'utf8');
    if (!/^---\n[\s\S]+?\n---\n/.test(content.replace(/\r\n/g, '\n'))) {
      throw new Error(`ZCode Markdown frontmatter 非法：${file}`);
    }
  }
}

export function preflightZCodeTarget(root: string, source: string): void {
  validateZCodeTemplate(source);
  const target = join(root, ...ZCODE_PLUGIN_REL_DIR.split('/'));
  if (!existsSync(target)) return;
  const targetManifest = join(target, '.zcode-plugin', 'plugin.json');
  if (!existsSync(targetManifest)) {
    const entries = readdirSync(target);
    if (entries.length > 0) throw new Error(`ZCode 目标存在不完整或未知 owner：${ZCODE_PLUGIN_REL_DIR}`);
    return;
  }
  const manifest = parseManifest(targetManifest);
  if (manifest.name !== 'openlogos') {
    throw new Error(`ZCode 目标 owner 冲突：${ZCODE_PLUGIN_REL_DIR}（owner=${String(manifest.name || 'unknown')}）`);
  }
}

export class ManagedAssetTransaction {
  private staging: string | null = null;
  private backup: string | null = null;

  constructor(
    private readonly source: string,
    private readonly target: string,
  ) {}

  commit(): 'installed' | 'updated' | 'unchanged' {
    const parent = dirname(this.target);
    mkdirSync(parent, { recursive: true });
    const transactionRoot = mkdtempSync(join(parent, '.openlogos-zcode-txn-'));
    this.staging = join(transactionRoot, basename(this.target));
    this.backup = join(transactionRoot, `${basename(this.target)}.backup`);
    try {
      if (existsSync(this.target)) cpSync(this.target, this.staging, { recursive: true, force: false });
      else mkdirSync(this.staging, { recursive: true });
      cpSync(this.source, this.staging, { recursive: true, force: true });
      validateZCodeTemplate(this.staging);

      const existed = existsSync(this.target);
      if (existed) renameSync(this.target, this.backup);
      if (process.env.OPENLOGOS_ZCODE_TXN_FAIL_AT === 'after-backup') {
        throw new Error('注入的 ZCode 事务故障');
      }
      renameSync(this.staging, this.target);
      if (existsSync(this.backup)) rmSync(this.backup, { recursive: true, force: true });
      rmSync(transactionRoot, { recursive: true, force: true });
      this.staging = null;
      this.backup = null;
      return existed ? 'updated' : 'installed';
    } catch (error) {
      if (!existsSync(this.target) && this.backup && existsSync(this.backup)) renameSync(this.backup, this.target);
      rmSync(transactionRoot, { recursive: true, force: true });
      this.staging = null;
      this.backup = null;
      throw error;
    }
  }
}

export function deployZCodeAssets(
  root: string,
  source: string,
  sharedAssets: { skills?: string | null; commands?: string | null; agents?: string | null } = {},
): ZCodeDeploymentResult {
  const preparedRoot = mkdtempSync(join(tmpdir(), 'openlogos-zcode-prepared-'));
  const prepared = join(preparedRoot, 'openlogos');
  cpSync(source, prepared, { recursive: true });
  if (sharedAssets.skills && existsSync(sharedAssets.skills)) {
    const skillsTarget = join(prepared, 'skills');
    cpSync(sharedAssets.skills, skillsTarget, { recursive: true, force: true });
    for (const name of readdirSync(skillsTarget)) {
      const skillFile = join(skillsTarget, name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const content = readFileSync(skillFile, 'utf8');
      if (!content.replace(/\r\n/g, '\n').startsWith('---\n')) {
        const description = `OpenLogos ${name} 方法论 Skill`.replace(/"/g, '\\"');
        const frontmatter = `---\nname: "${name}"\ndescription: "${description}"\n---\n\n`;
        writeFileSync(skillFile, frontmatter + content);
      }
    }
  }
  if (sharedAssets.commands && existsSync(sharedAssets.commands)) cpSync(sharedAssets.commands, join(prepared, 'commands'), { recursive: true, force: true });
  if (sharedAssets.agents && existsSync(sharedAssets.agents)) cpSync(sharedAssets.agents, join(prepared, 'agents'), { recursive: true, force: true });
  preflightZCodeTarget(root, prepared);
  const config = join(root, '.zcode', 'config.json');
  const configBefore = existsSync(config) ? readFileSync(config) : null;
  const target = join(root, ...ZCODE_PLUGIN_REL_DIR.split('/'));
  const preserved = existsSync(target)
    ? walkFiles(target).filter(file => !existsSync(join(prepared, file))).map(file => `${ZCODE_PLUGIN_REL_DIR}/${file}`)
    : [];
  try {
    const status = sourceTreeMatches(prepared, target)
      ? 'unchanged'
      : new ManagedAssetTransaction(prepared, target).commit();
    if (configBefore && !readFileSync(config).equals(configBefore)) {
      throw new Error('.zcode/config.json 被意外修改');
    }
    return {
      target: ZCODE_PLUGIN_REL_DIR,
      status,
      preserved: [...(configBefore ? ['.zcode/config.json'] : []), ...preserved],
    };
  } finally {
    rmSync(preparedRoot, { recursive: true, force: true });
  }
}

export function localizedZCodeResult(
  locale: 'zh' | 'en',
  result: ZCodeDeploymentResult,
  newSession = true,
): string {
  const action = locale === 'zh'
    ? ({ installed: '已安装', updated: '已更新', unchanged: '未变化' } as const)[result.status]
    : ({ installed: 'installed', updated: 'updated', unchanged: 'unchanged' } as const)[result.status];
  const preserved = result.preserved.length > 0
    ? (locale === 'zh' ? `；已保留 ${result.preserved.join(', ')}` : `; preserved ${result.preserved.join(', ')}`)
    : '';
  const session = newSession
    ? (locale === 'zh' ? '；请新建 ZCode session 使插件快照生效' : '; start a new ZCode session to load the plugin snapshot')
    : '';
  return locale === 'zh'
    ? `ZCode 插件${action}到 ${result.target}${preserved}${session}`
    : `ZCode plugin ${action} at ${result.target}${preserved}${session}`;
}

export function createZCodeAgentsInstruction(locale: 'zh' | 'en', lifecycle: string): string {
  return locale === 'zh'
    ? `OpenLogos ZCode 指令：当前 lifecycle=${lifecycle}。直接读取根 AGENTS.md 与插件 skills；不得依赖子目录 AGENTS、include 或 CLAUDE.md。`
    : `OpenLogos ZCode instructions: lifecycle=${lifecycle}. Read the root AGENTS.md and plugin skills directly; do not depend on nested AGENTS, include directives, or CLAUDE.md.`;
}
