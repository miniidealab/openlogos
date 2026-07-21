import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  makeTempRoot,
  captureConsole,
  mockCwd,
  mockProcessExit,
} from './helpers.js';
import { checkUiPrototype } from '../src/commands/check-ui-prototype.js';
import { readUiUxDeclaration } from '../src/lib/ui-first.js';

/**
 * S09 UI checker — proposal-ui-ux-first 切片1 `openlogos check-ui-prototype` 富对账。
 * 契约见 spec/proposal-ui-ux-first.md §6.2。
 */

interface DeclPage {
  id: string;
  prototype: string;
  description?: string;
}

interface WriteOpts {
  ui_impact?: boolean;
  design_system_mode?: string;
  design_system_fallback_reason?: string;
  pages?: DeclPage[];
  /** 原型目录实际写入的 .html 文件 [basename, content]；默认按 pages 声明写非空内容。 */
  files?: Array<[string, string]>;
  /** 是否写 design-system.json（generated 令牌）；string 为原文，object 为 JSON。 */
  designSystem?: string | Record<string, unknown> | null;
  slug?: string;
}

const PROTO_REL = 'deltas/prd/2-product-design/2-page-design';

function writeProposal(root: string, opts: WriteOpts): string {
  const slug = opts.slug ?? 'ui-change';
  const proposalDir = join(root, 'logos', 'changes', slug);
  mkdirSync(proposalDir, { recursive: true });

  const pages = opts.pages ?? [];
  const lines: string[] = [];
  lines.push('# 变更提案：' + slug);
  lines.push('');
  lines.push('## UI/UX 变更声明');
  lines.push('');
  lines.push('```yaml');
  lines.push('ui_impact: ' + (opts.ui_impact ?? true));
  if (opts.design_system_mode !== undefined) {
    lines.push('design_system_mode: ' + opts.design_system_mode);
  }
  if (opts.design_system_fallback_reason !== undefined) {
    lines.push('design_system_fallback_reason: ' + JSON.stringify(opts.design_system_fallback_reason));
  }
  lines.push('pages:');
  for (const p of pages) {
    lines.push('  - id: ' + p.id);
    lines.push('    prototype: ' + p.prototype);
    lines.push('    description: ' + (p.description ?? p.id));
  }
  lines.push('```');
  writeFileSync(join(proposalDir, 'proposal.md'), lines.join('\n'));

  // 原型文件：显式 files 覆盖，否则按声明写非空内容
  const protoDir = join(proposalDir, PROTO_REL);
  mkdirSync(protoDir, { recursive: true });
  const files = opts.files ?? pages.map(p => [p.prototype, `<html>${p.id}</html>`] as [string, string]);
  for (const [name, content] of files) {
    // 仅写合法 basename 的文件（非法 basename 用于声明校验，不落盘）
    if (!name.includes('/') && !name.includes('\\') && !name.includes('..')) {
      writeFileSync(join(protoDir, name), content);
    }
  }

  if (opts.designSystem !== undefined && opts.designSystem !== null) {
    const body = typeof opts.designSystem === 'string'
      ? opts.designSystem
      : JSON.stringify(opts.designSystem, null, 2);
    writeFileSync(join(proposalDir, 'design-system.json'), body);
  }

  return proposalDir;
}

function runCheck(root: string, slug: string | undefined): number {
  const restoreCwd = mockCwd(root);
  const exitSpy = mockProcessExit();
  const cap = captureConsole();
  let code = -999;
  try {
    checkUiPrototype(slug, 'text');
  } catch (e) {
    const m = /process\.exit\((-?\d+)\)/.exec(String(e));
    if (m) code = Number(m[1]);
    else throw e;
  } finally {
    cap.restore();
    exitSpy.mockRestore();
    restoreCwd();
  }
  return code;
}

describe('S09 UI checker — check-ui-prototype', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    mkdirSync(join(root, 'logos', 'changes'), { recursive: true });
  });
  afterEach(() => cleanup());

  it('UT-S09-79: generated 全齐（声明==产出，令牌非空）→ exit 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      ui_impact: true,
      design_system_mode: 'generated',
      pages: [{ id: 'home', prototype: 'core-01-home.html', description: '首页' }],
      designSystem: { colors: { primary: '#000' } },
    });
    expect(runCheck(root, 'ui-change')).toBe(0);
  });

  it('UT-S09-80: 逐页对账不全（声明 2 页仅产出 1 页）→ 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [
        { id: 'home', prototype: 'core-01-home.html' },
        { id: 'about', prototype: 'core-02-about.html' },
      ],
      files: [['core-01-home.html', '<html>home</html>']],
      designSystem: { a: 1 },
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('UT-S09-81: generated 缺 design-system.json → 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [{ id: 'home', prototype: 'core-01-home.html' }],
      designSystem: null,
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('UT-S09-81a: fallback 无令牌但有 reason → exit 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'fallback',
      design_system_fallback_reason: '设计系统尚未就绪，采用手工样式',
      pages: [{ id: 'home', prototype: 'core-01-home.html' }],
      designSystem: null,
    });
    expect(runCheck(root, 'ui-change')).toBe(0);
  });

  it('UT-S09-81b: fallback 却存在 design-system.json（伪造令牌）→ 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'fallback',
      design_system_fallback_reason: '手工样式',
      pages: [{ id: 'home', prototype: 'core-01-home.html' }],
      designSystem: { forged: true },
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('UT-S09-81c: 缺 design_system_mode → fail closed 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: undefined,
      pages: [{ id: 'home', prototype: 'core-01-home.html' }],
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('UT-S09-85a: 声明页清单解析为结构化条目 {id,prototype,description}（非裸字符串列表）', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [
        { id: 'home', prototype: 'core-01-home.html', description: '首页' },
        { id: 'detail', prototype: 'core-02-detail.html', description: '详情' },
      ],
      designSystem: { a: 1 },
    });
    const decl = readUiUxDeclaration(join(root, 'logos', 'changes', 'ui-change'));
    expect(decl.present).toBe(true);
    expect(decl.ui_impact).toBe(true);
    expect(Array.isArray(decl.pages)).toBe(true);
    expect(decl.pages).toEqual([
      { id: 'home', prototype: 'core-01-home.html', description: '首页' },
      { id: 'detail', prototype: 'core-02-detail.html', description: '详情' },
    ]);
    // 每项为结构化对象而非裸字符串
    for (const p of decl.pages) {
      expect(typeof p).toBe('object');
      expect(typeof p.id).toBe('string');
      expect(typeof p.prototype).toBe('string');
      expect(typeof p.description).toBe('string');
    }
  });

  it('UT-S09-111: Python3 缺失 → fallback 兜底（无令牌 + 非空 reason）→ check-ui-prototype exit 0（与 81a 端到端一致）', () => {
    writeProposal(root, {
      slug: 'ui-change',
      ui_impact: true,
      design_system_mode: 'fallback',
      design_system_fallback_reason: '无 Python3，未走设计系统，采用通用风格兜底',
      pages: [{ id: 'home', prototype: 'core-01-home.html', description: '首页' }],
      designSystem: null,   // 降级：不产 design-system.json、不伪造令牌
    });
    expect(runCheck(root, 'ui-change')).toBe(0);   // 不阻塞、不报错
  });

  it('UT-S09-85b: 多页对账通过 → exit 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [
        { id: 'home', prototype: 'core-01-home.html' },
        { id: 'about', prototype: 'core-02-about.html' },
        { id: 'detail', prototype: 'core-03-detail.html' },
      ],
      designSystem: { tokens: 1 },
    });
    expect(runCheck(root, 'ui-change')).toBe(0);
  });

  it('UT-S09-85c: 声明重复 basename → 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [
        { id: 'home', prototype: 'core-01-home.html' },
        { id: 'home2', prototype: 'core-01-home.html' },
      ],
      designSystem: { a: 1 },
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('UT-S09-85d: 产出多于声明（额外文件）→ 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [{ id: 'home', prototype: 'core-01-home.html' }],
      files: [
        ['core-01-home.html', '<html>home</html>'],
        ['core-02-extra.html', '<html>extra</html>'],
      ],
      designSystem: { a: 1 },
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('UT-S09-85e: 声明多于产出（缺失）→ 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [
        { id: 'home', prototype: 'core-01-home.html' },
        { id: 'about', prototype: 'core-02-about.html' },
      ],
      files: [['core-01-home.html', '<html>home</html>']],
      designSystem: { a: 1 },
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('UT-S09-85f: 非法命名 prototype → 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [{ id: 'home', prototype: 'home.html' }],
      files: [['home.html', '<html>home</html>']],
      designSystem: { a: 1 },
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('UT-S09-85g: prototype 含 `..` 路径穿越 → 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [{ id: 'home', prototype: '../core-01-home.html' }],
      files: [['core-01-home.html', '<html>home</html>']],
      designSystem: { a: 1 },
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('ST-S09-EX-9.2: 声明 3 页仅产出 2 页 → 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [
        { id: 'home', prototype: 'core-01-home.html' },
        { id: 'about', prototype: 'core-02-about.html' },
        { id: 'detail', prototype: 'core-03-detail.html' },
      ],
      files: [
        ['core-01-home.html', '<html>home</html>'],
        ['core-02-about.html', '<html>about</html>'],
      ],
      designSystem: { a: 1 },
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('ST-S09-EX-9.4: 空文件（0 字节）→ 非 0', () => {
    writeProposal(root, {
      slug: 'ui-change',
      design_system_mode: 'generated',
      pages: [{ id: 'home', prototype: 'core-01-home.html' }],
      files: [['core-01-home.html', '']],
      designSystem: { a: 1 },
    });
    expect(runCheck(root, 'ui-change')).not.toBe(0);
  });

  it('UT-S09-79b: ui_impact !== true → exit 0（when 不满足）', () => {
    writeProposal(root, {
      slug: 'ui-change',
      ui_impact: false,
      design_system_mode: 'generated',
      pages: [{ id: 'home', prototype: 'core-01-home.html' }],
      designSystem: null,
    });
    expect(runCheck(root, 'ui-change')).toBe(0);
  });

  it('UT-S09-79g: slug 省略时经 guard.activeChange 解析 → exit 0', () => {
    writeProposal(root, {
      slug: 'guard-change',
      design_system_mode: 'generated',
      pages: [{ id: 'home', prototype: 'core-01-home.html' }],
      designSystem: { a: 1 },
    });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'guard-change', module: 'core' }),
    );
    expect(runCheck(root, undefined)).toBe(0);
  });
});
