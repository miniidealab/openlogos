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
import { spawnSync } from 'node:child_process';
import {
  createAgentsMd,
  expandAiTools,
  findWorkBuddyPluginTemplateSource,
  init,
} from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import { launch } from '../src/commands/launch.js';
import { adopt } from '../src/commands/adopt.js';
import {
  deployWorkBuddyAssets,
  preflightWorkBuddyTarget,
} from '../src/lib/ai-tool-adapter.js';
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

function workBuddyTarget(root: string) {
  return join(root, '.workbuddy', 'plugins', 'openlogos');
}

function writeLaunchEvidence(root: string) {
  const verify = join(root, 'logos', 'resources', 'verify');
  mkdirSync(verify, { recursive: true });
  writeFileSync(join(verify, 'acceptance-report.md'), '# 验收\nPASS\n');
  writeFileSync(join(verify, 'deployment-report.md'), '# 部署\n');
  writeFileSync(join(verify, 'smoke-report.md'), '# Smoke\nPASS\n');
}

describe('WorkBuddy sync/launch — S08/S14', () => {
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
    delete process.env.OPENLOGOS_WORKBUDDY_TXN_FAIL_AT;
    consoleCapture.restore();
    restoreCwd();
    cleanup();
  });

  it('UT-S08-27: 旧单值/数组配置只同步原宿主且不猜测 WorkBuddy', () => {
    expect(expandAiTools('codex')).toEqual(['codex']);
    expect(expandAiTools(['claude-code', 'cursor'])).toEqual(['claude-code', 'cursor']);
    expect(expandAiTools(['claude-code', 'cursor'])).not.toContain('workbuddy');
  });

  it('UT-S08-28: all 通过 Registry 在 Qoder 后稳定包含 WorkBuddy', () => {
    expect(expandAiTools('all')).toEqual(['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy']);
  });

  it('UT-S08-29: 托管目录未知文件进入 preserved 且不被删除', () => {
    const source = findWorkBuddyPluginTemplateSource()!;
    deployWorkBuddyAssets(root, source);
    writeFileSync(join(workBuddyTarget(root), 'user-note.txt'), 'preserve me');
    const result = deployWorkBuddyAssets(root, source);
    expect(result.preserved).toContain('.workbuddy/plugins/openlogos/user-note.txt');
    expect(readFileSync(join(workBuddyTarget(root), 'user-note.txt'), 'utf8')).toBe('preserve me');
  });

  it('UT-S08-30: 同一模板重复部署返回 unchanged 且资产无漂移', () => {
    const source = findWorkBuddyPluginTemplateSource()!;
    expect(deployWorkBuddyAssets(root, source).status).toBe('installed');
    const before = treeSnapshot(workBuddyTarget(root));
    expect(deployWorkBuddyAssets(root, source).status).toBe('unchanged');
    expect(treeSnapshot(workBuddyTarget(root))).toEqual(before);
  });

  it('UT-S08-31: Adapter 事务失败不刷新 sync 版本戳', async () => {
    await init('demo', { locale: 'zh', aiTool: 'workbuddy' });
    const stamp = join(root, 'logos', '.openlogos-sync.json');
    writeFileSync(stamp, '{"old":true}\n');
    writeFileSync(join(workBuddyTarget(root), 'commands/status.md'), 'stale');
    process.env.OPENLOGOS_WORKBUDDY_TXN_FAIL_AT = 'after-backup';
    expect(() => sync()).toThrow(/注入/);
    expect(readFileSync(stamp, 'utf8')).toBe('{"old":true}\n');
  });

  it('UT-S08-32: 非法 hooks、manifest 与 Markdown frontmatter 在预检阻断', () => {
    const source = findWorkBuddyPluginTemplateSource()!;
    for (const [relative, invalid] of [
      ['hooks/hooks.json', '{bad'],
      ['.workbuddy-plugin/plugin.json', '{bad'],
      ['commands/status.md', '# 缺 frontmatter\n'],
    ]) {
      const fixture = join(root, `invalid-${relative.replaceAll('/', '-')}`);
      cpSync(source, fixture, { recursive: true });
      writeFileSync(join(fixture, relative), invalid);
      expect(() => preflightWorkBuddyTarget(root, fixture)).toThrow();
      expect(existsSync(workBuddyTarget(root))).toBe(false);
    }
  });

  it('ST-S08-22: 连续两次 sync，第二次 unchanged 且成功后才写版本戳', async () => {
    await init('demo', { locale: 'zh', aiTool: 'workbuddy' });
    sync();
    const first = treeSnapshot(workBuddyTarget(root));
    const firstStamp = JSON.parse(readFileSync(join(root, 'logos/.openlogos-sync.json'), 'utf8'));
    sync();
    expect(treeSnapshot(workBuddyTarget(root))).toEqual(first);
    expect(JSON.parse(readFileSync(join(root, 'logos/.openlogos-sync.json'), 'utf8')).syncedAt).toBeTruthy();
    expect(firstStamp.syncedAt).toBeTruthy();
    expect(consoleCapture.logs.join('\n')).toContain('WorkBuddy 插件未变化');
  });

  it('ST-S08-23: sync 保留 settings、其它插件、未知文件与原生记忆字节', async () => {
    await init('demo', { locale: 'zh', aiTool: 'workbuddy' });
    mkdirSync(join(root, '.workbuddy/plugins/user'), { recursive: true });
    const assets = new Map([
      ['.workbuddy/settings.json', Buffer.from('{"model":"user"}\n')],
      ['.workbuddy/plugins/user/asset', Buffer.from('user')],
      ['.workbuddy/plugins/openlogos/unknown.txt', Buffer.from('unknown')],
      ['.workbuddy/native-memory.bin', Buffer.from([0, 255, 8, 4])],
    ]);
    for (const [relative, bytes] of assets) writeFileSync(join(root, relative), bytes);
    sync();
    for (const [relative, bytes] of assets) expect(readFileSync(join(root, relative)).equals(bytes)).toBe(true);
    expect(consoleCapture.logs.join('\n')).toContain('已保留');
  });

  it('ST-S08-24: sync 中途失败回滚 WorkBuddy 树且版本戳不变', async () => {
    await init('demo', { locale: 'zh', aiTool: 'workbuddy' });
    const stamp = join(root, 'logos/.openlogos-sync.json');
    writeFileSync(stamp, '{"stable":true}\n');
    writeFileSync(join(workBuddyTarget(root), 'commands/status.md'), 'stale');
    const before = treeSnapshot(workBuddyTarget(root));
    process.env.OPENLOGOS_WORKBUDDY_TXN_FAIL_AT = 'after-backup';
    expect(() => sync()).toThrow(/注入/);
    expect(treeSnapshot(workBuddyTarget(root))).toEqual(before);
    expect(readFileSync(stamp, 'utf8')).toBe('{"stable":true}\n');
    expect(consoleCapture.logs.join('\n')).not.toContain('Sync complete.');
  });

  it('UT-S14-14: workbuddy/all 选择一次 WorkBuddy，旧配置不选择', () => {
    expect(expandAiTools('workbuddy').filter(id => id === 'workbuddy')).toHaveLength(1);
    expect(expandAiTools('all').filter(id => id === 'workbuddy')).toHaveLength(1);
    expect(expandAiTools(['codex', 'cursor'])).not.toContain('workbuddy');
  });

  it('UT-S14-15: launched 变体包含硬门禁、宿主 Skills 与新 session 协议', () => {
    const initial = createAgentsMd('zh', 'workbuddy', 'agents', false);
    const launched = createAgentsMd('zh', 'workbuddy', 'agents', true);
    expect(launched).not.toBe(initial);
    expect(launched).toContain('Guard 机制');
    expect(launched).toContain('.workbuddy/plugins/openlogos/skills');
    expect(readFileSync(join(findWorkBuddyPluginTemplateSource()!, 'commands/status.md'), 'utf8')).toContain('verify');
  });

  it('UT-S14-16: adopted 已 launched 时只刷新托管差异并保留用户资产', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'workbuddy' });
    writeFileSync(join(root, '.workbuddy/settings.json'), '{"user":true}\n');
    const projectBefore = readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8');
    launch();
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toBe(projectBefore);
    expect(readFileSync(join(root, '.workbuddy/settings.json'), 'utf8')).toBe('{"user":true}\n');
  });

  it('UT-S14-17: Registry 引入后既有宿主顺序与资产目标契约不变', async () => {
    expect(expandAiTools(['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder']))
      .toEqual(['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder']);
    await init('demo', { locale: 'en', aiTool: 'all' });
    expect(existsSync(join(root, '.claude/commands/openlogos/status.md'))).toBe(true);
    expect(existsSync(join(root, '.opencode/plugins/openlogos.js'))).toBe(true);
    expect(existsSync(join(root, '.agents/plugins/openlogos/.codex-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.cursor/rules/openlogos-policy.mdc'))).toBe(true);
    expect(existsSync(join(root, '.zcode/plugins/openlogos/.zcode-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.qoder/plugins/openlogos/.qoder-plugin/plugin.json'))).toBe(true);
  });

  it('ST-S14-23: normal launch 先刷新 WorkBuddy，成功后提交 lifecycle 并让新 session 看到 launched', async () => {
    await init('demo', { locale: 'zh', aiTool: 'workbuddy' });
    writeLaunchEvidence(root);
    writeFileSync(join(workBuddyTarget(root), 'commands/status.md'), 'stale');
    process.env.OPENLOGOS_WORKBUDDY_TXN_FAIL_AT = 'after-backup';
    expect(() => launch()).toThrow(/注入/);
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toContain('lifecycle: initial');

    delete process.env.OPENLOGOS_WORKBUDDY_TXN_FAIL_AT;
    launch();
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toContain('lifecycle: launched');
    const hook = join(workBuddyTarget(root), 'hooks', 'runtime.mjs');
    const result = spawnSync(process.execPath, [hook, 'session'], {
      cwd: root,
      input: JSON.stringify({ session_id: 'launch', hook_event_name: 'SessionStart', cwd: root, source: 'startup' }),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain('lifecycle: launched');
  });

  it('ST-S14-24: adopted 重复 launch 收敛 unchanged 且用户资产与原生记忆不变', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'workbuddy' });
    const settings = Buffer.from('{"model":"user"}\n');
    const memory = Buffer.from([7, 0, 255, 9]);
    writeFileSync(join(root, '.workbuddy/settings.json'), settings);
    writeFileSync(join(root, '.workbuddy/native-memory.bin'), memory);
    writeFileSync(join(workBuddyTarget(root), 'user.txt'), 'user');
    launch();
    const first = treeSnapshot(workBuddyTarget(root));
    launch();
    expect(treeSnapshot(workBuddyTarget(root))).toEqual(first);
    expect(readFileSync(join(root, '.workbuddy/settings.json')).equals(settings)).toBe(true);
    expect(readFileSync(join(root, '.workbuddy/native-memory.bin')).equals(memory)).toBe(true);
    expect(consoleCapture.logs.join('\n')).toContain('WorkBuddy 插件未变化');
  });
});
