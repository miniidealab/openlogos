import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  createAgentsMd,
  deployAiToolAssets,
  expandAiTools,
  findQoderPluginTemplateSource,
  init,
} from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import { launch } from '../src/commands/launch.js';
import { adopt } from '../src/commands/adopt.js';
import {
  deployQoderAssets,
  preflightQoderTarget,
} from '../src/lib/ai-tool-adapter.js';
import { captureConsole, makeTempRoot, mockCwd } from './helpers.js';
import { spawnSync } from 'node:child_process';

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

function qoderTarget(root: string) {
  return join(root, '.qoder', 'plugins', 'openlogos');
}

function writeLaunchEvidence(root: string) {
  const verify = join(root, 'logos', 'resources', 'verify');
  mkdirSync(verify, { recursive: true });
  writeFileSync(join(verify, 'acceptance-report.md'), '# 验收\nPASS\n');
  writeFileSync(join(verify, 'deployment-report.md'), '# 部署\n');
  writeFileSync(join(verify, 'smoke-report.md'), '# Smoke\nPASS\n');
}

describe('Qoder sync/launch — S08/S14', () => {
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
    delete process.env.OPENLOGOS_QODER_TXN_FAIL_AT;
    consoleCapture.restore();
    restoreCwd();
    cleanup();
  });

  it('UT-S08-21: 旧单值/数组配置只同步原宿主', () => {
    expect(expandAiTools('codex')).toEqual(['codex']);
    expect(expandAiTools(['claude-code', 'cursor'])).toEqual(['claude-code', 'cursor']);
    expect(expandAiTools(['claude-code', 'cursor'])).not.toContain('qoder');
  });

  it('UT-S08-22: all 通过 Registry 稳定包含 Qoder', () => {
    expect(expandAiTools('all')).toEqual(['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy']);
  });

  it('UT-S08-23: 托管目录未知文件进入 preserved 且不被删除', () => {
    const source = findQoderPluginTemplateSource()!;
    deployQoderAssets(root, source);
    writeFileSync(join(qoderTarget(root), 'user-note.txt'), 'preserve me');
    const result = deployQoderAssets(root, source);
    expect(result.preserved).toContain('.qoder/plugins/openlogos/user-note.txt');
    expect(readFileSync(join(qoderTarget(root), 'user-note.txt'), 'utf8')).toBe('preserve me');
  });

  it('UT-S08-24: 同一模板重复部署返回 unchanged 且资产无漂移', () => {
    const source = findQoderPluginTemplateSource()!;
    expect(deployQoderAssets(root, source).status).toBe('installed');
    const before = treeSnapshot(qoderTarget(root));
    expect(deployQoderAssets(root, source).status).toBe('unchanged');
    expect(treeSnapshot(qoderTarget(root))).toEqual(before);
  });

  it('UT-S08-25: Adapter 事务失败不刷新 sync 版本戳', async () => {
    await init('demo', { locale: 'zh', aiTool: 'qoder' });
    const stamp = join(root, 'logos', '.openlogos-sync.json');
    writeFileSync(stamp, '{"old":true}\n');
    writeFileSync(join(qoderTarget(root), 'commands/status.md'), 'stale');
    process.env.OPENLOGOS_QODER_TXN_FAIL_AT = 'after-backup';
    expect(() => sync()).toThrow(/注入/);
    expect(readFileSync(stamp, 'utf8')).toBe('{"old":true}\n');
  });

  it('UT-S08-26: 非法 hooks、manifest 与 Markdown frontmatter 在预检阻断', () => {
    const source = findQoderPluginTemplateSource()!;
    for (const [relative, invalid] of [
      ['hooks/hooks.json', '{bad'],
      ['.qoder-plugin/plugin.json', '{bad'],
      ['commands/status.md', '# 缺 frontmatter\n'],
    ]) {
      const fixture = join(root, `invalid-${relative.replaceAll('/', '-')}`);
      cpSync(source, fixture, { recursive: true });
      writeFileSync(join(fixture, relative), invalid);
      expect(() => preflightQoderTarget(root, fixture)).toThrow();
      expect(existsSync(qoderTarget(root))).toBe(false);
    }
  });

  it('ST-S08-19: 含 Qoder 项目连续两次 sync，第二次资产 unchanged 且成功后才写版本戳', async () => {
    await init('demo', { locale: 'zh', aiTool: 'qoder' });
    sync();
    const first = treeSnapshot(qoderTarget(root));
    const firstStamp = JSON.parse(readFileSync(join(root, 'logos/.openlogos-sync.json'), 'utf8'));
    sync();
    expect(treeSnapshot(qoderTarget(root))).toEqual(first);
    expect(JSON.parse(readFileSync(join(root, 'logos/.openlogos-sync.json'), 'utf8')).syncedAt).toBeTruthy();
    expect(firstStamp.syncedAt).toBeTruthy();
    expect(consoleCapture.logs.join('\n')).toContain('Qoder 插件未变化');
  });

  it('ST-S08-20: sync 保留 config、其它插件和托管目录未知文件', async () => {
    await init('demo', { locale: 'zh', aiTool: 'qoder' });
    writeFileSync(join(root, '.qoder/settings.json'), '{"model":"user"}\n');
    mkdirSync(join(root, '.qoder/plugins/user'), { recursive: true });
    writeFileSync(join(root, '.qoder/plugins/user/asset'), 'user');
    writeFileSync(join(qoderTarget(root), 'unknown.txt'), 'unknown');
    const config = readFileSync(join(root, '.qoder/settings.json'));
    sync();
    expect(readFileSync(join(root, '.qoder/settings.json')).equals(config)).toBe(true);
    expect(readFileSync(join(root, '.qoder/plugins/user/asset'), 'utf8')).toBe('user');
    expect(readFileSync(join(qoderTarget(root), 'unknown.txt'), 'utf8')).toBe('unknown');
    expect(consoleCapture.logs.join('\n')).toContain('已保留');
  });

  it('ST-S08-21: sync 中途失败回滚 Qoder 树且版本戳不变', async () => {
    await init('demo', { locale: 'zh', aiTool: 'qoder' });
    const stamp = join(root, 'logos/.openlogos-sync.json');
    writeFileSync(stamp, '{"stable":true}\n');
    writeFileSync(join(qoderTarget(root), 'commands/status.md'), 'stale');
    const before = treeSnapshot(qoderTarget(root));
    process.env.OPENLOGOS_QODER_TXN_FAIL_AT = 'after-backup';
    expect(() => sync()).toThrow(/注入/);
    expect(treeSnapshot(qoderTarget(root))).toEqual(before);
    expect(readFileSync(stamp, 'utf8')).toBe('{"stable":true}\n');
    expect(consoleCapture.logs.join('\n')).not.toContain('Sync complete.');
  });

  it('UT-S14-10: qoder/all 选择一次 Qoder，旧配置不选择', () => {
    expect(expandAiTools('qoder').filter(id => id === 'qoder')).toHaveLength(1);
    expect(expandAiTools('all').filter(id => id === 'qoder')).toHaveLength(1);
    expect(expandAiTools(['codex', 'cursor'])).not.toContain('qoder');
  });

  it('UT-S14-11: launched 变体包含硬门禁、宿主 Skills 与新 session 指引', () => {
    const initial = createAgentsMd('zh', 'qoder', 'agents', false);
    const launched = createAgentsMd('zh', 'qoder', 'agents', true);
    expect(launched).not.toBe(initial);
    expect(launched).toContain('Guard 机制');
    expect(launched).toContain('.qoder/plugins/openlogos/skills');
    expect(readFileSync(join(findQoderPluginTemplateSource()!, 'commands/status.md'), 'utf8')).toContain('verify');
  });

  it('UT-S14-12: adopted 已 launched 时只刷新托管差异并保留用户资产', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'qoder' });
    writeFileSync(join(root, '.qoder/settings.json'), '{"user":true}\n');
    const projectBefore = readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8');
    launch();
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toBe(projectBefore);
    expect(readFileSync(join(root, '.qoder/settings.json'), 'utf8')).toBe('{"user":true}\n');
  });

  it('UT-S14-13: Registry 引入后既有四宿主顺序与资产目标契约不变', async () => {
    expect(expandAiTools(['claude-code', 'opencode', 'codex', 'cursor'])).toEqual(['claude-code', 'opencode', 'codex', 'cursor']);
    await init('demo', { locale: 'en', aiTool: 'all' });
    expect(existsSync(join(root, '.claude/commands/openlogos/status.md'))).toBe(true);
    expect(existsSync(join(root, '.opencode/plugins/openlogos.js'))).toBe(true);
    expect(existsSync(join(root, '.agents/plugins/openlogos/.codex-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.cursor/rules/openlogos-policy.mdc'))).toBe(true);
  });

  it('ST-S14-21: normal launch 先刷新 Qoder，成功后提交 lifecycle 并让新 session 看到 launched', async () => {
    await init('demo', { locale: 'zh', aiTool: 'qoder' });
    writeLaunchEvidence(root);
    writeFileSync(join(qoderTarget(root), 'commands/status.md'), 'stale');
    process.env.OPENLOGOS_QODER_TXN_FAIL_AT = 'after-backup';
    expect(() => launch()).toThrow(/注入/);
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toContain('lifecycle: initial');

    delete process.env.OPENLOGOS_QODER_TXN_FAIL_AT;
    launch();
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toContain('lifecycle: launched');
    const hook = join(qoderTarget(root), 'hooks', 'runtime.mjs');
    const result = spawnSync(process.execPath, [hook, 'session'], {
      cwd: root,
      input: JSON.stringify({ session_id: 'launch', hook_event_name: 'SessionStart', cwd: root, source: 'startup' }),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain('lifecycle: launched');
  });

  it('ST-S14-22: adopted 重复 launch 成功且第二次资产 unchanged、用户资产不变', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'qoder' });
    writeFileSync(join(root, '.qoder/settings.json'), '{"model":"user"}\n');
    writeFileSync(join(qoderTarget(root), 'user.txt'), 'user');
    const config = readFileSync(join(root, '.qoder/settings.json'));
    launch();
    const first = treeSnapshot(qoderTarget(root));
    launch();
    expect(treeSnapshot(qoderTarget(root))).toEqual(first);
    expect(readFileSync(join(root, '.qoder/settings.json')).equals(config)).toBe(true);
    expect(consoleCapture.logs.join('\n')).toContain('Qoder 插件未变化');
  });
});
