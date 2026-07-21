import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { mkdirSync } from 'node:fs';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { moduleSetProductType } from '../src/commands/module.js';
import {
  PRODUCT_TYPE_ENUM,
  isValidProductType,
  isGuiProductType,
  deriveUiImpact,
  syncGuiOverlay,
  instanceGuiOverlayNodeIds,
} from '../src/lib/ui-first.js';
import { buildProductTypeConfirmation } from '../src/commands/status.js';

function writeProjectYaml(root: string, data: Record<string, unknown>) {
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml(data, { lineWidth: 0 }));
}

function readYaml(root: string): Record<string, unknown> {
  return parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8')) ?? {};
}

function findModule(root: string, id: string): Record<string, unknown> | undefined {
  const yaml = readYaml(root);
  const modules = (yaml.modules as Array<Record<string, unknown>> | undefined) ?? [];
  return modules.find(m => m.id === id);
}

describe('S09 Unit Tests — module set-product-type', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
    restoreCwd = mockCwd(root);
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: '核心功能', lifecycle: 'initial' }],
    });
  });

  afterEach(() => {
    restoreCwd();
    cleanup();
  });

  it('UT-S09-115: set-product-type writes product_type and is idempotent (no-op on same value)', () => {
    const { logs, restore } = captureConsole();
    // First set → writes web, exit 0
    moduleSetProductType('core', 'web');
    restore();
    expect(findModule(root, 'core')?.product_type).toBe('web');
    expect(logs.some(l => l.includes('web'))).toBe(true);

    // Second set with same value → idempotent no-op, still exit 0
    const con2 = captureConsole();
    moduleSetProductType('core', 'web');
    con2.restore();
    expect(findModule(root, 'core')?.product_type).toBe('web');
    // no-op signaled in text output
    expect(con2.logs.some(l => l.includes('no change'))).toBe(true);

    // json envelope reflects changed flag
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => { stdoutChunks.push(String(chunk)); return true; };
    moduleSetProductType('core', 'web', 'json');
    process.stdout.write = origWrite;
    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.command).toBe('module set-product-type');
    expect(parsed.data).toEqual({ module_id: 'core', product_type: 'web', is_gui: true, changed: false });
  });

  it('UT-S09-116: set-product-type rejects invalid enum and does not write file', () => {
    const exitSpy = mockProcessExit();
    const { errors, restore } = captureConsole();
    let threw = false;
    try {
      moduleSetProductType('core', 'gui'); // 'gui' is not a valid enum
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('process.exit(1)');
    }
    restore();
    exitSpy.mockRestore();
    expect(threw).toBe(true);
    // error lists valid enum values
    expect(errors.some(e => e.includes('web') && e.includes('cli'))).toBe(true);
    // file not modified — no product_type written
    expect(findModule(root, 'core')?.product_type).toBeUndefined();
  });

  it('UT-S09-117: set-product-type rejects unknown module id and does not write file', () => {
    const exitSpy = mockProcessExit();
    const { errors, restore } = captureConsole();
    let threw = false;
    try {
      moduleSetProductType('nope', 'web');
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('process.exit(1)');
    }
    restore();
    exitSpy.mockRestore();
    expect(threw).toBe(true);
    expect(errors.some(e => e.includes('not found'))).toBe(true);
    // known module untouched, unknown module not created
    expect(findModule(root, 'core')?.product_type).toBeUndefined();
    expect(findModule(root, 'nope')).toBeUndefined();
  });

  it('UT-S09-117a: set-product-type requires both arguments and does not write file', () => {
    // Missing enum
    {
      const exitSpy = mockProcessExit();
      const { errors, restore } = captureConsole();
      let threw = false;
      try {
        moduleSetProductType('core', undefined);
      } catch (e) {
        threw = true;
        expect(String(e)).toContain('process.exit(1)');
      }
      restore();
      exitSpy.mockRestore();
      expect(threw).toBe(true);
      expect(errors.some(e => e.includes('Usage'))).toBe(true);
      expect(findModule(root, 'core')?.product_type).toBeUndefined();
    }

    // Missing module (and enum)
    {
      const exitSpy = mockProcessExit();
      const { errors, restore } = captureConsole();
      let threw = false;
      try {
        moduleSetProductType(undefined, undefined);
      } catch (e) {
        threw = true;
        expect(String(e)).toContain('process.exit(1)');
      }
      restore();
      exitSpy.mockRestore();
      expect(threw).toBe(true);
      expect(errors.some(e => e.includes('Usage'))).toBe(true);
      expect(findModule(root, 'core')?.product_type).toBeUndefined();
    }
  });

  it('UT-S09-124: service is a valid non-GUI enum — idempotent write, ui_impact always false, no overlay, enum tail', () => {
    // 合法且非 GUI（枚举扩展走既有「合法且非 GUI」路径，零新分支）
    expect(isValidProductType('service')).toBe(true);
    expect(isGuiProductType('service')).toBe(false);

    // 写入成功且幂等（重设同值 no-op）
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: '核心功能', lifecycle: 'launched' }],
    });
    const con1 = captureConsole();
    moduleSetProductType('core', 'service');
    con1.restore();
    expect(findModule(root, 'core')?.product_type).toBe('service');

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => { stdoutChunks.push(String(chunk)); return true; };
    moduleSetProductType('core', 'service', 'json');
    process.stdout.write = origWrite;
    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.data).toEqual({ module_id: 'core', product_type: 'service', is_gui: false, changed: false });

    // ui_impact 恒假：即使提案声明段 ui_impact:true，service 模块（非 GUI）也恒 false
    const proposalDir = join(root, 'logos', 'changes', 'svc-test');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：svc-test',
      '',
      '## UI/UX 变更声明',
      '',
      '```yaml',
      'ui_impact: true',
      'design_system_mode: generated',
      'pages: []',
      '```',
      '',
    ].join('\n'));
    expect(deriveUiImpact(root, 'core', proposalDir)).toBe(false);

    // sync 不注入 gui-ui-first overlay（service 非 GUI，安全默认零改动）
    expect(syncGuiOverlay(root)).toBe('unchanged');
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);

    // 缺字段诊断 next_action.enum：固定顺序 8 值、尾部为 service、既有 7 值前缀逐字不变
    const confirmation = buildProductTypeConfirmation(['other']);
    expect(confirmation?.next_action.enum).toEqual([...PRODUCT_TYPE_ENUM]);
    expect(confirmation?.next_action.enum).toHaveLength(8);
    expect(confirmation?.next_action.enum[7]).toBe('service');
    expect(confirmation?.next_action.enum.slice(0, 7)).toEqual(['web', 'desktop', 'mobile', 'cli', 'api', 'library', 'skills']);
  });
});
