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
import { join } from 'node:path';
import {
  createAgentsMd,
  createLogosConfig,
  deployAiToolAssets,
  expandAiTools,
  findZCodePluginTemplateSource,
  init,
  mergeInstructionFileContent,
  parseAiTool,
} from '../src/commands/init.js';
import { adopt } from '../src/commands/adopt.js';
import {
  AiToolAdapterRegistry,
  ManagedAssetTransaction,
  aiToolAdapterRegistry,
  createZCodeAgentsInstruction,
  deployZCodeAssets,
  localizedZCodeResult,
  preflightZCodeTarget,
  validateZCodeTemplate,
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
  const manifestDir = join(root, '.zcode', 'plugins', 'openlogos', '.zcode-plugin');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, 'plugin.json'), JSON.stringify({ name: 'foreign-owner', version: '1.0.0' }));
}

describe('ZCode Adapter — S01/S20', () => {
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
    delete process.env.OPENLOGOS_ZCODE_TXN_FAIL_AT;
    consoleCapture.restore();
    restoreCwd();
    cleanup();
  });

  it('UT-S01-100: --ai-tool zcode 解析为稳定 id 并可写入配置', () => {
    expect(parseAiTool('zcode')).toBe('zcode');
    expect(JSON.parse(createLogosConfig('demo', 'zh', 'zcode')).aiTool).toBe('zcode');
  });

  it('UT-S01-101: all 稳定展开既有四宿主与 ZCode 且无重复', () => {
    expect(expandAiTools(['all', 'zcode'])).toEqual(['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder']);
  });

  it('UT-S01-102: Registry 拒绝重复与未知 id 并枚举合法集合', () => {
    expect(() => new AiToolAdapterRegistry([
      aiToolAdapterRegistry.get('zcode'),
      aiToolAdapterRegistry.get('zcode'),
    ])).toThrow(/重复/);
    expect(() => aiToolAdapterRegistry.get('unknown')).toThrow(/未知/);
    expect(aiToolAdapterRegistry.list().map(item => item.id)).toContain('zcode');
  });

  it('UT-S01-103: ZCode capability 声明四个 lifecycle 与 AGENTS/plugin/hooks', () => {
    expect(aiToolAdapterRegistry.get('zcode').capabilities).toEqual({
      lifecycle: ['init', 'sync', 'launch', 'adopt'],
      assets: ['agents', 'plugin', 'hooks'],
    });
  });

  it('UT-S01-104: ZCode 模板的 manifest、Skills、Commands、Agents、hooks、runtime 完整可解析', () => {
    const source = findZCodePluginTemplateSource();
    expect(source).toBeTruthy();
    expect(() => validateZCodeTemplate(source!)).not.toThrow();
    expect(JSON.parse(readFileSync(join(source!, '.zcode-plugin', 'plugin.json'), 'utf8')).name).toBe('openlogos');
  });

  it('UT-S01-105: ZCode 根 AGENTS 指令不依赖子目录 AGENTS、include 或 CLAUDE.md', () => {
    const instruction = createZCodeAgentsInstruction('zh', 'launched');
    expect(instruction).toContain('根 AGENTS.md');
    expect(instruction).toContain('不得依赖子目录 AGENTS');
    expect(instruction).toContain('CLAUDE.md');
    expect(createAgentsMd('zh', 'zcode', 'agents', true)).toContain('.zcode/plugins/openlogos/skills');
  });

  it('UT-S01-106: 不同 owner 的同名目标在预检阶段被阻断', () => {
    writeForeignOwner(root);
    expect(() => preflightZCodeTarget(root, findZCodePluginTemplateSource()!)).toThrow(/owner 冲突/);
    expect(JSON.parse(readFileSync(join(root, '.zcode/plugins/openlogos/.zcode-plugin/plugin.json'), 'utf8')).name).toBe('foreign-owner');
  });

  it('UT-S01-107: ZCode 安装、保留与新 session 结果按 zh/en 本地化', () => {
    const result = { target: '.zcode/plugins/openlogos', status: 'installed' as const, preserved: ['.zcode/config.json'] };
    expect(localizedZCodeResult('zh', result)).toContain('已安装');
    expect(localizedZCodeResult('zh', result)).toContain('请新建 ZCode session');
    expect(localizedZCodeResult('en', result)).toContain('installed');
    expect(localizedZCodeResult('en', result)).toContain('preserved');
  });

  it('ST-S01-15: 空项目 ZCode 初始化一次性生成配置、插件、AGENTS 与 Hooks', async () => {
    await init('demo', { locale: 'zh', aiTool: 'zcode' });
    expect(JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf8')).aiTool).toBe('zcode');
    expect(existsSync(join(root, '.zcode/plugins/openlogos/.zcode-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.zcode/plugins/openlogos/hooks/hooks.json'))).toBe(true);
    expect(existsSync(join(root, '.zcode/plugins/openlogos/skills/prd-writer/SKILL.md'))).toBe(true);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('<!-- OPENLOGOS:BEGIN -->');
  });

  it('ST-S01-16: all 部署五宿主且重复资产规划无语义差异', async () => {
    await init('demo', { locale: 'en', aiTool: 'all' });
    const first = snapshot(root);
    deployAiToolAssets(root, expandAiTools('all'), 'en', false);
    const second = snapshot(root);
    expect(existsSync(join(root, '.zcode/plugins/openlogos/.zcode-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.agents/plugins/openlogos/.codex-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.opencode/plugins/openlogos.js'))).toBe(true);
    expect(existsSync(join(root, '.claude/commands/openlogos/status.md'))).toBe(true);
    expect(second['.zcode/plugins/openlogos/.zcode-plugin/plugin.json']).toBe(first['.zcode/plugins/openlogos/.zcode-plugin/plugin.json']);
  });

  it('ST-S01-17: owner 冲突时 init 非零退出且执行前后快照一致', async () => {
    writeForeignOwner(root);
    const before = snapshot(root);
    const exit = mockProcessExit();
    try {
      await expect(init('demo', { locale: 'zh', aiTool: 'zcode' })).rejects.toThrow('process.exit(1)');
      expect(snapshot(root)).toEqual(before);
      expect(consoleCapture.errors.join('\n')).toContain('.zcode/plugins/openlogos');
    } finally {
      exit.mockRestore();
    }
  });

  it('UT-S20-20: adopt 的 zcode 参数进入注册表预检', () => {
    expect(parseAiTool('zcode')).toBe('zcode');
    expect(() => preflightZCodeTarget(root, findZCodePluginTemplateSource()!)).not.toThrow();
  });

  it('UT-S20-21: AGENTS 无 marker 时追加、完整 marker 时替换并保留用户内容', () => {
    const generated = createAgentsMd('zh', 'zcode', 'agents', true);
    const inserted = mergeInstructionFileContent('用户规则\n', generated);
    expect(inserted).toContain('用户规则');
    expect(inserted.match(/<!-- OPENLOGOS:BEGIN -->/g)).toHaveLength(1);
    const replaced = mergeInstructionFileContent(inserted, generated + '\n新规则');
    expect(replaced).toContain('用户规则');
    expect(replaced).toContain('新规则');
  });

  it('UT-S20-22: ZCode 部署保持 .zcode/config.json 字节不变且不写 hooks', () => {
    mkdirSync(join(root, '.zcode'), { recursive: true });
    const config = Buffer.from('{\n  "model": "custom", "permission": "ask"\n}\n');
    writeFileSync(join(root, '.zcode/config.json'), config);
    deployZCodeAssets(root, findZCodePluginTemplateSource()!);
    expect(readFileSync(join(root, '.zcode/config.json')).equals(config)).toBe(true);
    expect(readFileSync(join(root, '.zcode/config.json'), 'utf8')).not.toContain('hooks');
  });

  it('UT-S20-23: 非 OpenLogos ZCode 插件保持原 owner 与内容', () => {
    const userPlugin = join(root, '.zcode/plugins/user-plugin/asset.txt');
    mkdirSync(join(root, '.zcode/plugins/user-plugin'), { recursive: true });
    writeFileSync(userPlugin, 'user-owned');
    deployZCodeAssets(root, findZCodePluginTemplateSource()!);
    expect(readFileSync(userPlugin, 'utf8')).toBe('user-owned');
  });

  it('UT-S20-24: 不完整 managed marker 在首个 adopt 提交前失败', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '用户规则\n<!-- OPENLOGOS:BEGIN -->\n不完整');
    const before = snapshot(root);
    const exit = mockProcessExit();
    try {
      await expect(adopt('demo', { locale: 'zh', aiTool: 'zcode' })).rejects.toThrow('process.exit(1)');
      expect(snapshot(root)).toEqual(before);
      expect(existsSync(join(root, 'logos/logos.config.json'))).toBe(false);
    } finally {
      exit.mockRestore();
    }
  });

  it('UT-S20-25: adopt 成功持久化 aiTool、bootstrap=adopted 与 lifecycle=launched', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'zcode' });
    expect(JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf8')).aiTool).toBe('zcode');
    const project = readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8');
    expect(project).toContain('bootstrap: adopted');
    expect(project).toContain('lifecycle: launched');
  });

  it('UT-S20-26: adopt 完成指引仍直接指向 change', async () => {
    await adopt('demo', { locale: 'zh', aiTool: 'zcode' });
    const logs = consoleCapture.logs.join('\n');
    expect(logs).toContain('openlogos change <slug>');
    expect(logs).not.toContain('必须先运行 ZCode');
  });

  it('ST-S20-14: 存量项目 ZCode adopt 完整生成并具备 change 基础结构', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'brownfield' }));
    await adopt(undefined, { locale: 'zh', aiTool: 'zcode' });
    expect(existsSync(join(root, 'logos/changes'))).toBe(true);
    expect(existsSync(join(root, 'logos/spec/change-management.md'))).toBe(true);
    expect(existsSync(join(root, '.zcode/plugins/openlogos/commands/change.md'))).toBe(true);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('变更管理');
  });

  it('ST-S20-15: adopt 保留用户 AGENTS、config 与其它插件哈希', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '用户不可丢失规则\n');
    mkdirSync(join(root, '.zcode/plugins/user'), { recursive: true });
    writeFileSync(join(root, '.zcode/config.json'), '{ "model": "user" }\n');
    writeFileSync(join(root, '.zcode/plugins/user/plugin.txt'), 'user plugin');
    const configBefore = readFileSync(join(root, '.zcode/config.json'));
    const pluginBefore = readFileSync(join(root, '.zcode/plugins/user/plugin.txt'));
    await adopt('demo', { locale: 'zh', aiTool: 'zcode' });
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('用户不可丢失规则');
    expect(readFileSync(join(root, '.zcode/config.json')).equals(configBefore)).toBe(true);
    expect(readFileSync(join(root, '.zcode/plugins/user/plugin.txt')).equals(pluginBefore)).toBe(true);
    expect(consoleCapture.logs.join('\n')).toContain('已保留 .zcode/config.json');
  });

  it('ST-S20-16: ZCode 事务中途故障回滚且不留半套插件', () => {
    const source = findZCodePluginTemplateSource()!;
    deployZCodeAssets(root, source);
    const before = snapshot(root);
    const changedSource = join(root, 'changed-zcode-template');
    cpSync(source, changedSource, { recursive: true });
    writeFileSync(join(changedSource, 'commands/status.md'), readFileSync(join(source, 'commands/status.md'), 'utf8') + '\n变更');
    process.env.OPENLOGOS_ZCODE_TXN_FAIL_AT = 'after-backup';
    expect(() => deployZCodeAssets(root, changedSource)).toThrow(/注入/);
    const after = snapshot(root);
    delete after['changed-zcode-template/.zcode-plugin/plugin.json'];
    for (const key of Object.keys(after).filter(key => key.startsWith('changed-zcode-template/'))) delete after[key];
    expect(after).toEqual(before);
  });
});
