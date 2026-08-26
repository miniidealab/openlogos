import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import {
  aiToolAdapterRegistry,
  expandRegisteredAiTools,
  resolveConfiguredAiTools,
} from '../src/lib/ai-tool-adapter.js';
import { captureConsole, makeTempRoot, mockCwd } from './helpers.js';

const DEPLOYABLE_IDS = ['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy'];

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

function writeBytes(root: string, relative: string, bytes: string | Buffer): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

function writeTraeFixtures(root: string): Map<string, Buffer> {
  const fixtures = new Map<string, Buffer>([
    ['.trae/rules/project.md', Buffer.from('# 用户规则\n')],
    ['.trae/skills/local/SKILL.md', Buffer.from('# 用户技能\n')],
    ['.trae/agents/reviewer.md', Buffer.from('# 用户 Agent\n')],
    ['.trae/hooks/pre-tool-use.json', Buffer.from('{"user":true}\n')],
    ['.trae/mcp.json', Buffer.from('{"servers":{}}\n')],
    ['.trae/settings.json', Buffer.from('{"model":"deepseek"}\n')],
    ['.trae/native-memory.bin', Buffer.from([0, 255, 8, 4])],
  ]);
  for (const [relative, bytes] of fixtures) writeBytes(root, relative, bytes);
  return fixtures;
}

function expectFixturesUnchanged(root: string, fixtures: Map<string, Buffer>): void {
  for (const [relative, bytes] of fixtures) {
    expect(readFileSync(join(root, relative)).equals(bytes), relative).toBe(true);
  }
}

describe('TRAE non-deployable sync — S08', () => {
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
    consoleCapture.restore();
    restoreCwd();
    cleanup();
  });

  it('UT-S08-33: Registry 的 all 同步计划稳定为七宿主且不含 TRAE', () => {
    expect(aiToolAdapterRegistry.list({ deployableOnly: true }).map(item => item.id)).toEqual(DEPLOYABLE_IDS);
    expect(resolveConfiguredAiTools('all')).toEqual(DEPLOYABLE_IDS);
    expect(resolveConfiguredAiTools('all')).not.toContain('trae');
  });

  it('UT-S08-34: 既有单值与数组配置保持原顺序和去重语义', () => {
    expect(resolveConfiguredAiTools('codex')).toEqual(['codex']);
    expect(resolveConfiguredAiTools(['claude-code', 'cursor', 'claude-code'])).toEqual(['claude-code', 'cursor']);
    expect(expandRegisteredAiTools(['qoder', 'workbuddy'])).toEqual(['qoder', 'workbuddy']);
  });

  it('UT-S08-35: 未知 TRAE 配置在生成同步计划前 fail loud', () => {
    expect(() => resolveConfiguredAiTools('trae')).toThrow('未知的 AI Adapter id：trae');
    expect(() => resolveConfiguredAiTools(['cursor', 'trae'])).toThrow('未知的 AI Adapter id：trae');
    expect(() => resolveConfiguredAiTools('TraeCode')).toThrow('未知的 AI Adapter id：TraeCode');
  });

  it('UT-S08-36: 正常同步不扫描或改写 TRAE 用户资产', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    const fixtures = writeTraeFixtures(root);
    sync();
    expectFixturesUnchanged(root, fixtures);
  });

  it('ST-S08-25: all 同步完成七宿主资产与版本戳且 TRAE 目录零触达', async () => {
    await init('demo', { locale: 'zh', aiTool: 'all' });
    const fixtures = writeTraeFixtures(root);
    sync();
    expectFixturesUnchanged(root, fixtures);
    expect(JSON.parse(readFileSync(join(root, 'logos/.openlogos-sync.json'), 'utf8')).syncedAt).toBeTruthy();
    expect(JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf8')).aiTool).toEqual(DEPLOYABLE_IDS);
  });

  it('ST-S08-26: 配置含 TRAE 时在首个副作用前失败且项目字节不变', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    writeTraeFixtures(root);
    const configPath = join(root, 'logos/logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.aiTool = ['cursor', 'trae'];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const before = treeSnapshot(root);

    expect(() => sync()).toThrow('未知的 AI Adapter id：trae');
    expect(treeSnapshot(root)).toEqual(before);
    expect(consoleCapture.logs.join('\n')).not.toContain('Sync complete.');
  });
});
