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
  createAgentsMd,
  createLogosConfig,
  deployAiToolAssets,
  expandAiTools,
  findWorkBuddyPluginTemplateSource,
  init,
  mergeInstructionFileContent,
  parseAiTool,
} from '../src/commands/init.js';
import { adopt } from '../src/commands/adopt.js';
import { change } from '../src/commands/change.js';
import {
  AiToolAdapterRegistry,
  aiToolAdapterRegistry,
  createWorkBuddyAgentsInstruction,
  deployWorkBuddyAssets,
  localizedWorkBuddyResult,
  preflightWorkBuddyTarget,
  validateWorkBuddyTemplate,
} from '../src/lib/ai-tool-adapter.js';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit } from './helpers.js';

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

function writeForeignOwner(root: string) {
  const manifestDir = join(root, '.workbuddy', 'plugins', 'openlogos', '.workbuddy-plugin');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, 'plugin.json'), JSON.stringify({ name: 'foreign-owner', version: '1.0.0' }));
}

describe('WorkBuddy Adapter — S01/S20', () => {
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

  it('UT-S01-116: --ai-tool workbuddy 解析为稳定 id 并可写入配置', () => {
    expect(parseAiTool('workbuddy')).toBe('workbuddy');
    expect(JSON.parse(createLogosConfig('demo', 'zh', 'workbuddy')).aiTool).toBe('workbuddy');
  });

  it('UT-S01-117: all 在 Qoder 后稳定包含 WorkBuddy、排除 other 且无重复', () => {
    expect(expandAiTools(['all', 'workbuddy'])).toEqual(['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy']);
    expect(() => new AiToolAdapterRegistry([
      aiToolAdapterRegistry.get('workbuddy'),
      aiToolAdapterRegistry.get('workbuddy'),
    ])).toThrow(/重复/);
    expect(() => aiToolAdapterRegistry.get('unknown')).toThrow(/未知/);
  });

  it('UT-S01-118: WorkBuddy capability 声明 instructions/skills/commands/agents/plugin/sessionStart/preToolUse', () => {
    expect(aiToolAdapterRegistry.get('workbuddy').capabilities).toMatchObject({
      instructions: true, skills: true, commands: true, agents: true,
      plugin: true, sessionStart: true, preToolUse: true,
    });
  });

  it('UT-S01-119: WorkBuddy 插件资产规划精确包含原生 manifest、Skills、Commands、Agents 与 Hooks/runtime', () => {
    const source = findWorkBuddyPluginTemplateSource();
    expect(source).toBeTruthy();
    const manifest = JSON.parse(readFileSync(join(source!, '.workbuddy-plugin', 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe('openlogos');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    const buildScript = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'build-workbuddy-template.mjs'), 'utf8');
    expect(buildScript).toContain('manifest.version = pkg.version');
    expect(buildScript).not.toContain("join(repoRoot, 'plugin', 'agents')");
    expect(buildScript).toContain("cpSync(join(source, 'commands')");
    const agent = readFileSync(join(source!, 'agents', 'change-reviewer.md'), 'utf8');
    expect(agent).not.toContain('model: sonnet');
  });

  it('UT-S01-120: WorkBuddy 命令与 Hook 协议静态合法且不重复注册', () => {
    const source = findWorkBuddyPluginTemplateSource()!;
    expect(() => validateWorkBuddyTemplate(source)).not.toThrow();
    for (const required of ['skills', 'commands', 'agents', 'hooks/hooks.json', 'hooks/runtime.mjs', 'hooks/runtime.cjs']) {
      expect(existsSync(join(source, required))).toBe(true);
    }
    const hooks = JSON.parse(readFileSync(join(source, 'hooks/hooks.json'), 'utf8'));
    expect(Object.keys(hooks.hooks)).toEqual(['SessionStart', 'PreToolUse']);
    expect(JSON.stringify(hooks)).toContain('${CODEBUDDY_PLUGIN_ROOT}');
    expect(readFileSync(join(source, 'commands/status.md'), 'utf8')).not.toContain('hooks:');
    expect(createWorkBuddyAgentsInstruction('zh', 'launched')).toContain('PreToolUse');
    expect(createAgentsMd('zh', 'workbuddy', 'agents', true)).toContain('.workbuddy/plugins/openlogos/skills');
  });

  it('UT-S01-121: 当前真实 npm pack 清单包含完整 WorkBuddy 模板且版本同源', () => {
    const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const packRoot = mkdtempSync(join(tmpdir(), 'openlogos-workbuddy-pack-'));
    try {
      const pkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
      pkg.scripts = {};
      writeFileSync(join(packRoot, 'package.json'), JSON.stringify(pkg));
      cpSync(findWorkBuddyPluginTemplateSource()!, join(packRoot, 'workbuddy-plugin-template'), { recursive: true });
      const packed = spawnSync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts'], { cwd: packRoot, encoding: 'utf8' });
      expect(packed.status, packed.stderr).toBe(0);
      const packResult = JSON.parse(packed.stdout)[0];
      const paths = new Set(packResult.files.map((file: { path: string }) => file.path));
      expect(packResult.version).toBe('0.14.2');
      expect(JSON.parse(readFileSync(join(packRoot, 'workbuddy-plugin-template/.workbuddy-plugin/plugin.json'), 'utf8')).version).toBe(packResult.version);
      for (const required of [
        'workbuddy-plugin-template/.workbuddy-plugin/plugin.json',
        'workbuddy-plugin-template/commands/status.md',
        'workbuddy-plugin-template/agents/change-reviewer.md',
        'workbuddy-plugin-template/hooks/hooks.json',
        'workbuddy-plugin-template/hooks/runtime.mjs',
        'workbuddy-plugin-template/hooks/runtime.cjs',
      ]) expect(paths.has(required)).toBe(true);
    } finally {
      rmSync(packRoot, { recursive: true, force: true });
    }
  });

  it('UT-S01-122: 不同 owner 的同名目标在预检阶段被阻断', () => {
    writeForeignOwner(root);
    expect(() => preflightWorkBuddyTarget(root, findWorkBuddyPluginTemplateSource()!)).toThrow(/owner 冲突/);
    expect(JSON.parse(readFileSync(join(root, '.workbuddy/plugins/openlogos/.workbuddy-plugin/plugin.json'), 'utf8')).name).toBe('foreign-owner');
  });

  it('UT-S01-123: 原生记忆、settings、其它插件与未知文件不进入 ManagedAsset 写计划', () => {
    mkdirSync(join(root, '.workbuddy/plugins/user-plugin'), { recursive: true });
    const protectedAssets = new Map([
      ['.workbuddy/settings.json', Buffer.from('{"model":"deepseek"}\n')],
      ['.workbuddy/plugins/user-plugin/asset.bin', Buffer.from([0, 1, 2, 255])],
      ['.workbuddy/native-memory.bin', Buffer.from([255, 0, 127, 3])],
      ['.workbuddy/unknown.user', Buffer.from('opaque-user-data')],
    ]);
    for (const [relative, bytes] of protectedAssets) {
      mkdirSync(dirname(join(root, relative)), { recursive: true });
      writeFileSync(join(root, relative), bytes);
    }
    const deployment = deployWorkBuddyAssets(root, findWorkBuddyPluginTemplateSource()!);
    expect(localizedWorkBuddyResult('zh', deployment)).toContain('原生记忆未读取或修改');
    for (const [relative, bytes] of protectedAssets) expect(readFileSync(join(root, relative)).equals(bytes)).toBe(true);
  });

  it('ST-S01-21: 空项目 WorkBuddy 初始化一次性生成配置、插件、AGENTS 与 Hooks', async () => {
    await init('demo', { locale: 'zh', aiTool: 'workbuddy' });
    expect(JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf8')).aiTool).toBe('workbuddy');
    expect(existsSync(join(root, '.workbuddy/plugins/openlogos/.workbuddy-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.workbuddy/plugins/openlogos/hooks/hooks.json'))).toBe(true);
    expect(existsSync(join(root, '.workbuddy/plugins/openlogos/skills/prd-writer/SKILL.md'))).toBe(true);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('<!-- OPENLOGOS:BEGIN -->');
  });

  it('ST-S01-22: all 部署七宿主且重复执行收敛为零语义漂移', async () => {
    await init('demo', { locale: 'en', aiTool: 'all' });
    const first = snapshot(root);
    deployAiToolAssets(root, expandAiTools('all'), 'en', false);
    const second = snapshot(root);
    expect(existsSync(join(root, '.workbuddy/plugins/openlogos/.workbuddy-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.agents/plugins/openlogos/.codex-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.opencode/plugins/openlogos.js'))).toBe(true);
    expect(existsSync(join(root, '.claude/commands/openlogos/status.md'))).toBe(true);
    expect(second['.workbuddy/plugins/openlogos/.workbuddy-plugin/plugin.json']).toBe(first['.workbuddy/plugins/openlogos/.workbuddy-plugin/plugin.json']);
  });

  it('ST-S01-23: owner 冲突时 init 非零退出且执行前后快照一致', async () => {
    writeForeignOwner(root);
    const before = snapshot(root);
    const exit = mockProcessExit();
    try {
      await expect(init('demo', { locale: 'zh', aiTool: 'workbuddy' })).rejects.toThrow('process.exit(1)');
      expect(snapshot(root)).toEqual(before);
      expect(consoleCapture.errors.join('\n')).toContain('.workbuddy/plugins/openlogos');
    } finally {
      exit.mockRestore();
    }
  });

  it('UT-S20-34: adopt 持久化规范 workbuddy id 且不写猜测别名', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'workbuddy' });
    const config = JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf8'));
    expect(config.aiTool).toBe('workbuddy');
    expect(JSON.stringify(config)).not.toContain('codebuddy');
  });

  it('UT-S20-35: adopted + launched 一次规划且不先写 initial 再覆盖', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'workbuddy' });
    const project = readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8');
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(project).toContain('bootstrap: adopted');
    expect(project).toContain('lifecycle: launched');
    expect(agents).toContain('lifecycle=launched');
    expect(agents).not.toContain('lifecycle=initial');
  });

  it('UT-S20-36: 项目指令只维护完整 marker、保留外部字节并阻断残缺 marker', () => {
    const generated = createAgentsMd('zh', 'workbuddy', 'agents', true);
    const inserted = mergeInstructionFileContent('用户规则\n', generated);
    expect(inserted).toContain('用户规则');
    expect(inserted.match(/<!-- OPENLOGOS:BEGIN -->/g)).toHaveLength(1);
    const replaced = mergeInstructionFileContent(inserted, generated + '\n新规则');
    expect(replaced).toContain('用户规则');
    expect(replaced).toContain('新规则');
    expect(() => mergeInstructionFileContent('用户规则\n<!-- OPENLOGOS:BEGIN -->\n不完整', generated)).toThrow(/marker/i);
  });

  it('UT-S20-37: settings 与非 OpenLogos 插件保持字节不变且 identity 冲突不覆盖', () => {
    mkdirSync(join(root, '.workbuddy'), { recursive: true });
    const config = Buffer.from('{\n  "model": "custom", "permission": "ask"\n}\n');
    writeFileSync(join(root, '.workbuddy/settings.json'), config);
    const userPlugin = join(root, '.workbuddy/plugins/user-plugin/asset.txt');
    mkdirSync(dirname(userPlugin), { recursive: true });
    writeFileSync(userPlugin, 'user-owned');
    deployWorkBuddyAssets(root, findWorkBuddyPluginTemplateSource()!);
    expect(readFileSync(join(root, '.workbuddy/settings.json')).equals(config)).toBe(true);
    expect(readFileSync(join(root, '.workbuddy/settings.json'), 'utf8')).not.toContain('hooks');
    expect(readFileSync(userPlugin, 'utf8')).toBe('user-owned');
    writeForeignOwner(root);
    expect(() => preflightWorkBuddyTarget(root, findWorkBuddyPluginTemplateSource()!)).toThrow(/owner 冲突/);
  });

  it('UT-S20-38: 原生记忆不被读取、写入、清空或迁移且不透明证据一致', () => {
    const memory = Buffer.from([0, 255, 19, 77, 128, 1]);
    mkdirSync(join(root, '.workbuddy'), { recursive: true });
    writeFileSync(join(root, '.workbuddy/native-memory.bin'), memory);
    deployWorkBuddyAssets(root, findWorkBuddyPluginTemplateSource()!);
    expect(readFileSync(join(root, '.workbuddy/native-memory.bin')).equals(memory)).toBe(true);
    expect(existsSync(join(root, '.workbuddy/plugins/openlogos/native-memory.bin'))).toBe(false);
  });

  it('UT-S20-39: WorkBuddy 事务中途故障回滚且不留半套插件', () => {
    const source = findWorkBuddyPluginTemplateSource()!;
    deployWorkBuddyAssets(root, source);
    const before = snapshot(root);
    const changedSource = join(root, 'changed-workbuddy-template');
    cpSync(source, changedSource, { recursive: true });
    writeFileSync(join(changedSource, 'commands/status.md'), readFileSync(join(source, 'commands/status.md'), 'utf8') + '\n变更');
    process.env.OPENLOGOS_WORKBUDDY_TXN_FAIL_AT = 'after-backup';
    expect(() => deployWorkBuddyAssets(root, changedSource)).toThrow(/注入/);
    const after = snapshot(root);
    for (const key of Object.keys(after).filter(key => key.startsWith('changed-workbuddy-template/'))) delete after[key];
    expect(after).toEqual(before);
  });

  it('UT-S20-40: adopt 完成指引仍直接指向 change', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'workbuddy' });
    const logs = consoleCapture.logs.join('\n');
    expect(logs).toContain('openlogos change <slug>');
    expect(logs).not.toContain('必须先运行 WorkBuddy');
  });

  it('ST-S20-20: 存量项目 WorkBuddy adopt 完整生成并具备 change 基础结构', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'brownfield' }));
    await adopt(undefined, { locale: 'zh', aiTool: 'workbuddy' });
    expect(existsSync(join(root, 'logos/changes'))).toBe(true);
    expect(existsSync(join(root, 'logos/spec/change-management.md'))).toBe(true);
    expect(existsSync(join(root, '.workbuddy/plugins/openlogos/commands/change.md'))).toBe(true);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('变更管理');
  });

  it('ST-S20-21: marker/identity 冲突在首个写入前阻断且无伪造完成态', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '用户规则\n<!-- OPENLOGOS:BEGIN -->\n不完整');
    const before = snapshot(root);
    const exit = mockProcessExit();
    try {
      await expect(adopt('demo', { locale: 'zh', aiTool: 'workbuddy' })).rejects.toThrow('process.exit(1)');
      expect(snapshot(root)).toEqual(before);
      expect(existsSync(join(root, 'logos/logos.config.json'))).toBe(false);
    } finally {
      exit.mockRestore();
    }
  });

  it('ST-S20-22: 接入后首个 change 可达且 guard 激活该提案供 proposal_step 推导', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'workbuddy' });
    change('first-workbuddy-change');
    expect(existsSync(join(root, 'logos/changes/first-workbuddy-change/proposal.md'))).toBe(true);
    const guard = JSON.parse(readFileSync(join(root, 'logos/.openlogos-guard'), 'utf8'));
    expect(guard.activeChange).toBe('first-workbuddy-change');
    expect(guard.module).toBe('core');
    expect(existsSync(join(root, 'logos/changes/first-workbuddy-change/tasks.md'))).toBe(true);
  });
});
