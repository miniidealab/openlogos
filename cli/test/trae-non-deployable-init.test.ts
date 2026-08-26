/**
 * TRAE non-deployable 初始化契约。
 * 用例名中的真实 UT/ST ID 由全局 OpenLogos reporter 写入 test-results.jsonl。
 */
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
import { fileURLToPath } from 'node:url';
import {
  expandAiTools,
  init,
  parseAiTool,
} from '../src/commands/init.js';
import { aiToolAdapterRegistry } from '../src/lib/ai-tool-adapter.js';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit } from './helpers.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const deployableIds = ['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy'];

function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (dir: string, prefix = '') => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, relative);
      else result[relative] = readFileSync(full).toString('base64');
    }
  };
  walk(root);
  return result;
}

describe('TRAE non-deployable — S01 初始化', () => {
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

  it('UT-S01-124: Registry 不含 trae/TraeCode 且七宿主顺序稳定', () => {
    expect(aiToolAdapterRegistry.list({ deployableOnly: true }).map(item => item.id)).toEqual(deployableIds);
    expect(aiToolAdapterRegistry.has('trae')).toBe(false);
    expect(aiToolAdapterRegistry.has('TraeCode')).toBe(false);
    expect(() => aiToolAdapterRegistry.get('trae')).toThrow(/未知的 AI Adapter id/);
  });

  it('UT-S01-125: all 仅展开既有七宿主并排除 other 与 TRAE', () => {
    expect(expandAiTools(['all', 'workbuddy'])).toEqual(deployableIds);
    expect(expandAiTools('all')).not.toContain('other');
    expect(expandAiTools('all')).not.toContain('trae');
    expect(new Set(expandAiTools('all')).size).toBe(deployableIds.length);
  });

  it('UT-S01-126: CLI 帮助与交互选择只展示 Registry 支持值', () => {
    const indexSource = readFileSync(join(repoRoot, 'cli/src/index.ts'), 'utf8');
    const initSource = readFileSync(join(repoRoot, 'cli/src/commands/init.ts'), 'utf8');
    const supported = `${deployableIds.join(', ')}, other, all`;
    expect(indexSource).toContain(deployableIds.join('|'));
    expect(initSource).toContain(`Supported values: ${supported}`);
    expect(initSource).toContain("console.log('  9. WorkBuddy");
    expect(indexSource).not.toMatch(/\|trae(?:\||>)/i);
    expect(initSource).not.toMatch(/return ['"]trae['"]/i);
  });

  it('UT-S01-127: 显式 trae 与猜测别名 fail loud 且不映射为 other', () => {
    for (const value of ['trae', 'TRAE', 'traecode', 'trae-cn']) {
      expect(parseAiTool(value)).toBeUndefined();
    }
    expect(parseAiTool('other')).toBe('other');
  });

  it('ST-S01-24: init --ai-tool trae 在首个写入前拒绝且用户 .trae 字节不变', async () => {
    const owned = join(root, '.trae', 'owned-by-user.txt');
    mkdirSync(dirname(owned), { recursive: true });
    writeFileSync(owned, Buffer.from([0, 255, 7, 3]));
    const before = snapshot(root);
    const exit = mockProcessExit();
    try {
      await expect(init('demo', { locale: 'zh', aiTool: 'trae' })).rejects.toThrow('process.exit(1)');
    } finally {
      exit.mockRestore();
    }
    expect(snapshot(root)).toEqual(before);
    expect(existsSync(join(root, 'logos/logos.config.json'))).toBe(false);
    expect(consoleCapture.errors.join('\n')).toContain('unsupported AI tool "trae"');
    expect(consoleCapture.errors.join('\n')).toContain('workbuddy, other, all');
    expect(consoleCapture.errors.join('\n')).not.toContain('workbuddy, trae');
  });

  it('ST-S01-25: init --ai-tool all 部署七宿主且不创建或改写 TRAE 资产', async () => {
    const owned = join(root, '.trae', 'owned-by-user.txt');
    mkdirSync(dirname(owned), { recursive: true });
    const ownedBytes = Buffer.from('用户所有的 TRAE 资产\n');
    writeFileSync(owned, ownedBytes);

    await init('demo', { locale: 'zh', aiTool: 'all' });

    expect(JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf8')).aiTool).toEqual(deployableIds);
    expect(expandAiTools('all')).toEqual(deployableIds);
    expect(readFileSync(owned).equals(ownedBytes)).toBe(true);
    expect(snapshot(join(root, '.trae'))).toEqual({ 'owned-by-user.txt': ownedBytes.toString('base64') });
    expect(existsSync(join(root, '.zcode/plugins/openlogos/.zcode-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.qoder/plugins/openlogos/.qoder-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.workbuddy/plugins/openlogos/.workbuddy-plugin/plugin.json'))).toBe(true);
  });
});
