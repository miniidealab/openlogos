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

export type AiToolId = 'claude-code' | 'opencode' | 'codex' | 'cursor' | 'zcode' | 'qoder' | 'workbuddy' | 'other';
export type AiTool = AiToolId | 'all';

export interface AiToolCapabilities {
  lifecycle: Array<'init' | 'sync' | 'launch' | 'adopt'>;
  assets: Array<'agents' | 'plugin' | 'hooks'>;
  instructions?: boolean;
  skills?: boolean;
  commands?: boolean;
  agents?: boolean;
  plugin?: boolean;
  sessionStart?: boolean;
  preToolUse?: boolean;
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
  {
    id: 'qoder',
    capabilities: {
      lifecycle: ['init', 'sync', 'launch', 'adopt'],
      assets: ['agents', 'plugin', 'hooks'],
      instructions: true,
      skills: true,
      commands: true,
      agents: true,
      plugin: true,
      sessionStart: true,
      preToolUse: true,
    },
  },
  {
    id: 'workbuddy',
    capabilities: {
      lifecycle: ['init', 'sync', 'launch', 'adopt'],
      assets: ['agents', 'plugin', 'hooks'],
      instructions: true,
      skills: true,
      commands: true,
      agents: true,
      plugin: true,
      sessionStart: true,
      preToolUse: true,
    },
  },
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

/**
 * 严格解析持久化配置中的 AI 工具列表。
 *
 * 交互式入口会先通过 parseRegisteredAiTool 校验用户输入；同步入口读取的却是
 * 可被人工修改的配置文件，因此不能把未知值静默降级为 cursor。必须在任何同步
 * 写入发生前失败，避免看似成功但实际遗漏目标宿主。
 */
export function resolveConfiguredAiTools(rawAiTool: unknown): AiToolId[] {
  const rawValues = Array.isArray(rawAiTool) ? rawAiTool : [rawAiTool];
  for (const value of rawValues) {
    if (value !== 'all' && !aiToolAdapterRegistry.has(value)) {
      throw new Error(`未知的 AI Adapter id：${String(value)}`);
    }
  }
  return expandRegisteredAiTools(rawAiTool);
}

export const ZCODE_PLUGIN_REL_DIR = '.zcode/plugins/openlogos';
export const QODER_PLUGIN_REL_DIR = '.qoder/plugins/openlogos';
export const WORKBUDDY_PLUGIN_REL_DIR = '.workbuddy/plugins/openlogos';

export interface ZCodeDeploymentResult {
  target: string;
  status: 'installed' | 'updated' | 'unchanged';
  preserved: string[];
}

export interface QoderDeploymentResult {
  target: string;
  status: 'installed' | 'updated' | 'unchanged';
  preserved: string[];
}

export interface WorkBuddyDeploymentResult {
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

export function validateQoderTemplate(source: string): void {
  const required = [
    '.qoder-plugin/plugin.json',
    'skills',
    'commands',
    'agents',
    'hooks/hooks.json',
    'hooks/runtime.mjs',
    'hooks/runtime.cjs',
  ];
  for (const relative of required) {
    if (!existsSync(join(source, relative))) throw new Error(`Qoder 模板缺少：${relative}`);
  }
  let manifest: Record<string, unknown>;
  let hooks: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(join(source, '.qoder-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>;
    hooks = JSON.parse(readFileSync(join(source, 'hooks', 'hooks.json'), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Qoder 插件 JSON 无法解析：${error instanceof Error ? error.message : '未知错误'}`);
  }
  if (manifest.name !== 'openlogos') throw new Error('Qoder plugin identity 必须为 openlogos');
  const hooksText = JSON.stringify(hooks);
  if (!hooksText.includes('${QODER_PLUGIN_ROOT}') || !hooksText.includes('runtime.mjs')) {
    throw new Error('Qoder hooks 必须以 QODER_PLUGIN_ROOT argv-safe 定位 hooks/runtime.mjs');
  }
  for (const file of walkFiles(source).filter(file =>
    /^skills\/[^/]+\/SKILL\.md$/.test(file)
      || /^commands\/[^/]+\.md$/.test(file)
      || /^agents\/[^/]+\.md$/.test(file))) {
    const content = readFileSync(join(source, file), 'utf8');
    if (!/^---\n[\s\S]+?\n---\n/.test(content.replace(/\r\n/g, '\n'))) {
      throw new Error(`Qoder Markdown frontmatter 非法：${file}`);
    }
  }
}

export function preflightQoderTarget(root: string, source: string): void {
  validateQoderTemplate(source);
  const target = join(root, ...QODER_PLUGIN_REL_DIR.split('/'));
  if (!existsSync(target)) return;
  const targetManifest = join(target, '.qoder-plugin', 'plugin.json');
  if (!existsSync(targetManifest)) {
    if (readdirSync(target).length > 0) throw new Error(`Qoder 目标存在不完整或未知 owner：${QODER_PLUGIN_REL_DIR}`);
    return;
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(targetManifest, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new Error(`Qoder 目标 manifest 无法解析：${targetManifest}`);
  }
  if (manifest.name !== 'openlogos') {
    throw new Error(`Qoder 目标 owner 冲突：${QODER_PLUGIN_REL_DIR}（owner=${String(manifest.name || 'unknown')}）`);
  }
}

class QoderManagedAssetTransaction {
  constructor(private readonly source: string, private readonly target: string) {}

  commit(): 'installed' | 'updated' {
    const parent = dirname(this.target);
    mkdirSync(parent, { recursive: true });
    const transactionRoot = mkdtempSync(join(parent, '.openlogos-qoder-txn-'));
    const staging = join(transactionRoot, basename(this.target));
    const backup = join(transactionRoot, `${basename(this.target)}.backup`);
    try {
      if (existsSync(this.target)) cpSync(this.target, staging, { recursive: true, force: false });
      else mkdirSync(staging, { recursive: true });
      cpSync(this.source, staging, { recursive: true, force: true });
      validateQoderTemplate(staging);
      const existed = existsSync(this.target);
      if (existed) renameSync(this.target, backup);
      if (process.env.OPENLOGOS_QODER_TXN_FAIL_AT === 'after-backup') throw new Error('注入的 Qoder 事务故障');
      renameSync(staging, this.target);
      if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
      rmSync(transactionRoot, { recursive: true, force: true });
      return existed ? 'updated' : 'installed';
    } catch (error) {
      if (!existsSync(this.target) && existsSync(backup)) renameSync(backup, this.target);
      rmSync(transactionRoot, { recursive: true, force: true });
      throw error;
    }
  }
}

export function deployQoderAssets(
  root: string,
  source: string,
  sharedAssets: { skills?: string | null; commands?: string | null; agents?: string | null } = {},
): QoderDeploymentResult {
  const preparedRoot = mkdtempSync(join(tmpdir(), 'openlogos-qoder-prepared-'));
  const prepared = join(preparedRoot, 'openlogos');
  cpSync(source, prepared, { recursive: true });
  if (sharedAssets.skills && existsSync(sharedAssets.skills)) {
    const target = join(prepared, 'skills');
    cpSync(sharedAssets.skills, target, { recursive: true, force: true });
    for (const name of readdirSync(target)) {
      const file = join(target, name, 'SKILL.md');
      if (!existsSync(file)) continue;
      const content = readFileSync(file, 'utf8');
      if (!content.replace(/\r\n/g, '\n').startsWith('---\n')) {
        const description = `OpenLogos ${name} 方法论 Skill`.replace(/"/g, '\\"');
        writeFileSync(file, `---\nname: "${name}"\ndescription: "${description}"\n---\n\n${content}`);
      }
    }
  }
  if (sharedAssets.commands && existsSync(sharedAssets.commands)) cpSync(sharedAssets.commands, join(prepared, 'commands'), { recursive: true, force: true });
  if (sharedAssets.agents && existsSync(sharedAssets.agents)) cpSync(sharedAssets.agents, join(prepared, 'agents'), { recursive: true, force: true });
  preflightQoderTarget(root, prepared);
  const config = join(root, '.qoder', 'settings.json');
  const configBefore = existsSync(config) ? readFileSync(config) : null;
  const target = join(root, ...QODER_PLUGIN_REL_DIR.split('/'));
  const preserved = existsSync(target)
    ? walkFiles(target).filter(file => !existsSync(join(prepared, file))).map(file => `${QODER_PLUGIN_REL_DIR}/${file}`)
    : [];
  try {
    const status = sourceTreeMatches(prepared, target)
      ? 'unchanged'
      : new QoderManagedAssetTransaction(prepared, target).commit();
    if (configBefore && !readFileSync(config).equals(configBefore)) throw new Error('.qoder/settings.json 被意外修改');
    return {
      target: QODER_PLUGIN_REL_DIR,
      status,
      preserved: [...(configBefore ? ['.qoder/settings.json'] : []), ...preserved],
    };
  } finally {
    rmSync(preparedRoot, { recursive: true, force: true });
  }
}

export function localizedQoderResult(locale: 'zh' | 'en', result: QoderDeploymentResult): string {
  const action = locale === 'zh'
    ? ({ installed: '已安装', updated: '已更新', unchanged: '未变化' } as const)[result.status]
    : result.status;
  const preserved = result.preserved.length > 0
    ? (locale === 'zh' ? `；已保留 ${result.preserved.join('、')}` : `; preserved ${result.preserved.join(', ')}`)
    : '';
  const session = result.status === 'unchanged'
    ? ''
    : (locale === 'zh' ? '；请新建 Qoder CLI session 使插件快照生效' : '; start a new Qoder CLI session to load the plugin snapshot');
  return locale === 'zh'
    ? `Qoder 插件${action}到 ${result.target}${preserved}${session}`
    : `Qoder plugin ${action} at ${result.target}${preserved}${session}`;
}

export function createQoderAgentsInstruction(locale: 'zh' | 'en', lifecycle: string): string {
  return locale === 'zh'
    ? `OpenLogos Qoder 指令：当前 lifecycle=${lifecycle}。直接读取根 AGENTS.md 与插件 skills；不得依赖 AGENTS.local.md、.qoder/rules 或其它用户资产表达关键流程约束。`
    : `OpenLogos Qoder instructions: lifecycle=${lifecycle}. Read the root AGENTS.md and plugin skills directly; do not depend on AGENTS.local.md, .qoder/rules, or other user assets for critical workflow rules.`;
}

export function validateWorkBuddyTemplate(source: string): void {
  const required = [
    '.workbuddy-plugin/plugin.json',
    'skills',
    'commands',
    'agents',
    'hooks/hooks.json',
    'hooks/runtime.mjs',
    'hooks/runtime.cjs',
  ];
  for (const relative of required) {
    if (!existsSync(join(source, relative))) throw new Error(`WorkBuddy 模板缺少：${relative}`);
  }
  let manifest: Record<string, unknown>;
  let hooks: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(join(source, '.workbuddy-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>;
    hooks = JSON.parse(readFileSync(join(source, 'hooks', 'hooks.json'), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`WorkBuddy 插件 JSON 无法解析：${error instanceof Error ? error.message : '未知错误'}`);
  }
  if (manifest.name !== 'openlogos') throw new Error('WorkBuddy plugin identity 必须为 openlogos');
  const hooksText = JSON.stringify(hooks);
  if (!hooksText.includes('${CODEBUDDY_PLUGIN_ROOT}') || !hooksText.includes('runtime.mjs')) {
    throw new Error('WorkBuddy hooks 必须以 CODEBUDDY_PLUGIN_ROOT argv-safe 定位 hooks/runtime.mjs');
  }
  for (const file of walkFiles(source).filter(file =>
    /^skills\/[^/]+\/SKILL\.md$/.test(file)
      || /^commands\/[^/]+\.md$/.test(file)
      || /^agents\/[^/]+\.md$/.test(file))) {
    const content = readFileSync(join(source, file), 'utf8');
    if (!/^---\n[\s\S]+?\n---\n/.test(content.replace(/\r\n/g, '\n'))) {
      throw new Error(`WorkBuddy Markdown frontmatter 非法：${file}`);
    }
  }
}

export function preflightWorkBuddyTarget(root: string, source: string): void {
  validateWorkBuddyTemplate(source);
  const target = join(root, ...WORKBUDDY_PLUGIN_REL_DIR.split('/'));
  if (!existsSync(target)) return;
  const targetManifest = join(target, '.workbuddy-plugin', 'plugin.json');
  if (!existsSync(targetManifest)) {
    if (readdirSync(target).length > 0) throw new Error(`WorkBuddy 目标存在不完整或未知 owner：${WORKBUDDY_PLUGIN_REL_DIR}`);
    return;
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(targetManifest, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new Error(`WorkBuddy 目标 manifest 无法解析：${targetManifest}`);
  }
  if (manifest.name !== 'openlogos') {
    throw new Error(`WorkBuddy 目标 owner 冲突：${WORKBUDDY_PLUGIN_REL_DIR}（owner=${String(manifest.name || 'unknown')}）`);
  }
}

class WorkBuddyManagedAssetTransaction {
  constructor(private readonly source: string, private readonly target: string) {}

  commit(): 'installed' | 'updated' {
    const parent = dirname(this.target);
    mkdirSync(parent, { recursive: true });
    const transactionRoot = mkdtempSync(join(parent, '.openlogos-workbuddy-txn-'));
    const staging = join(transactionRoot, basename(this.target));
    const backup = join(transactionRoot, `${basename(this.target)}.backup`);
    try {
      if (existsSync(this.target)) cpSync(this.target, staging, { recursive: true, force: false });
      else mkdirSync(staging, { recursive: true });
      cpSync(this.source, staging, { recursive: true, force: true });
      validateWorkBuddyTemplate(staging);
      const existed = existsSync(this.target);
      if (existed) renameSync(this.target, backup);
      if (process.env.OPENLOGOS_WORKBUDDY_TXN_FAIL_AT === 'after-backup') throw new Error('注入的 WorkBuddy 事务故障');
      renameSync(staging, this.target);
      if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
      rmSync(transactionRoot, { recursive: true, force: true });
      return existed ? 'updated' : 'installed';
    } catch (error) {
      if (!existsSync(this.target) && existsSync(backup)) renameSync(backup, this.target);
      rmSync(transactionRoot, { recursive: true, force: true });
      throw error;
    }
  }
}

export function deployWorkBuddyAssets(
  root: string,
  source: string,
  sharedAssets: { skills?: string | null; commands?: string | null; agents?: string | null } = {},
): WorkBuddyDeploymentResult {
  const preparedRoot = mkdtempSync(join(tmpdir(), 'openlogos-workbuddy-prepared-'));
  const prepared = join(preparedRoot, 'openlogos');
  cpSync(source, prepared, { recursive: true });
  if (sharedAssets.skills && existsSync(sharedAssets.skills)) {
    const target = join(prepared, 'skills');
    cpSync(sharedAssets.skills, target, { recursive: true, force: true });
    for (const name of readdirSync(target)) {
      const file = join(target, name, 'SKILL.md');
      if (!existsSync(file)) continue;
      const content = readFileSync(file, 'utf8');
      if (!content.replace(/\r\n/g, '\n').startsWith('---\n')) {
        const description = `OpenLogos ${name} 方法论 Skill`.replace(/"/g, '\\"');
        writeFileSync(file, `---\nname: "${name}"\ndescription: "${description}"\n---\n\n${content}`);
      }
    }
  }
  if (sharedAssets.commands && existsSync(sharedAssets.commands)) cpSync(sharedAssets.commands, join(prepared, 'commands'), { recursive: true, force: true });
  if (sharedAssets.agents && existsSync(sharedAssets.agents)) cpSync(sharedAssets.agents, join(prepared, 'agents'), { recursive: true, force: true });
  preflightWorkBuddyTarget(root, prepared);
  const settings = join(root, '.workbuddy', 'settings.json');
  const settingsBefore = existsSync(settings) ? readFileSync(settings) : null;
  const target = join(root, ...WORKBUDDY_PLUGIN_REL_DIR.split('/'));
  const preserved = existsSync(target)
    ? walkFiles(target).filter(file => !existsSync(join(prepared, file))).map(file => `${WORKBUDDY_PLUGIN_REL_DIR}/${file}`)
    : [];
  try {
    const status = sourceTreeMatches(prepared, target)
      ? 'unchanged'
      : new WorkBuddyManagedAssetTransaction(prepared, target).commit();
    if (settingsBefore && !readFileSync(settings).equals(settingsBefore)) throw new Error('.workbuddy/settings.json 被意外修改');
    return {
      target: WORKBUDDY_PLUGIN_REL_DIR,
      status,
      preserved: [...(settingsBefore ? ['.workbuddy/settings.json'] : []), ...preserved],
    };
  } finally {
    rmSync(preparedRoot, { recursive: true, force: true });
  }
}

export function localizedWorkBuddyResult(locale: 'zh' | 'en', result: WorkBuddyDeploymentResult): string {
  const action = locale === 'zh'
    ? ({ installed: '已安装', updated: '已更新', unchanged: '未变化' } as const)[result.status]
    : result.status;
  const preserved = result.preserved.length > 0
    ? (locale === 'zh' ? `；已保留 ${result.preserved.join('、')}` : `; preserved ${result.preserved.join(', ')}`)
    : '';
  const session = result.status === 'unchanged'
    ? ''
    : (locale === 'zh' ? '；请新建 WorkBuddy session 使插件快照生效；原生记忆未读取或修改' : '; start a new WorkBuddy session to load the plugin snapshot; native memory was not read or modified');
  return locale === 'zh'
    ? `WorkBuddy 插件${action}到 ${result.target}${preserved}${session}`
    : `WorkBuddy plugin ${action} at ${result.target}${preserved}${session}`;
}

export function createWorkBuddyAgentsInstruction(locale: 'zh' | 'en', lifecycle: string): string {
  return locale === 'zh'
    ? `OpenLogos WorkBuddy 指令：当前 lifecycle=${lifecycle}。使用插件 Skills/Commands 与 SessionStart 获取方法论上下文；原生记忆不作为授权事实，写入权限只由 PreToolUse 的磁盘重读决定。`
    : `OpenLogos WorkBuddy instructions: lifecycle=${lifecycle}. Use plugin Skills/Commands and SessionStart for methodology context; native memory is not authorization, and write permission comes only from PreToolUse disk facts.`;
}
