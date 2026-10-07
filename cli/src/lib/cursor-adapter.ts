import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTree } from './fs-remove.js';
import { renameWithRetry } from './fs-retry.js';

/**
 * Cursor 三件套部署（cursor-adapter-parity）：
 * - 原生 Agent Skills（含 disable-model-invocation 显式命令 Skills）→ .cursor/skills/<name>/
 * - change-reviewer subagent → .cursor/agents/change-reviewer.md
 * - hooks 托管条目 → .cursor/hooks.json 合并写入（仅增改托管条目，用户条目字节不变）
 * - 托管 .mdc 迁移清理（Skill 名单精确匹配，用户 rules 保留）
 * 顺序不变量：Skills/subagent → hooks 合并 → .mdc 清理；任一步失败回滚且 .mdc 不提前删除。
 * - 事后检查引擎 → .cursor/hooks/openlogos-guard-post.cjs（包内唯一源 plugin/bin/guard-post-check.cjs，同一份字节）
 * capability honesty（D09；guard-versioned-content-scope C11）：OpenLogos 未接入 Cursor preToolUse，IDE 与
 * cursor-agent CLI 下写入门禁均为部分强度——shell 事前轻判 + afterShellExecution 事后检查，文件编辑仅 afterFileEdit 事后报告。
 */

export const CURSOR_SKILLS_REL_DIR = '.cursor/skills';
export const CURSOR_AGENTS_REL_DIR = '.cursor/agents';
export const CURSOR_HOOKS_REL_FILE = '.cursor/hooks.json';
export const CURSOR_RUNTIME_REL_FILE = '.cursor/hooks/openlogos-runtime.cjs';
/** 事后检查引擎部署副本：资产身份以与 plugin/bin/guard-post-check.cjs 的字节（哈希）一致为准，缺失或漂移即刷新。 */
export const CURSOR_ENGINE_REL_FILE = '.cursor/hooks/openlogos-guard-post.cjs';
export const CURSOR_LEGACY_RULES_REL_DIR = '.cursor/rules';
/** 备份目录建在 `.cursor/` 下（目标同级、同卷），不建在 os.tmpdir()——项目不在系统盘时 rename 会 EXDEV（架构 §五十二 52.3）。 */
export const CURSOR_BACKUP_DIR_PREFIX = '.openlogos-cursor-backup-';
export const CURSOR_COMMAND_SKILL_PREFIX = 'openlogos-';
/** 托管 hooks 条目的身份锚：command 含此片段即视为 OpenLogos 托管。 */
export const CURSOR_MANAGED_HOOK_ANCHOR = 'openlogos-runtime.cjs';
/** 实际部署的事件集合（spec/cursor-plugin.md §7）；模板 plugin-cursor/hooks/hooks.json 必须与之同步。 */
export const CURSOR_HOOK_EVENTS = ['sessionStart', 'beforeShellExecution', 'afterShellExecution', 'afterFileEdit'] as const;

/** guard 部分强度提示行（固定必显，不随 locale 翻译协议表述；不得把 Cursor 表述为与 claude-code 等价）。 */
export const CURSOR_GUARD_STRENGTH_NOTICE_ZH =
  'Guard strength on Cursor (IDE and cursor-agent CLI) is partial: shell commands get a light pre-check via beforeShellExecution (guard-scope changes need host approval) plus an afterShellExecution post-check; file edits are only reported after the fact via afterFileEdit and are never blocked beforehand. OpenLogos does not wire preToolUse, so Cursor is not equivalent to claude-code.';

export interface CursorDeploymentResult {
  target: string;
  status: 'installed' | 'updated' | 'unchanged';
  skillCount: number;
  commandCount: number;
  agentCount: number;
  hookEvents: string[];
  removedMdc: string[];
  preserved: string[];
}

export class CursorDeployError extends Error {
  constructor(message: string, readonly blockedPath?: string) {
    super(message);
  }
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]+?)\n---\n/.exec(normalized);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return fields;
}

/** 托管归属哨兵：部署时写入每个 OpenLogos 托管 skill 目录，回收/幂等/冲突判定的唯一锚。 */
export const CURSOR_MANAGED_SENTINEL = '.openlogos-managed';

function isManagedSkillDir(dir: string): boolean {
  if (existsSync(join(dir, CURSOR_MANAGED_SENTINEL))) return true;
  // 兼容锚：description 以 OpenLogos 开头（哨兵缺失的降级判定）。
  const skillFile = join(dir, 'SKILL.md');
  if (!existsSync(skillFile)) return false;
  const fields = parseFrontmatter(readFileSync(skillFile, 'utf8'));
  return fields !== null && typeof fields.description === 'string' && fields.description.startsWith('OpenLogos');
}

function sourceTreeMatches(source: string, target: string): boolean {
  if (!existsSync(target)) return false;
  const sourceEntries = readdirSync(source).sort();
  const targetEntries = readdirSync(target).sort();
  if (JSON.stringify(sourceEntries) !== JSON.stringify(targetEntries)) return false;
  for (const entry of sourceEntries) {
    const sourceEntry = join(source, entry);
    const targetEntry = join(target, entry);
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

/** 校验 prepared 模板：skills/commands frontmatter、subagent、hooks 模板与 runtime。 */
export function validateCursorPrepared(prepared: string): void {
  for (const relative of ['agents/change-reviewer.md', 'hooks/hooks.json', 'hooks/runtime.cjs']) {
    if (!existsSync(join(prepared, relative))) throw new CursorDeployError(`Cursor 模板缺少：${relative}`);
  }
  let hooksTemplate: unknown;
  try {
    hooksTemplate = JSON.parse(readFileSync(join(prepared, 'hooks', 'hooks.json'), 'utf8'));
  } catch (error) {
    throw new CursorDeployError(`Cursor hooks 模板无法解析：${error instanceof Error ? error.message : String(error)}`);
  }
  const hooks = (hooksTemplate as { hooks?: Record<string, unknown> }).hooks ?? {};
  for (const event of CURSOR_HOOK_EVENTS) {
    if (!Array.isArray(hooks[event]) || (hooks[event] as unknown[]).length === 0) {
      throw new CursorDeployError(`Cursor hooks 模板缺少事件：${event}`);
    }
  }
  for (const group of ['skills', 'commands'] as const) {
    const groupDir = join(prepared, group);
    if (!existsSync(groupDir)) throw new CursorDeployError(`Cursor 模板缺少：${group}/`);
    for (const name of readdirSync(groupDir)) {
      const skillFile = join(groupDir, name, 'SKILL.md');
      if (!statSync(join(groupDir, name)).isDirectory()) continue;
      if (!existsSync(skillFile)) throw new CursorDeployError(`Cursor ${group} 缺少 SKILL.md：${name}`);
      const fields = parseFrontmatter(readFileSync(skillFile, 'utf8'));
      if (!fields) throw new CursorDeployError(`Cursor SKILL.md frontmatter 非法：${group}/${name}`);
      if (fields.name !== name) {
        throw new CursorDeployError(`Cursor SKILL.md frontmatter name 与目录不一致：${group}/${name}（name=${fields.name ?? '缺失'}）`);
      }
      if (!fields.description) throw new CursorDeployError(`Cursor SKILL.md 缺少 description：${group}/${name}`);
      if (group === 'commands' && fields['disable-model-invocation'] !== 'true') {
        throw new CursorDeployError(`Cursor 命令 Skill 缺少 disable-model-invocation: true：${name}`);
      }
    }
  }
}

function ensureSkillFrontmatter(skillFile: string, name: string): void {
  const content = readFileSync(skillFile, 'utf8');
  if (content.replace(/\r\n/g, '\n').startsWith('---\n')) return;
  const description = `OpenLogos ${name} 方法论 Skill`.replace(/"/g, '\\"');
  writeFileSync(skillFile, `---\nname: "${name}"\ndescription: "${description}"\n---\n\n${content}`);
}

/** 把 claude 模板 commands/*.md 转换为 disable-model-invocation 显式命令 Skills。 */
function prepareCommandSkills(commandsSource: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  for (const file of readdirSync(commandsSource)) {
    if (!file.endsWith('.md')) continue;
    const base = basename(file, '.md');
    const name = `${CURSOR_COMMAND_SKILL_PREFIX}${base}`;
    const body = readFileSync(join(commandsSource, file), 'utf8')
      .replaceAll('--ai-tool claude-code', '--ai-tool cursor')
      .replaceAll('${CLAUDE_PLUGIN_ROOT}/bin/openlogos-phase --plain', 'openlogos next')
      .replaceAll('${CLAUDE_PLUGIN_ROOT}', '.cursor');
    const stripped = body.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]+?\n---\n/, '');
    const description = `OpenLogos ${base} command`.replace(/"/g, '\\"');
    const dir = join(targetDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'),
      `---\nname: "${name}"\ndescription: "OpenLogos — ${description}"\ndisable-model-invocation: true\n---\n\n${stripped}`);
  }
}

/**
 * hooks.json 合并：只增改托管条目（command 含 CURSOR_MANAGED_HOOK_ANCHOR），
 * 保留用户条目与未知字段。返回 { content, userEntriesBefore }；解析失败 fail loud、零写入。
 */
export function mergeCursorHooksContent(existingRaw: string | null, templateRaw: string): {
  content: string;
  preservedUserEntries: number;
} {
  const template = JSON.parse(templateRaw) as { hooks: Record<string, Array<Record<string, unknown>>> };
  let document: Record<string, unknown>;
  if (existingRaw === null) {
    document = { version: 1, hooks: {} };
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existingRaw);
    } catch (error) {
      throw new CursorDeployError(
        `.cursor/hooks.json 无法解析（零写入）：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CursorDeployError('.cursor/hooks.json 顶层必须是对象（零写入）');
    }
    document = parsed as Record<string, unknown>;
  }
  if (document.version === undefined) document.version = 1;
  const hooks = (document.hooks && typeof document.hooks === 'object' && !Array.isArray(document.hooks))
    ? document.hooks as Record<string, unknown>
    : {};
  document.hooks = hooks;
  let preservedUserEntries = 0;
  const isManaged = (entry: unknown): boolean =>
    !!entry && typeof entry === 'object'
    && typeof (entry as Record<string, unknown>).command === 'string'
    && ((entry as Record<string, unknown>).command as string).includes(CURSOR_MANAGED_HOOK_ANCHOR);
  for (const [event, entries] of Object.entries(hooks)) {
    if (Array.isArray(entries)) preservedUserEntries += entries.filter(entry => !isManaged(entry)).length;
    void event;
  }
  for (const event of CURSOR_HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] as unknown[] : [];
    const userEntries = existing.filter(entry => !isManaged(entry));
    hooks[event] = [...userEntries, ...template.hooks[event]];
  }
  return { content: `${JSON.stringify(document, null, 2)}\n`, preservedUserEntries };
}

/** 卸载/回滚辅助：从 hooks.json 内容中移除托管条目（用户条目原样保留）。 */
export function stripManagedCursorHooks(raw: string): string {
  const document = JSON.parse(raw) as Record<string, unknown>;
  const hooks = (document.hooks ?? {}) as Record<string, unknown>;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter(entry => !(entry && typeof entry === 'object'
      && typeof (entry as Record<string, unknown>).command === 'string'
      && ((entry as Record<string, unknown>).command as string).includes(CURSOR_MANAGED_HOOK_ANCHOR)));
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}

function atomicWrite(target: string, content: string | Buffer): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.openlogos-cursor-tmp-${process.pid}-${Date.now()}`);
  writeFileSync(temp, content);
  renameWithRetry(temp, target);
}

/**
 * 事后检查引擎源：显式传入优先；否则按模板相对位置查找包内唯一源
 * （仓库布局 plugin-cursor → plugin/bin；npm 包布局 cursor-plugin-template → claude-plugin-template/bin）。
 */
export function findCursorEngineSource(source: string, explicit?: string | null): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = explicit ? [explicit] : [
    join(source, '..', 'plugin', 'bin', 'guard-post-check.cjs'),
    join(source, '..', 'claude-plugin-template', 'bin', 'guard-post-check.cjs'),
    // 按本模块位置回退（与 init 的 findClaudePluginTemplateSource 同口径：npm 包 dist/lib → 包根，仓库 cli/dist/lib → 仓库根）
    join(moduleDir, '..', '..', 'claude-plugin-template', 'bin', 'guard-post-check.cjs'),
    join(moduleDir, '..', '..', '..', 'plugin', 'bin', 'guard-post-check.cjs'),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

interface RollbackStep {
  undo: () => void;
}

/**
 * 首写前预检（init/adopt 早期调用，零写入）：hooks.json 可解析 + 目标无非托管冲突。
 * 与 deployCursorAssets 内部预检构成双保险；失败时项目字节保持全旧。
 */
export function preflightCursorTarget(
  root: string,
  sharedAssets: { skills?: string | null; commands?: string | null },
  managedSkillNames: readonly string[],
): void {
  const hooksPath = join(root, ...CURSOR_HOOKS_REL_FILE.split('/'));
  if (existsSync(hooksPath)) {
    try {
      JSON.parse(readFileSync(hooksPath, 'utf8'));
    } catch (error) {
      throw new CursorDeployError(
        `.cursor/hooks.json 无法解析（零写入）：${error instanceof Error ? error.message : String(error)}`,
        CURSOR_HOOKS_REL_FILE);
    }
  }
  const planned = new Set<string>(managedSkillNames);
  if (sharedAssets.skills && existsSync(sharedAssets.skills)) {
    for (const name of readdirSync(sharedAssets.skills)) {
      if (statSync(join(sharedAssets.skills, name)).isDirectory()) planned.add(name);
    }
  }
  if (sharedAssets.commands && existsSync(sharedAssets.commands)) {
    for (const file of readdirSync(sharedAssets.commands)) {
      if (file.endsWith('.md')) planned.add(`${CURSOR_COMMAND_SKILL_PREFIX}${basename(file, '.md')}`);
    }
  }
  const skillsRoot = join(root, ...CURSOR_SKILLS_REL_DIR.split('/'));
  for (const name of [...planned].sort()) {
    const target = join(skillsRoot, name);
    if (existsSync(target) && !isManagedSkillDir(target)) {
      throw new CursorDeployError(
        `Cursor Skills 目标存在非 OpenLogos 托管内容：${CURSOR_SKILLS_REL_DIR}/${name}`,
        `${CURSOR_SKILLS_REL_DIR}/${name}`);
    }
  }
  const agentTarget = join(root, ...CURSOR_AGENTS_REL_DIR.split('/'), 'change-reviewer.md');
  if (existsSync(agentTarget) && !readFileSync(agentTarget, 'utf8').includes('OpenLogos')) {
    throw new CursorDeployError(
      `Cursor subagent 目标存在非 OpenLogos 内容：${CURSOR_AGENTS_REL_DIR}/change-reviewer.md`,
      `${CURSOR_AGENTS_REL_DIR}/change-reviewer.md`);
  }
}

/**
 * 部署 Cursor 三件套。sharedAssets.skills 为共享方法论 Skills 源目录；
 * sharedAssets.commands 为 claude 模板 commands 目录（转换为显式命令 Skills）。
 * managedSkillNames 用于派生托管 .mdc 清理清单（+ openlogos-policy.mdc）。
 */
export function deployCursorAssets(
  root: string,
  source: string,
  sharedAssets: { skills?: string | null; commands?: string | null; engine?: string | null },
  managedSkillNames: readonly string[],
  locale: 'zh' | 'en' = 'zh',
): CursorDeploymentResult {
  // ── 准备阶段：组装 prepared 模板并校验 ──
  const preparedRoot = mkdtempSync(join(tmpdir(), 'openlogos-cursor-prepared-'));
  const prepared = join(preparedRoot, 'cursor');
  try {
    cpSync(source, prepared, { recursive: true });
    if (sharedAssets.skills && existsSync(sharedAssets.skills)) {
      const skillsTarget = join(prepared, 'skills');
      removeTree(skillsTarget);
      mkdirSync(skillsTarget, { recursive: true });
      for (const name of readdirSync(sharedAssets.skills)) {
        const sourceDir = join(sharedAssets.skills, name);
        if (!statSync(sourceDir).isDirectory()) continue;
        cpSync(sourceDir, join(skillsTarget, name), { recursive: true });
        const skillFile = join(skillsTarget, name, 'SKILL.md');
        // 内容语言遵循项目 locale：en 且存在 SKILL.en.md 时以其为正文；统一只保留单一 SKILL.md。
        const englishVariant = join(skillsTarget, name, 'SKILL.en.md');
        if (locale === 'en' && existsSync(englishVariant)) {
          writeFileSync(skillFile, readFileSync(englishVariant));
        }
        rmSync(englishVariant, { force: true });
        if (existsSync(skillFile)) ensureSkillFrontmatter(skillFile, name);
      }
    }
    if (sharedAssets.commands && existsSync(sharedAssets.commands)) {
      removeTree(join(prepared, 'commands'));
      prepareCommandSkills(sharedAssets.commands, join(prepared, 'commands'));
    }
    if (!existsSync(join(prepared, 'skills'))) mkdirSync(join(prepared, 'skills'), { recursive: true });
    if (!existsSync(join(prepared, 'commands'))) mkdirSync(join(prepared, 'commands'), { recursive: true });
    // 托管归属哨兵：写入每个待部署目录（prepared 与目标树保持一致以支撑幂等比较）。
    for (const group of ['skills', 'commands'] as const) {
      for (const name of readdirSync(join(prepared, group))) {
        const dir = join(prepared, group, name);
        if (statSync(dir).isDirectory()) writeFileSync(join(dir, CURSOR_MANAGED_SENTINEL), 'openlogos: managed\n');
      }
    }
    validateCursorPrepared(prepared);
    // 随包缺少事后检查引擎：部署预检失败（首个写入前，fail loud 点名资产路径）
    const engineSource = findCursorEngineSource(source, sharedAssets.engine);
    if (!engineSource) {
      throw new CursorDeployError(
        `随包资产缺失：plugin/bin/guard-post-check.cjs（guard 事后检查引擎），无法部署 ${CURSOR_ENGINE_REL_FILE}；请重新安装 openlogos 后再运行 openlogos sync`,
        CURSOR_ENGINE_REL_FILE);
    }

    // ── 预检：hooks.json 可解析、目标无非托管冲突（首个写入前完成） ──
    const hooksPath = join(root, ...CURSOR_HOOKS_REL_FILE.split('/'));
    const hooksBefore = existsSync(hooksPath) ? readFileSync(hooksPath, 'utf8') : null;
    const merged = mergeCursorHooksContent(hooksBefore, readFileSync(join(prepared, 'hooks', 'hooks.json'), 'utf8'));

    const skillsRoot = join(root, ...CURSOR_SKILLS_REL_DIR.split('/'));
    const plannedDirs: Array<{ name: string; prepared: string; target: string }> = [];
    for (const group of ['skills', 'commands'] as const) {
      for (const name of readdirSync(join(prepared, group)).sort()) {
        if (!statSync(join(prepared, group, name)).isDirectory()) continue;
        plannedDirs.push({ name, prepared: join(prepared, group, name), target: join(skillsRoot, name) });
      }
    }
    for (const plan of plannedDirs) {
      if (existsSync(plan.target) && !isManagedSkillDir(plan.target)) {
        throw new CursorDeployError(
          `Cursor Skills 目标存在非 OpenLogos 托管内容：${CURSOR_SKILLS_REL_DIR}/${plan.name}`,
          `${CURSOR_SKILLS_REL_DIR}/${plan.name}`);
      }
    }
    const agentSource = join(prepared, 'agents', 'change-reviewer.md');
    const agentTarget = join(root, ...CURSOR_AGENTS_REL_DIR.split('/'), 'change-reviewer.md');
    if (existsSync(agentTarget) && !readFileSync(agentTarget, 'utf8').includes('OpenLogos')) {
      throw new CursorDeployError(
        `Cursor subagent 目标存在非 OpenLogos 内容：${CURSOR_AGENTS_REL_DIR}/change-reviewer.md`,
        `${CURSOR_AGENTS_REL_DIR}/change-reviewer.md`);
    }

    // preserved 明细：用户自有 rules / 非托管 skills / hooks 用户条目
    const preserved: string[] = [];
    const legacyRulesDir = join(root, ...CURSOR_LEGACY_RULES_REL_DIR.split('/'));
    const managedMdc = new Set([...managedSkillNames.map(name => `${name}.mdc`), 'openlogos-policy.mdc']);
    if (existsSync(legacyRulesDir)) {
      for (const file of readdirSync(legacyRulesDir).sort()) {
        if (!managedMdc.has(file)) preserved.push(`${CURSOR_LEGACY_RULES_REL_DIR}/${file}`);
      }
    }
    if (existsSync(skillsRoot)) {
      const plannedNames = new Set(plannedDirs.map(plan => plan.name));
      for (const name of readdirSync(skillsRoot).sort()) {
        if (!plannedNames.has(name)) preserved.push(`${CURSOR_SKILLS_REL_DIR}/${name}`);
      }
    }
    if (merged.preservedUserEntries > 0) {
      preserved.push(`${CURSOR_HOOKS_REL_FILE}（${merged.preservedUserEntries} 条用户 hooks 条目）`);
    }

    // ── 执行阶段：Skills/subagent → runtime → hooks 合并 → .mdc 清理 ──
    const rollback: RollbackStep[] = [];
    const cursorDir = join(root, '.cursor');
    mkdirSync(cursorDir, { recursive: true });
    const backupRoot = mkdtempSync(join(cursorDir, CURSOR_BACKUP_DIR_PREFIX));
    let changed = false;
    let installedAny = false;
    try {
      for (const plan of plannedDirs) {
        if (sourceTreeMatches(plan.prepared, plan.target)) continue;
        const existed = existsSync(plan.target);
        if (existed) {
          const backup = join(backupRoot, `skill-${plan.name}`);
          renameWithRetry(plan.target, backup);
          rollback.push({ undo: () => { removeTree(plan.target); renameWithRetry(backup, plan.target); } });
        } else {
          installedAny = true;
          rollback.push({ undo: () => removeTree(plan.target) });
        }
        // 先在同卷备份目录内组装新目录，再整体 rename 到目标位置（安装 rename）。
        const staged = join(backupRoot, `new-${plan.name}`);
        cpSync(plan.prepared, staged, { recursive: true });
        mkdirSync(dirname(plan.target), { recursive: true });
        renameWithRetry(staged, plan.target);
        changed = true;
      }
      const agentBytes = readFileSync(agentSource);
      if (!existsSync(agentTarget) || !readFileSync(agentTarget).equals(agentBytes)) {
        const existed = existsSync(agentTarget);
        if (existed) {
          const backup = join(backupRoot, 'agent-change-reviewer.md');
          renameWithRetry(agentTarget, backup);
          rollback.push({ undo: () => { rmSync(agentTarget, { force: true }); renameWithRetry(backup, agentTarget); } });
        } else {
          installedAny = true;
          rollback.push({ undo: () => rmSync(agentTarget, { force: true }) });
        }
        mkdirSync(dirname(agentTarget), { recursive: true });
        writeFileSync(agentTarget, agentBytes);
        changed = true;
      }
      if (process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT === 'after-skills') {
        throw new CursorDeployError('注入的 Cursor 事务故障（after-skills）');
      }

      const runtimeTarget = join(root, ...CURSOR_RUNTIME_REL_FILE.split('/'));
      const runtimeBytes = readFileSync(join(prepared, 'hooks', 'runtime.cjs'));
      if (!existsSync(runtimeTarget) || !readFileSync(runtimeTarget).equals(runtimeBytes)) {
        const runtimeBefore = existsSync(runtimeTarget) ? readFileSync(runtimeTarget) : null;
        rollback.push({ undo: () => {
          if (runtimeBefore === null) rmSync(runtimeTarget, { force: true });
          else writeFileSync(runtimeTarget, runtimeBefore);
        } });
        atomicWrite(runtimeTarget, runtimeBytes.toString('utf8'));
        changed = true;
      }

      // 事后检查引擎：与包内唯一源同一份字节（哈希一致即视为同一资产，缺失或漂移即刷新）
      const engineTarget = join(root, ...CURSOR_ENGINE_REL_FILE.split('/'));
      const engineBytes = readFileSync(engineSource);
      if (!existsSync(engineTarget) || !readFileSync(engineTarget).equals(engineBytes)) {
        const engineBefore = existsSync(engineTarget) ? readFileSync(engineTarget) : null;
        rollback.push({ undo: () => {
          if (engineBefore === null) rmSync(engineTarget, { force: true });
          else writeFileSync(engineTarget, engineBefore);
        } });
        atomicWrite(engineTarget, engineBytes);
        changed = true;
      }

      if (hooksBefore !== merged.content) {
        rollback.push({ undo: () => {
          if (hooksBefore === null) rmSync(hooksPath, { force: true });
          else writeFileSync(hooksPath, hooksBefore);
        } });
        atomicWrite(hooksPath, merged.content);
        // 读回校验：用户条目在合并后必须原样在场（fail-closed）。
        const readBack = readFileSync(hooksPath, 'utf8');
        const reMerged = mergeCursorHooksContent(readBack, readFileSync(join(prepared, 'hooks', 'hooks.json'), 'utf8'));
        if (reMerged.preservedUserEntries !== merged.preservedUserEntries) {
          throw new CursorDeployError('.cursor/hooks.json 读回校验失败：用户条目漂移');
        }
        changed = true;
      }
      if (process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT === 'after-hooks') {
        throw new CursorDeployError('注入的 Cursor 事务故障（after-hooks）');
      }

      // .mdc 清理是迁移完成点：只有全部前序步骤成功才执行；清理项不进回滚（显式迁移）。
      const removedMdc: string[] = [];
      if (existsSync(legacyRulesDir)) {
        for (const file of [...managedMdc].sort()) {
          const legacy = join(legacyRulesDir, file);
          if (existsSync(legacy)) {
            rmSync(legacy, { force: true });
            removedMdc.push(`${CURSOR_LEGACY_RULES_REL_DIR}/${file}`);
            changed = true;
          }
        }
      }

      removeTree(backupRoot);
      // 前次回滚未完成而保留的备份目录，在本次成功后清理。
      for (const entry of readdirSync(cursorDir)) {
        if (entry.startsWith(CURSOR_BACKUP_DIR_PREFIX)) removeTree(join(cursorDir, entry));
      }
      const skillCount = plannedDirs.filter(plan => !plan.name.startsWith(CURSOR_COMMAND_SKILL_PREFIX)).length;
      const commandCount = plannedDirs.length - skillCount;
      return {
        target: CURSOR_SKILLS_REL_DIR,
        status: changed ? (installedAny ? 'installed' : 'updated') : 'unchanged',
        skillCount,
        commandCount,
        agentCount: 1,
        hookEvents: [...CURSOR_HOOK_EVENTS],
        removedMdc,
        preserved,
      };
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const step of rollback.reverse()) {
        try { step.undo(); } catch (undoError) {
          rollbackFailures.push(undoError instanceof Error ? undoError.message : String(undoError));
        }
      }
      if (rollbackFailures.length > 0) {
        // 回滚未完成：保留备份目录（内含原托管目录），如实报告位置，不做清理。
        throw new CursorDeployError(
          `Cursor 托管目录替换失败且回滚未完成：原目录备份保留于 ${backupRoot}，请手动移回后重试`
            + `（替换：${error instanceof Error ? error.message : String(error)}；回滚：${rollbackFailures.join('；')}）`,
          CURSOR_SKILLS_REL_DIR);
      }
      removeTree(backupRoot);
      throw error;
    }
  } finally {
    removeTree(preparedRoot);
  }
}

export function localizedCursorResult(
  locale: 'zh' | 'en',
  result: CursorDeploymentResult,
  newSession = true,
): string {
  const action = locale === 'zh'
    ? ({ installed: '已安装', updated: '已更新', unchanged: '未变化' } as const)[result.status]
    : ({ installed: 'installed', updated: 'updated', unchanged: 'unchanged' } as const)[result.status];
  const migration = result.removedMdc.length > 0
    ? (locale === 'zh'
      ? `；已迁移清理托管 .mdc ${result.removedMdc.length} 个（${result.removedMdc.join(', ')}）`
      : `; migrated ${result.removedMdc.length} managed .mdc (${result.removedMdc.join(', ')})`)
    : '';
  const preserved = result.preserved.length > 0
    ? (locale === 'zh' ? `；已保留 ${result.preserved.join(', ')}` : `; preserved ${result.preserved.join(', ')}`)
    : '';
  const session = newSession
    ? (locale === 'zh' ? '；请新建 Cursor session 加载刷新后的 Skills 与 hooks' : '; start a new Cursor session to load refreshed skills and hooks')
    : '';
  const head = locale === 'zh'
    ? `Cursor 三件套${action}：Skills ${result.skillCount} + 命令 ${result.commandCount} + subagent ${result.agentCount}，hooks（${result.hookEvents.join(', ')}）`
    : `Cursor assets ${action}: ${result.skillCount} skills + ${result.commandCount} commands + ${result.agentCount} subagent, hooks (${result.hookEvents.join(', ')})`;
  return `${head}${migration}${preserved}${session}`;
}

/** AGENTS.md 的 Cursor 宿主指令段（guard 强度必显行，capability honesty）。 */
export function createCursorAgentsInstruction(locale: 'zh' | 'en', lifecycle: string): string {
  return locale === 'zh'
    ? `OpenLogos Cursor 指令：当前 lifecycle=${lifecycle}。OpenLogos Skills 部署于 .cursor/skills/（显式命令以 /openlogos-<command> 触发），change-reviewer subagent 部署于 .cursor/agents/。写入门禁在 Cursor（IDE 与 cursor-agent CLI）下为部分强度：shell 命令经 beforeShellExecution 事前轻判（保护范围变更命令需宿主审批）并经 afterShellExecution 事后检查；文件编辑经 afterFileEdit 事后报告，不被事前阻断。OpenLogos 未接入 preToolUse，与 claude-code 不等价。sessionStart 注入的上下文不构成写入授权。`
    : `OpenLogos Cursor instructions: lifecycle=${lifecycle}. OpenLogos Skills live in .cursor/skills/ (explicit commands via /openlogos-<command>); the change-reviewer subagent lives in .cursor/agents/. Write guard on Cursor (IDE and cursor-agent CLI) is partial-strength: shell commands get a light pre-check via beforeShellExecution (guard-scope changes need host approval) plus an afterShellExecution post-check; file edits are only reported after the fact via afterFileEdit and are never blocked beforehand. OpenLogos does not wire preToolUse, so Cursor is not equivalent to claude-code. sessionStart context never grants write authorization.`;
}
