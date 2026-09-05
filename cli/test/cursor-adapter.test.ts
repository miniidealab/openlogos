import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SKILL_NAMES,
  createLogosConfig,
  deployAiToolAssets,
  expandAiTools,
  findCursorPluginTemplateSource,
  findClaudePluginTemplateSource,
  findSkillsSource,
  init,
  parseAiTool,
} from '../src/commands/init.js';
import { aiToolAdapterRegistry, expandRegisteredAiTools } from '../src/lib/ai-tool-adapter.js';
import {
  CURSOR_GUARD_STRENGTH_NOTICE_ZH,
  CursorDeployError,
  createCursorAgentsInstruction,
  deployCursorAssets,
  localizedCursorResult,
  mergeCursorHooksContent,
  preflightCursorTarget,
  validateCursorPrepared,
} from '../src/lib/cursor-adapter.js';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit } from './helpers.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function sharedAssets() {
  const claudeTemplate = findClaudePluginTemplateSource();
  return {
    skills: findSkillsSource(),
    commands: claudeTemplate ? join(claudeTemplate, 'commands') : null,
  };
}

function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(dir: string, prefix = '') {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, relative);
      else result[relative] = readFileSync(full).toString('base64');
    }
  }
  walk(root);
  return result;
}

function writeForeignSkill(root: string, name = 'prd-writer') {
  const dir = join(root, '.cursor', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: "prd-writer"\ndescription: "my private skill"\n---\n\nuser content\n');
}

describe('Cursor Adapter — S01 三件套初始化', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let consoleCapture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    restoreCwd = mockCwd(root);
    consoleCapture = captureConsole();
    process.env.OPENLOGOS_CODEX_PERSONAL_HOME = join(root, '.test-codex-home');
  });

  afterEach(() => {
    delete process.env.OPENLOGOS_CODEX_PERSONAL_HOME;
    delete process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT;
    consoleCapture.restore();
    restoreCwd();
    cleanup();
  });

  it('UT-S01-129: cursor capability 三件套且 preToolUse 如实声明 false（capability honesty）', () => {
    const capabilities = aiToolAdapterRegistry.get('cursor').capabilities;
    expect(capabilities.assets).toEqual(['agents', 'plugin', 'hooks']);
    expect(capabilities).toMatchObject({
      instructions: true, skills: true, commands: true, agents: true, sessionStart: true,
      preToolUse: false,
    });
    expect(parseAiTool('cursor')).toBe('cursor');
    expect(JSON.parse(createLogosConfig('demo', 'zh', 'cursor')).aiTool).toBe('cursor');
  });

  it('UT-S01-130: all 稳定展开含 cursor、排除 other；空数组默认语义不变', () => {
    expect(expandAiTools('all')).toEqual(['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy']);
    expect(expandAiTools('all')).not.toContain('other');
    expect(expandRegisteredAiTools([])).toEqual(['cursor']);
  });

  it('UT-S01-131: Cursor 资产规划精确包含 Skills、命令 Skills、subagent 与三 hooks 托管条目，无 .mdc 产物', () => {
    const result = deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES);
    expect(result.skillCount).toBeGreaterThanOrEqual(13);
    expect(result.commandCount).toBeGreaterThan(0);
    expect(result.agentCount).toBe(1);
    expect(result.hookEvents).toEqual(['sessionStart', 'beforeShellExecution', 'afterFileEdit']);
    expect(existsSync(join(root, '.cursor/skills/prd-writer/SKILL.md'))).toBe(true);
    const command = readFileSync(join(root, '.cursor/skills/openlogos-next/SKILL.md'), 'utf8');
    expect(command).toContain('disable-model-invocation: true');
    expect(existsSync(join(root, '.cursor/agents/change-reviewer.md'))).toBe(true);
    const hooks = JSON.parse(readFileSync(join(root, '.cursor/hooks.json'), 'utf8'));
    expect(Object.keys(hooks.hooks).sort()).toEqual(['afterFileEdit', 'beforeShellExecution', 'sessionStart']);
    expect(existsSync(join(root, '.cursor/rules'))).toBe(false);
  });

  it('UT-S01-132: SKILL.md frontmatter 非法（name 与目录不一致 / 缺 description）在部署前失败', () => {
    const badTemplate = mkdtempSync(join(tmpdir(), 'cursor-bad-template-'));
    try {
      cpSync(findCursorPluginTemplateSource()!, badTemplate, { recursive: true });
      const badSkill = join(badTemplate, 'skills', 'bad-skill');
      mkdirSync(badSkill, { recursive: true });
      writeFileSync(join(badSkill, 'SKILL.md'), '---\nname: "other-name"\ndescription: "OpenLogos bad"\n---\n\nbody\n');
      expect(() => validateCursorPrepared(badTemplate)).toThrow(/name 与目录不一致/);
      expect(() => deployCursorAssets(root, badTemplate, {}, SKILL_NAMES)).toThrow(/name 与目录不一致/);
      expect(existsSync(join(root, '.cursor'))).toBe(false);
    } finally {
      rmSync(badTemplate, { recursive: true, force: true });
    }
  });

  it('UT-S01-133: hooks.json 不存在时创建 version 1；存在时仅增托管条目且用户条目字节不变；损坏 fail loud 零写入', () => {
    const template = readFileSync(join(findCursorPluginTemplateSource()!, 'hooks', 'hooks.json'), 'utf8');
    const created = mergeCursorHooksContent(null, template);
    const createdDoc = JSON.parse(created.content);
    expect(createdDoc.version).toBe(1);
    expect(created.preservedUserEntries).toBe(0);

    const userDoc = {
      version: 1,
      customTopLevel: { keep: true },
      hooks: {
        beforeShellExecution: [{ type: 'command', command: './my-own-guard.sh', timeout: 9 }],
        stop: [{ type: 'command', command: './on-stop.sh' }],
      },
    };
    const merged = mergeCursorHooksContent(JSON.stringify(userDoc), template);
    const mergedDoc = JSON.parse(merged.content);
    expect(merged.preservedUserEntries).toBe(2);
    expect(mergedDoc.customTopLevel).toEqual({ keep: true });
    expect(mergedDoc.hooks.stop).toEqual(userDoc.hooks.stop);
    expect(mergedDoc.hooks.beforeShellExecution[0]).toEqual(userDoc.hooks.beforeShellExecution[0]);
    expect(JSON.stringify(mergedDoc.hooks.beforeShellExecution[1].command)).toContain('openlogos-runtime.cjs');

    mkdirSync(join(root, '.cursor'), { recursive: true });
    writeFileSync(join(root, '.cursor', 'hooks.json'), '{ broken json');
    const before = snapshot(root);
    expect(() => deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES))
      .toThrow(/hooks\.json 无法解析/);
    expect(snapshot(root)).toEqual(before);
  });

  it('UT-S01-134: 真实 npm pack 清单包含完整 cursor-plugin-template 且版本同源', () => {
    const packRoot = mkdtempSync(join(tmpdir(), 'openlogos-cursor-pack-'));
    try {
      const pkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
      expect(pkg.files).toContain('cursor-plugin-template');
      expect(pkg.scripts.prepack).toContain('build:cursor-template');
      pkg.scripts = {};
      writeFileSync(join(packRoot, 'package.json'), JSON.stringify(pkg));
      const built = join(cliRoot, 'cursor-plugin-template');
      if (!existsSync(built)) {
        const build = spawnSync(process.execPath, [join(cliRoot, 'scripts', 'build-cursor-template.mjs')], { encoding: 'utf8' });
        expect(build.status, build.stderr).toBe(0);
      }
      cpSync(built, join(packRoot, 'cursor-plugin-template'), { recursive: true });
      const packed = spawnSync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts'], { cwd: packRoot, encoding: 'utf8' });
      expect(packed.status, packed.stderr).toBe(0);
      const packResult = JSON.parse(packed.stdout)[0];
      expect(packResult.version).toBe(pkg.version);
      const paths = new Set(packResult.files.map((file: { path: string }) => file.path));
      for (const required of [
        'cursor-plugin-template/hooks/hooks.json',
        'cursor-plugin-template/hooks/runtime.cjs',
        'cursor-plugin-template/hooks/runtime.mjs',
        'cursor-plugin-template/agents/change-reviewer.md',
        'cursor-plugin-template/skills/prd-writer/SKILL.md',
        'cursor-plugin-template/commands/openlogos-next/SKILL.md',
      ]) expect(paths.has(required), required).toBe(true);
    } finally {
      rmSync(packRoot, { recursive: true, force: true });
    }
  });

  it('UT-S01-135: 目标 Skills 目录含非 OpenLogos 内容时首个写入前 blocked 并报告精确路径', () => {
    writeForeignSkill(root);
    const before = snapshot(root);
    expect(() => preflightCursorTarget(root, sharedAssets(), SKILL_NAMES))
      .toThrow(/\.cursor\/skills\/prd-writer/);
    let blocked: CursorDeployError | null = null;
    try {
      deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES);
    } catch (error) {
      blocked = error as CursorDeployError;
    }
    expect(blocked).toBeInstanceOf(CursorDeployError);
    expect(blocked!.blockedPath).toBe('.cursor/skills/prd-writer');
    expect(snapshot(root)).toEqual(before);
    expect(existsSync(join(root, '.cursor/hooks.json'))).toBe(false);
  });

  it('UT-S01-136: 用户资产不进写计划、preserved 逐项可审计，成功输出含固定 guard 部分强度提示行', () => {
    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(root, '.cursor', 'rules', 'my-team-style.mdc'), 'user rule\n');
    mkdirSync(join(root, '.cursor', 'skills', 'my-skill'), { recursive: true });
    writeFileSync(join(root, '.cursor', 'skills', 'my-skill', 'SKILL.md'), '---\nname: "my-skill"\ndescription: "mine"\n---\nbody\n');
    writeFileSync(join(root, '.cursor', 'hooks.json') , JSON.stringify({ version: 1, hooks: { stop: [{ type: 'command', command: './mine.sh' }] } }));
    const userBytes = readFileSync(join(root, '.cursor/rules/my-team-style.mdc'), 'utf8');

    deployAiToolAssets(root, ['cursor'], 'zh', false);
    const output = consoleCapture.logs.join('\n');
    expect(output).toContain(CURSOR_GUARD_STRENGTH_NOTICE_ZH);
    expect(output).toContain('已保留');
    expect(readFileSync(join(root, '.cursor/rules/my-team-style.mdc'), 'utf8')).toBe(userBytes);
    expect(readFileSync(join(root, '.cursor/skills/my-skill/SKILL.md'), 'utf8')).toContain('mine');
    const hooks = JSON.parse(readFileSync(join(root, '.cursor/hooks.json'), 'utf8'));
    expect(hooks.hooks.stop).toEqual([{ type: 'command', command: './mine.sh' }]);
    const result = deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES);
    expect(result.status).toBe('unchanged');
    expect(result.preserved.join('\n')).toContain('.cursor/rules/my-team-style.mdc');
    expect(result.preserved.join('\n')).toContain('.cursor/skills/my-skill');
    expect(localizedCursorResult('zh', result)).toContain('已保留');
  });

  it('ST-S01-27: init --ai-tool cursor 一次性生成配置、Skills、subagent、hooks 与 AGENTS 指令', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    expect(JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf8')).aiTool).toBe('cursor');
    expect(existsSync(join(root, '.cursor/skills/prd-writer/SKILL.md'))).toBe(true);
    expect(readFileSync(join(root, '.cursor/skills/openlogos-next/SKILL.md'), 'utf8')).toContain('disable-model-invocation: true');
    expect(existsSync(join(root, '.cursor/agents/change-reviewer.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor/hooks.json'))).toBe(true);
    expect(existsSync(join(root, '.cursor/hooks/openlogos-runtime.cjs'))).toBe(true);
    expect(existsSync(join(root, '.cursor/rules'))).toBe(false);
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('<!-- OPENLOGOS:BEGIN -->');
    expect(agents).toContain('Cursor 宿主指令');
    expect(agents).toContain('.cursor/skills');
    expect(createCursorAgentsInstruction('zh', 'launched')).toContain('preToolUse');
  });

  it('ST-S01-28: all 展开含 cursor 且重复部署收敛为零漂移', async () => {
    await init('demo', { locale: 'en', aiTool: 'all' });
    const first = snapshot(join(root, '.cursor'));
    deployAiToolAssets(root, expandAiTools('all'), 'en', false);
    const second = snapshot(join(root, '.cursor'));
    expect(existsSync(join(root, '.cursor/skills/prd-writer/SKILL.md'))).toBe(true);
    expect(second).toEqual(first);
  });

  it('ST-S01-29: 冲突时 init 非零退出、总事务回滚、无半初始化', async () => {
    writeForeignSkill(root);
    const before = snapshot(root);
    const exit = mockProcessExit();
    try {
      await expect(init('demo', { locale: 'zh', aiTool: 'cursor' })).rejects.toThrow('process.exit(1)');
      expect(snapshot(root)).toEqual(before);
      expect(consoleCapture.errors.join('\n')).toContain('.cursor/skills/prd-writer');
    } finally {
      exit.mockRestore();
    }
  });
});
