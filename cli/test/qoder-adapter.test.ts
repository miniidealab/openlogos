import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAgentsMd,
  createLogosConfig,
  deployAiToolAssets,
  expandAiTools,
  findQoderPluginTemplateSource,
  init,
  mergeInstructionFileContent,
  parseAiTool,
} from '../src/commands/init.js';
import { adopt } from '../src/commands/adopt.js';
import {
  AiToolAdapterRegistry,
  ManagedAssetTransaction,
  aiToolAdapterRegistry,
  createQoderAgentsInstruction,
  deployQoderAssets,
  localizedQoderResult,
  preflightQoderTarget,
  validateQoderTemplate,
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
  const manifestDir = join(root, '.qoder', 'plugins', 'openlogos', '.qoder-plugin');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, 'plugin.json'), JSON.stringify({ name: 'foreign-owner', version: '1.0.0' }));
}

describe('Qoder Adapter — S01/S20', () => {
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

  it('UT-S01-108: --ai-tool qoder 解析为稳定 id 并可写入配置', () => {
    expect(parseAiTool('qoder')).toBe('qoder');
    expect(JSON.parse(createLogosConfig('demo', 'zh', 'qoder')).aiTool).toBe('qoder');
  });

  it('UT-S01-109: all 稳定展开既有四宿主与 Qoder 且无重复', () => {
    expect(expandAiTools(['all', 'qoder'])).toEqual(['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder']);
    expect(() => new AiToolAdapterRegistry([
      aiToolAdapterRegistry.get('qoder'),
      aiToolAdapterRegistry.get('qoder'),
    ])).toThrow(/重复/);
    expect(() => aiToolAdapterRegistry.get('unknown')).toThrow(/未知/);
  });

  it('UT-S01-110: Qoder capability 声明 instructions/skills/commands/agents/plugin/sessionStart/preToolUse', () => {
    expect(aiToolAdapterRegistry.get('qoder').capabilities).toMatchObject({
      instructions: true, skills: true, commands: true, agents: true,
      plugin: true, sessionStart: true, preToolUse: true,
    });
  });

  it('UT-S01-111: Qoder 原生 manifest 路径、name、版本与 JSON 合法', () => {
    const source = findQoderPluginTemplateSource();
    expect(source).toBeTruthy();
    const manifest = JSON.parse(readFileSync(join(source!, '.qoder-plugin', 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe('openlogos');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    const buildScript = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'build-qoder-template.mjs'), 'utf8');
    expect(buildScript).toContain('manifest.version = pkg.version');
    expect(buildScript).not.toContain("join(repoRoot, 'plugin', 'agents')");
    expect(buildScript).toContain("cpSync(join(source, 'commands')");
    const agent = readFileSync(join(source!, 'agents', 'change-reviewer.md'), 'utf8');
    expect(agent).not.toContain('model: sonnet');
  });

  it('UT-S01-112: Qoder 模板的 Skills、Commands、Agents、Hooks/runtime 完整可解析', () => {
    const source = findQoderPluginTemplateSource()!;
    expect(() => validateQoderTemplate(source)).not.toThrow();
    for (const required of ['skills', 'commands', 'agents', 'hooks/hooks.json', 'hooks/runtime.mjs', 'hooks/runtime.cjs']) {
      expect(existsSync(join(source, required))).toBe(true);
    }
    expect(createQoderAgentsInstruction('zh', 'launched')).toContain('根 AGENTS.md');
    expect(createAgentsMd('zh', 'qoder', 'agents', true)).toContain('.qoder/plugins/openlogos/skills');
  });

  it('UT-S01-113: QODER_PLUGIN_ROOT 通过 args 单元素安全定位含空格/元字符的 runtime', () => {
    const hooks = JSON.parse(readFileSync(join(findQoderPluginTemplateSource()!, 'hooks/hooks.json'), 'utf8'));
    const command = hooks.hooks.SessionStart[0].hooks[0];
    expect(command.type).toBe('command');
    expect(command.command).toBe('node');
    expect(command.args[0]).toBe('${QODER_PLUGIN_ROOT}/hooks/runtime.mjs');
    expect(command.args).toHaveLength(2);
    expect(command.timeout).toBe(5);
    expect(command.timeoutMs).toBeUndefined();
  });

  it('UT-S01-114: 不同 owner 的同名目标在预检阶段被阻断', () => {
    writeForeignOwner(root);
    expect(() => preflightQoderTarget(root, findQoderPluginTemplateSource()!)).toThrow(/owner 冲突/);
    expect(JSON.parse(readFileSync(join(root, '.qoder/plugins/openlogos/.qoder-plugin/plugin.json'), 'utf8')).name).toBe('foreign-owner');
  });

  it('UT-S01-115: Qoder 安装、保留与新 session 结果按 zh/en 本地化', () => {
    const result = { target: '.qoder/plugins/openlogos', status: 'installed' as const, preserved: ['.qoder/settings.json'] };
    expect(localizedQoderResult('zh', result)).toContain('已安装');
    expect(localizedQoderResult('zh', result)).toContain('请新建 Qoder CLI session');
    expect(localizedQoderResult('en', result)).toContain('installed');
    expect(localizedQoderResult('en', result)).toContain('preserved');
  });

  it('ST-S01-18: 空项目 Qoder 初始化一次性生成配置、插件、AGENTS 与 Hooks', async () => {
    await init('demo', { locale: 'zh', aiTool: 'qoder' });
    expect(JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf8')).aiTool).toBe('qoder');
    expect(existsSync(join(root, '.qoder/plugins/openlogos/.qoder-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.qoder/plugins/openlogos/hooks/hooks.json'))).toBe(true);
    expect(existsSync(join(root, '.qoder/plugins/openlogos/skills/prd-writer/SKILL.md'))).toBe(true);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('<!-- OPENLOGOS:BEGIN -->');
  });

  it('ST-S01-19: all 部署六宿主且重复资产规划无语义差异', async () => {
    await init('demo', { locale: 'en', aiTool: 'all' });
    const first = snapshot(root);
    deployAiToolAssets(root, expandAiTools('all'), 'en', false);
    const second = snapshot(root);
    expect(existsSync(join(root, '.qoder/plugins/openlogos/.qoder-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.agents/plugins/openlogos/.codex-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.opencode/plugins/openlogos.js'))).toBe(true);
    expect(existsSync(join(root, '.claude/commands/openlogos/status.md'))).toBe(true);
    expect(second['.qoder/plugins/openlogos/.qoder-plugin/plugin.json']).toBe(first['.qoder/plugins/openlogos/.qoder-plugin/plugin.json']);
  });

  it('ST-S01-20: owner 冲突时 init 非零退出且执行前后快照一致', async () => {
    writeForeignOwner(root);
    const before = snapshot(root);
    const exit = mockProcessExit();
    try {
      await expect(init('demo', { locale: 'zh', aiTool: 'qoder' })).rejects.toThrow('process.exit(1)');
      expect(snapshot(root)).toEqual(before);
      expect(consoleCapture.errors.join('\n')).toContain('.qoder/plugins/openlogos');
    } finally {
      exit.mockRestore();
    }
  });

  it('UT-S20-27: adopt 的 qoder 参数进入注册表预检', () => {
    expect(parseAiTool('qoder')).toBe('qoder');
    expect(() => preflightQoderTarget(root, findQoderPluginTemplateSource()!)).not.toThrow();
  });

  it('UT-S20-28: AGENTS 无 marker 时追加、完整 marker 时替换并保留用户内容', () => {
    const generated = createAgentsMd('zh', 'qoder', 'agents', true);
    const inserted = mergeInstructionFileContent('用户规则\n', generated);
    expect(inserted).toContain('用户规则');
    expect(inserted.match(/<!-- OPENLOGOS:BEGIN -->/g)).toHaveLength(1);
    const replaced = mergeInstructionFileContent(inserted, generated + '\n新规则');
    expect(replaced).toContain('用户规则');
    expect(replaced).toContain('新规则');
  });

  it('UT-S20-29: Qoder 部署保持 .qoder/settings.json 字节不变且不写 hooks', () => {
    mkdirSync(join(root, '.qoder'), { recursive: true });
    const config = Buffer.from('{\n  "model": "custom", "permission": "ask"\n}\n');
    writeFileSync(join(root, '.qoder/settings.json'), config);
    writeFileSync(join(root, 'AGENTS.local.md'), '用户本地指令\n');
    mkdirSync(join(root, '.qoder/rules'), { recursive: true });
    writeFileSync(join(root, '.qoder/rules/user.md'), '用户规则\n');
    deployQoderAssets(root, findQoderPluginTemplateSource()!);
    expect(readFileSync(join(root, '.qoder/settings.json')).equals(config)).toBe(true);
    expect(readFileSync(join(root, '.qoder/settings.json'), 'utf8')).not.toContain('hooks');
    expect(readFileSync(join(root, 'AGENTS.local.md'), 'utf8')).toBe('用户本地指令\n');
    expect(readFileSync(join(root, '.qoder/rules/user.md'), 'utf8')).toBe('用户规则\n');
  });

  it('UT-S20-30: 非 OpenLogos Qoder 插件保持原 owner 与内容', () => {
    const userPlugin = join(root, '.qoder/plugins/user-plugin/asset.txt');
    mkdirSync(join(root, '.qoder/plugins/user-plugin'), { recursive: true });
    writeFileSync(userPlugin, 'user-owned');
    deployQoderAssets(root, findQoderPluginTemplateSource()!);
    expect(readFileSync(userPlugin, 'utf8')).toBe('user-owned');
  });

  it('UT-S20-31: 不完整 managed marker 在首个 adopt 提交前失败', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '用户规则\n<!-- OPENLOGOS:BEGIN -->\n不完整');
    const before = snapshot(root);
    const exit = mockProcessExit();
    try {
      await expect(adopt('demo', { locale: 'zh', aiTool: 'qoder' })).rejects.toThrow('process.exit(1)');
      expect(snapshot(root)).toEqual(before);
      expect(existsSync(join(root, 'logos/logos.config.json'))).toBe(false);
    } finally {
      exit.mockRestore();
    }
  });

  it('UT-S20-32: adopt 成功持久化 aiTool、bootstrap=adopted 与 lifecycle=launched', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'qoder' });
    expect(JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf8')).aiTool).toBe('qoder');
    const project = readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8');
    expect(project).toContain('bootstrap: adopted');
    expect(project).toContain('lifecycle: launched');
  });

  it('UT-S20-33: adopt 完成指引仍直接指向 change', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'qoder' });
    const logs = consoleCapture.logs.join('\n');
    expect(logs).toContain('openlogos change <slug>');
    expect(logs).not.toContain('必须先运行 Qoder');
  });

  it('ST-S20-17: 存量项目 Qoder adopt 完整生成并具备 change 基础结构', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'brownfield' }));
    await adopt(undefined, { locale: 'zh', aiTool: 'qoder' });
    expect(existsSync(join(root, 'logos/changes'))).toBe(true);
    expect(existsSync(join(root, 'logos/spec/change-management.md'))).toBe(true);
    expect(existsSync(join(root, '.qoder/plugins/openlogos/commands/change.md'))).toBe(true);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('变更管理');
  });

  it('ST-S20-18: adopt 保留用户 AGENTS、config 与其它插件哈希', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '用户不可丢失规则\n');
    writeFileSync(join(root, 'AGENTS.local.md'), '本地用户规则\n');
    mkdirSync(join(root, '.qoder/plugins/user'), { recursive: true });
    mkdirSync(join(root, '.qoder/rules'), { recursive: true });
    writeFileSync(join(root, '.qoder/settings.json'), '{ "model": "user" }\n');
    writeFileSync(join(root, '.qoder/rules/user.md'), 'Qoder 用户规则\n');
    writeFileSync(join(root, '.qoder/plugins/user/plugin.txt'), 'user plugin');
    const configBefore = readFileSync(join(root, '.qoder/settings.json'));
    const pluginBefore = readFileSync(join(root, '.qoder/plugins/user/plugin.txt'));
    await adopt('demo', { locale: 'zh', aiTool: 'qoder' });
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('用户不可丢失规则');
    expect(readFileSync(join(root, 'AGENTS.local.md'), 'utf8')).toBe('本地用户规则\n');
    expect(readFileSync(join(root, '.qoder/rules/user.md'), 'utf8')).toBe('Qoder 用户规则\n');
    expect(readFileSync(join(root, '.qoder/settings.json')).equals(configBefore)).toBe(true);
    expect(readFileSync(join(root, '.qoder/plugins/user/plugin.txt')).equals(pluginBefore)).toBe(true);
    expect(consoleCapture.logs.join('\n')).toContain('已保留 .qoder/settings.json');
  });

  it('ST-S20-19: Qoder 事务中途故障回滚且不留半套插件', () => {
    const source = findQoderPluginTemplateSource()!;
    deployQoderAssets(root, source);
    const before = snapshot(root);
    const changedSource = join(root, 'changed-qoder-template');
    cpSync(source, changedSource, { recursive: true });
    writeFileSync(join(changedSource, 'commands/status.md'), readFileSync(join(source, 'commands/status.md'), 'utf8') + '\n变更');
    process.env.OPENLOGOS_QODER_TXN_FAIL_AT = 'after-backup';
    expect(() => deployQoderAssets(root, changedSource)).toThrow(/注入/);
    const after = snapshot(root);
    delete after['changed-qoder-template/.qoder-plugin/plugin.json'];
    for (const key of Object.keys(after).filter(key => key.startsWith('changed-qoder-template/'))) delete after[key];
    expect(after).toEqual(before);
  });
});
