import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  SKILL_NAMES,
  findClaudePluginTemplateSource,
  findCursorPluginTemplateSource,
  findSkillsSource,
} from '../src/commands/init.js';
import { adopt } from '../src/commands/adopt.js';
import { change } from '../src/commands/change.js';
import { aiToolAdapterRegistry } from '../src/lib/ai-tool-adapter.js';
import {
  CursorDeployError,
  deployCursorAssets,
  preflightCursorTarget,
} from '../src/lib/cursor-adapter.js';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit } from './helpers.js';

function treeSnapshot(root: string): Record<string, string> {
  const output: Record<string, string> = {};
  function walk(dir: string, prefix = '') {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, relative);
      else output[relative] = readFileSync(full).toString('base64');
    }
  }
  walk(root);
  return output;
}

function sharedAssets() {
  const claudeTemplate = findClaudePluginTemplateSource();
  return {
    skills: findSkillsSource(),
    commands: claudeTemplate ? join(claudeTemplate, 'commands') : null,
  };
}

function writeExistingProjectAssets(root: string) {
  // 存量项目：历史托管 .mdc + 用户自有 rules + 用户 hooks 条目 + 既有项目指令
  mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
  writeFileSync(join(root, '.cursor/rules/prd-writer.mdc'), '---\ndescription: "OpenLogos — prd-writer"\n---\nlegacy\n');
  writeFileSync(join(root, '.cursor/rules/my-team-style.mdc'), 'user rule keep me\n');
  writeFileSync(join(root, '.cursor/hooks.json'), JSON.stringify({
    version: 1,
    hooks: { stop: [{ type: 'command', command: './user-stop.sh' }] },
  }, null, 2) + '\n');
  writeFileSync(join(root, 'AGENTS.md'), '# 团队既有规则\n请保留我\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/app.ts'), 'export const app = 1;\n');
}

describe('Cursor adopt — S20 存量项目三件套接入与迁移', () => {
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

  it('UT-S20-43: adopt 解析 cursor 三件套能力（preToolUse=false），引导链路消费能力而非宿主名', async () => {
    const capabilities = aiToolAdapterRegistry.get('cursor').capabilities;
    expect(capabilities.assets).toContain('plugin');
    expect(capabilities.assets).toContain('hooks');
    expect(capabilities.preToolUse).toBe(false);
    await adopt('demo', { locale: 'zh', aiTool: 'cursor' });
    const config = JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf8'));
    expect(config.aiTool).toBe('cursor');
  });

  it('UT-S20-44: 存量资产边界扫描——用户 rules/skills/hooks 非托管条目识别为 preserved，不进写计划', () => {
    writeExistingProjectAssets(root);
    mkdirSync(join(root, '.cursor/skills/my-skill'), { recursive: true });
    writeFileSync(join(root, '.cursor/skills/my-skill/SKILL.md'), '---\nname: "my-skill"\ndescription: "mine"\n---\nmine\n');
    const result = deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES);
    const preserved = result.preserved.join('\n');
    expect(preserved).toContain('.cursor/rules/my-team-style.mdc');
    expect(preserved).toContain('.cursor/skills/my-skill');
    expect(preserved).toContain('用户 hooks 条目');
    expect(readFileSync(join(root, '.cursor/skills/my-skill/SKILL.md'), 'utf8')).toContain('mine');
  });

  it('UT-S20-45: 同名非托管 Skills 目录或 hooks 条目身份冲突时首个写入前 blocked，报告精确路径', () => {
    mkdirSync(join(root, '.cursor/skills/change-writer'), { recursive: true });
    writeFileSync(join(root, '.cursor/skills/change-writer/SKILL.md'), '---\nname: "change-writer"\ndescription: "mine"\n---\nprivate\n');
    let blocked: CursorDeployError | null = null;
    try {
      preflightCursorTarget(root, sharedAssets(), SKILL_NAMES);
    } catch (error) {
      blocked = error as CursorDeployError;
    }
    expect(blocked).toBeInstanceOf(CursorDeployError);
    expect(blocked!.blockedPath).toBe('.cursor/skills/change-writer');
    expect(readFileSync(join(root, '.cursor/skills/change-writer/SKILL.md'), 'utf8')).toContain('private');
  });

  it('UT-S20-46: 迁移完成点——Skills 部署成功后同次执行清理托管 .mdc；失败路径 .mdc 保留', () => {
    writeExistingProjectAssets(root);
    process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT = 'after-hooks';
    expect(() => deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES)).toThrow(/注入/);
    expect(existsSync(join(root, '.cursor/rules/prd-writer.mdc'))).toBe(true);
    delete process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT;
    const result = deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES);
    expect(result.removedMdc).toContain('.cursor/rules/prd-writer.mdc');
    expect(existsSync(join(root, '.cursor/rules/prd-writer.mdc'))).toBe(false);
  });

  it('UT-S20-47: 配置持久化后置——接入失败不留半套配置', async () => {
    writeExistingProjectAssets(root);
    mkdirSync(join(root, '.cursor/skills/prd-writer'), { recursive: true });
    writeFileSync(join(root, '.cursor/skills/prd-writer/SKILL.md'), '---\nname: "prd-writer"\ndescription: "mine"\n---\nconflict\n');
    const exit = mockProcessExit();
    try {
      await expect(adopt('demo', { locale: 'zh', aiTool: 'cursor' })).rejects.toThrow('process.exit(1)');
      expect(existsSync(join(root, 'logos/logos.config.json'))).toBe(false);
    } finally {
      exit.mockRestore();
    }
  });

  it('UT-S20-48: 接入后 change 引导链路可达（guard 写入 + sessionStart 上下文可用）', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'cursor' });
    await change('first-change');
    expect(existsSync(join(root, 'logos/.openlogos-guard'))).toBe(true);
    expect(existsSync(join(root, 'logos/changes/first-change/proposal.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor/hooks/openlogos-runtime.cjs'))).toBe(true);
  });

  it('ST-S20-23: adopt 成功接入——三件套就位、.mdc 迁移完成、用户资产哈希不变、首个 change 引导输出', async () => {
    writeExistingProjectAssets(root);
    const userRule = readFileSync(join(root, '.cursor/rules/my-team-style.mdc'), 'utf8');
    const userSrc = readFileSync(join(root, 'src/app.ts'), 'utf8');
    await adopt('demo', { locale: 'zh', aiTool: 'cursor' });
    expect(existsSync(join(root, '.cursor/skills/prd-writer/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor/agents/change-reviewer.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor/rules/prd-writer.mdc'))).toBe(false);
    expect(readFileSync(join(root, '.cursor/rules/my-team-style.mdc'), 'utf8')).toBe(userRule);
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe(userSrc);
    const hooks = JSON.parse(readFileSync(join(root, '.cursor/hooks.json'), 'utf8'));
    expect(hooks.hooks.stop).toEqual([{ type: 'command', command: './user-stop.sh' }]);
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('请保留我');
    expect(agents).toContain('<!-- OPENLOGOS:BEGIN -->');
  });

  it('ST-S20-24: 冲突接入 blocked——非零退出、零写入、无伪造完成信息', async () => {
    writeExistingProjectAssets(root);
    mkdirSync(join(root, '.cursor/skills/prd-writer'), { recursive: true });
    writeFileSync(join(root, '.cursor/skills/prd-writer/SKILL.md'), '---\nname: "prd-writer"\ndescription: "mine"\n---\nconflict\n');
    const before = treeSnapshot(root);
    const exit = mockProcessExit();
    try {
      await expect(adopt('demo', { locale: 'zh', aiTool: 'cursor' })).rejects.toThrow('process.exit(1)');
      expect(treeSnapshot(root)).toEqual(before);
      expect(consoleCapture.errors.join('\n')).toContain('.cursor/skills/prd-writer');
      expect(consoleCapture.logs.join('\n')).not.toContain('接入完成');
    } finally {
      exit.mockRestore();
    }
  });

  it('ST-S20-25: 中途失败恢复——无半套资产，重跑 adopt 可成功收敛', async () => {
    writeExistingProjectAssets(root);
    process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT = 'after-skills';
    await expect(adopt('demo', { locale: 'zh', aiTool: 'cursor' })).rejects.toThrow(/注入/);
    // 失败后：无半套 Skills、.mdc 保留
    expect(existsSync(join(root, '.cursor/skills/prd-writer'))).toBe(false);
    expect(existsSync(join(root, '.cursor/rules/prd-writer.mdc'))).toBe(true);
    delete process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT;
    rmSync(join(root, 'logos'), { recursive: true, force: true });
    await adopt('demo', { locale: 'zh', aiTool: 'cursor' });
    expect(existsSync(join(root, '.cursor/skills/prd-writer/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor/rules/prd-writer.mdc'))).toBe(false);
  });
});
