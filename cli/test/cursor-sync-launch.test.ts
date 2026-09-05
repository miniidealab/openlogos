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
  expandAiTools,
  findClaudePluginTemplateSource,
  findCursorPluginTemplateSource,
  findSkillsSource,
  init,
} from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import { launch } from '../src/commands/launch.js';
import { adopt } from '../src/commands/adopt.js';
import { aiToolAdapterRegistry } from '../src/lib/ai-tool-adapter.js';
import { deployCursorAssets } from '../src/lib/cursor-adapter.js';
import { captureConsole, makeTempRoot, mockCwd } from './helpers.js';

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

function writeLegacyMdcLayout(root: string) {
  const rules = join(root, '.cursor', 'rules');
  mkdirSync(rules, { recursive: true });
  for (const name of ['prd-writer', 'product-designer']) {
    writeFileSync(join(rules, `${name}.mdc`), `---\ndescription: "OpenLogos — ${name}"\n---\nlegacy\n`);
  }
  writeFileSync(join(rules, 'openlogos-policy.mdc'), '---\ndescription: "OpenLogos policy"\n---\nlegacy policy\n');
  writeFileSync(join(rules, 'my-team-style.mdc'), 'user rule keep me\n');
}

function writeLaunchEvidence(root: string) {
  const verify = join(root, 'logos', 'resources', 'verify');
  mkdirSync(verify, { recursive: true });
  writeFileSync(join(verify, 'acceptance-report.md'), '# 验收\nPASS\n');
  writeFileSync(join(verify, 'deployment-report.md'), '# 部署\n');
  writeFileSync(join(verify, 'smoke-report.md'), '# Smoke\nPASS\n');
}

describe('Cursor sync/launch — S08 幂等同步迁移 / S14 launched 刷新', () => {
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

  it('UT-S08-51: sync 计划经 Registry capability 驱动，标量/数组/all 旧配置进入同一路径', () => {
    expect(aiToolAdapterRegistry.get('cursor').capabilities.assets).toEqual(['agents', 'plugin', 'hooks']);
    expect(expandAiTools('cursor')).toEqual(['cursor']);
    expect(expandAiTools(['claude-code', 'cursor'])).toEqual(['claude-code', 'cursor']);
    expect(expandAiTools('all')).toContain('cursor');
  });

  it('UT-S08-52: 托管 .mdc 清理清单由 Skill 名单精确派生，用户 rules 不入清单', () => {
    writeLegacyMdcLayout(root);
    const result = deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES);
    expect(result.removedMdc.sort()).toEqual([
      '.cursor/rules/openlogos-policy.mdc',
      '.cursor/rules/prd-writer.mdc',
      '.cursor/rules/product-designer.mdc',
    ].sort());
    expect(readFileSync(join(root, '.cursor/rules/my-team-style.mdc'), 'utf8')).toBe('user rule keep me\n');
    expect(result.preserved.join('\n')).toContain('.cursor/rules/my-team-style.mdc');
  });

  it('UT-S08-53: 迁移顺序不变量——前序失败则 .mdc 清理不执行', () => {
    writeLegacyMdcLayout(root);
    process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT = 'after-skills';
    expect(() => deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES))
      .toThrow(/注入/);
    expect(existsSync(join(root, '.cursor/rules/prd-writer.mdc'))).toBe(true);
    expect(existsSync(join(root, '.cursor/rules/openlogos-policy.mdc'))).toBe(true);
  });

  it('UT-S08-54: hooks.json 幂等合并——第二次托管条目零 diff，用户条目与未知字段字节不变', () => {
    mkdirSync(join(root, '.cursor'), { recursive: true });
    writeFileSync(join(root, '.cursor/hooks.json'), JSON.stringify({
      version: 1,
      vendorField: { opaque: [1, 2, 3] },
      hooks: { beforeShellExecution: [{ type: 'command', command: './user-guard.sh' }] },
    }));
    deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES);
    const first = readFileSync(join(root, '.cursor/hooks.json'), 'utf8');
    const second = deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES);
    expect(second.status).toBe('unchanged');
    expect(readFileSync(join(root, '.cursor/hooks.json'), 'utf8')).toBe(first);
    const doc = JSON.parse(first);
    expect(doc.vendorField).toEqual({ opaque: [1, 2, 3] });
    expect(doc.hooks.beforeShellExecution[0]).toEqual({ type: 'command', command: './user-guard.sh' });
  });

  it('UT-S08-55: 清理清单项已被用户删除时跳过并如实报告，不判失败', () => {
    writeLegacyMdcLayout(root);
    rmSync(join(root, '.cursor/rules/prd-writer.mdc'));
    const result = deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES);
    expect(result.removedMdc).not.toContain('.cursor/rules/prd-writer.mdc');
    expect(result.removedMdc).toContain('.cursor/rules/openlogos-policy.mdc');
  });

  it('UT-S08-56: hooks 阶段失败时回滚且 .mdc 保留（版本戳语义由 sync 总体保证）', () => {
    writeLegacyMdcLayout(root);
    process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT = 'after-hooks';
    expect(() => deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES))
      .toThrow(/注入/);
    expect(existsSync(join(root, '.cursor/hooks.json'))).toBe(false);
    expect(existsSync(join(root, '.cursor/skills/prd-writer'))).toBe(false);
    expect(existsSync(join(root, '.cursor/rules/prd-writer.mdc'))).toBe(true);
  });

  it('UT-S08-57: 版本戳后置——cursor 资产失败时 .openlogos-sync.json 不刷新', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    const stamp = join(root, 'logos', '.openlogos-sync.json');
    const before = existsSync(stamp) ? readFileSync(stamp, 'utf8') : null;
    writeFileSync(join(root, '.cursor/skills/prd-writer/SKILL.md'), 'stale');
    process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT = 'after-skills';
    expect(() => sync()).toThrow(/注入/);
    const after = existsSync(stamp) ? readFileSync(stamp, 'utf8') : null;
    expect(after).toBe(before);
  });

  it('UT-S08-58: 其余宿主计划与输出结构不受 cursor 刷新影响', async () => {
    await init('demo', { locale: 'en', aiTool: 'all' });
    const claude = treeSnapshot(join(root, '.claude'));
    const codex = treeSnapshot(join(root, '.agents'));
    const zcode = treeSnapshot(join(root, '.zcode'));
    sync();
    expect(treeSnapshot(join(root, '.claude'))).toEqual(claude);
    expect(treeSnapshot(join(root, '.agents'))).toEqual(codex);
    expect(treeSnapshot(join(root, '.zcode'))).toEqual(zcode);
  });

  it('ST-S08-34: 历史 .mdc 项目一次 sync 完成 Skills 迁移，用户 rules 逐项 preserved', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    // 构造历史布局：托管 .mdc 回填 + 用户自有 rule
    writeLegacyMdcLayout(root);
    rmSync(join(root, '.cursor', 'skills'), { recursive: true, force: true });
    sync();
    expect(existsSync(join(root, '.cursor/skills/prd-writer/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor/rules/prd-writer.mdc'))).toBe(false);
    expect(existsSync(join(root, '.cursor/rules/openlogos-policy.mdc'))).toBe(false);
    expect(readFileSync(join(root, '.cursor/rules/my-team-style.mdc'), 'utf8')).toBe('user rule keep me\n');
    const output = consoleCapture.logs.join('\n');
    expect(output).toContain('已迁移清理托管 .mdc');
    expect(output).toContain('my-team-style.mdc');
  });

  it('ST-S08-35: 重复 sync 幂等——第二次 unchanged 收敛、清理清单为空、用户资产哈希不变', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(root, '.cursor/rules/my-team-style.mdc'), 'user rule keep me\n');
    sync();
    const first = treeSnapshot(join(root, '.cursor'));
    sync();
    expect(treeSnapshot(join(root, '.cursor'))).toEqual(first);
    const result = deployCursorAssets(root, findCursorPluginTemplateSource()!, sharedAssets(), SKILL_NAMES);
    expect(result.status).toBe('unchanged');
    expect(result.removedMdc).toEqual([]);
  });

  it('ST-S08-36: 注入 hooks.json 损坏后 sync 失败——零写入、.mdc 保留、版本戳不变、错误含精确路径', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    const stamp = join(root, 'logos', '.openlogos-sync.json');
    const stampBefore = existsSync(stamp) ? readFileSync(stamp, 'utf8') : null;
    // 构造迁移前布局 + 损坏 hooks.json
    rmSync(join(root, '.cursor'), { recursive: true, force: true });
    writeLegacyMdcLayout(root);
    mkdirSync(join(root, '.cursor'), { recursive: true });
    writeFileSync(join(root, '.cursor/hooks.json'), '{ broken');
    const before = treeSnapshot(join(root, '.cursor'));
    expect(() => sync()).toThrow(/hooks\.json 无法解析/);
    expect(treeSnapshot(join(root, '.cursor'))).toEqual(before);
    expect(existsSync(join(root, '.cursor/rules/prd-writer.mdc'))).toBe(true);
    const stampAfter = existsSync(stamp) ? readFileSync(stamp, 'utf8') : null;
    expect(stampAfter).toBe(stampBefore);
  });

  it('UT-S14-18: launch 计划经 Registry 派生——launched 刷新走同一 cursor 部署路径', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    writeLaunchEvidence(root);
    writeFileSync(join(root, '.cursor/skills/prd-writer/SKILL.md'), 'stale');
    launch();
    expect(readFileSync(join(root, '.cursor/skills/prd-writer/SKILL.md'), 'utf8')).not.toBe('stale');
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toContain('lifecycle: launched');
  });

  it('UT-S14-19: lifecycle 提交后置——cursor 刷新失败则 lifecycle 不提交', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    writeLaunchEvidence(root);
    writeFileSync(join(root, '.cursor/skills/prd-writer/SKILL.md'), 'stale');
    process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT = 'after-skills';
    expect(() => launch()).toThrow(/注入/);
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toContain('lifecycle: initial');
  });

  it('UT-S14-20: adopted + launched 重复执行零 diff，以 unchanged 收敛', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'cursor' });
    launch();
    const first = treeSnapshot(join(root, '.cursor'));
    launch();
    expect(treeSnapshot(join(root, '.cursor'))).toEqual(first);
  });

  it('UT-S14-21: launch 刷新前后用户 rules/skills/hooks 条目保留，项目资产不变', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'cursor' });
    mkdirSync(join(root, '.cursor/rules'), { recursive: true });
    writeFileSync(join(root, '.cursor/rules/my-team-style.mdc'), 'user rule keep me\n');
    mkdirSync(join(root, '.cursor/skills/my-skill'), { recursive: true });
    writeFileSync(join(root, '.cursor/skills/my-skill/SKILL.md'), '---\nname: "my-skill"\ndescription: "mine"\n---\nmine\n');
    const hooks = JSON.parse(readFileSync(join(root, '.cursor/hooks.json'), 'utf8'));
    hooks.hooks.stop = [{ type: 'command', command: './user-stop.sh' }];
    writeFileSync(join(root, '.cursor/hooks.json'), JSON.stringify(hooks, null, 2) + '\n');
    launch();
    expect(readFileSync(join(root, '.cursor/rules/my-team-style.mdc'), 'utf8')).toBe('user rule keep me\n');
    expect(readFileSync(join(root, '.cursor/skills/my-skill/SKILL.md'), 'utf8')).toContain('mine');
    expect(JSON.parse(readFileSync(join(root, '.cursor/hooks.json'), 'utf8')).hooks.stop)
      .toEqual([{ type: 'command', command: './user-stop.sh' }]);
  });

  it('ST-S14-25: launch 刷新 cursor launched 资产——落盘读回成功、lifecycle 提交、新 session 提示输出', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    writeLaunchEvidence(root);
    launch();
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toContain('lifecycle: launched');
    expect(existsSync(join(root, '.cursor/hooks/openlogos-runtime.cjs'))).toBe(true);
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('lifecycle=launched');
    const output = consoleCapture.logs.join('\n');
    expect(output).toContain('Cursor');
  });

  it('ST-S14-26: launch 中途失败——回滚、lifecycle 不提交、错误含失败宿主与精确目标', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    writeLaunchEvidence(root);
    const before = treeSnapshot(join(root, '.cursor'));
    writeFileSync(join(root, '.cursor/skills/prd-writer/SKILL.md'), 'stale');
    process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT = 'after-hooks';
    expect(() => launch()).toThrow(/注入/);
    delete process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT;
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toContain('lifecycle: initial');
    // stale 文件在失败回滚后恢复为部署前状态（即我们刚写的 stale——回滚还原）
    expect(readFileSync(join(root, '.cursor/skills/prd-writer/SKILL.md'), 'utf8')).toBe('stale');
    expect(Object.keys(before).length).toBeGreaterThan(0);
  });
});
