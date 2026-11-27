/**
 * S08 生成指令「等待人工验收」硬红线（smoke-manual-acceptance，切片 slice-04-human-only-guard-and-release）。
 *
 * 覆盖 UT-S08-93～UT-S08-96，对应 spec/agents-md.md「两档授权语义的『等待人工验收』硬红线条目（smoke-manual-acceptance）」
 * 与功能规格 §2.107.9。逐字比对以 spec/agents-md.md 中的文案为基准；CLI 走真实入口 cli/dist/index.js。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const SPEC = readFileSync(resolve(HERE, '../../spec/agents-md.md'), 'utf-8');
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** 从 spec/agents-md.md 的新节中取出 zh / en 逐字文案（各自 markdown 代码块内的唯一一行）。 */
function specLine(locale: 'zh' | 'en'): string {
  const section = SPEC.slice(SPEC.indexOf('两档授权语义的「等待人工验收」硬红线条目'));
  const label = locale === 'zh' ? 'zh 文案（逐字）' : 'en 文案（逐字）';
  const after = section.slice(section.indexOf(label));
  const block = after.slice(after.indexOf('```markdown') + '```markdown'.length, after.indexOf('```', after.indexOf('```markdown') + 3));
  return block.trim();
}

function launchedProject(locale: 'zh' | 'en'): string {
  const tmp = makeTempRoot();
  cleanups.push(tmp.cleanup);
  const init = spawnSync(process.execPath, [CLI, 'init', 'p', '--locale', locale, '--ai-tool', 'claude-code'], { cwd: tmp.root, encoding: 'utf-8' });
  expect(init.status, init.stderr).toBe(0);
  const yamlPath = join(tmp.root, 'logos/logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf-8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  const sync = spawnSync(process.execPath, [CLI, 'sync'], { cwd: tmp.root, encoding: 'utf-8' });
  expect(sync.status, sync.stderr).toBe(0);
  return tmp.root;
}

function expectRedLine(root: string, locale: 'zh' | 'en'): void {
  const line = specLine(locale);
  expect(line.length).toBeGreaterThan(50);
  const approvalMarker = locale === 'zh' ? '目标环境要求审批而该版本未获审批' : 'the target environment requires approval';
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const text = readFileSync(join(root, file), 'utf-8');
    expect(text, `${locale} ${file}`).toContain(line);
    const approvalAt = text.indexOf(approvalMarker);
    expect(approvalAt, `${locale} ${file} 部署审批条目`).toBeGreaterThan(-1);
    expect(text.indexOf(line), `${locale} ${file} 位于部署审批条目之后`).toBeGreaterThan(approvalAt);
    expect(text, `${locale} ${file} loop-exhausted 条目保留`).toContain('gate:implement:loop-exhausted');
  }
}

describe('S08 生成指令「等待人工验收」硬红线（smoke-manual-acceptance）', () => {
  it('UT-S08-93: zh 生成指令含新硬红线', () => {
    expectRedLine(launchedProject('zh'), 'zh');
  }, 120_000);

  it('UT-S08-94: en 生成指令含新硬红线', () => {
    expectRedLine(launchedProject('en'), 'en');
  }, 120_000);

  it('UT-S08-95: initial 生命周期不生成；mixed 视图与其他硬红线一起生成', () => {
    const tmp = makeTempRoot();
    cleanups.push(tmp.cleanup);
    expect(spawnSync(process.execPath, [CLI, 'init', 'p', '--locale', 'zh', '--ai-tool', 'claude-code'], { cwd: tmp.root, encoding: 'utf-8' }).status).toBe(0);
    expect(spawnSync(process.execPath, [CLI, 'sync'], { cwd: tmp.root, encoding: 'utf-8' }).status).toBe(0);
    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
      const text = readFileSync(join(tmp.root, file), 'utf-8');
      expect(text, `initial ${file}`).not.toContain('等待人工验收');
      expect(text, `initial ${file}`).not.toContain('openlogos accept');
    }
    // mixed：一个 launched 模块 + 一个 initial 模块
    const yamlPath = join(tmp.root, 'logos/logos-project.yaml');
    const yaml = readFileSync(yamlPath, 'utf-8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched');
    writeFileSync(yamlPath, yaml.replace(/(modules:\n)/, '$1  - id: extra\n    name: Extra\n    lifecycle: initial\n'));
    const sync = spawnSync(process.execPath, [CLI, 'sync'], { cwd: tmp.root, encoding: 'utf-8' });
    expect(sync.status, sync.stderr).toBe(0);
    const claude = readFileSync(join(tmp.root, 'CLAUDE.md'), 'utf-8');
    if (claude.includes('目标环境要求审批而该版本未获审批')) expect(claude).toContain(specLine('zh'));
  }, 120_000);

  it('UT-S08-96: 重复 sync 零变化，托管段以外用户内容保真', () => {
    const root = launchedProject('zh');
    const claudePath = join(root, 'CLAUDE.md');
    writeFileSync(claudePath, `${readFileSync(claudePath, 'utf-8')}\n\n## 用户自有段\n保留我。\n`);
    expect(spawnSync(process.execPath, [CLI, 'sync'], { cwd: root, encoding: 'utf-8' }).status).toBe(0);
    const once = { agents: readFileSync(join(root, 'AGENTS.md'), 'utf-8'), claude: readFileSync(claudePath, 'utf-8') };
    for (let i = 0; i < 2; i++) expect(spawnSync(process.execPath, [CLI, 'sync'], { cwd: root, encoding: 'utf-8' }).status).toBe(0);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf-8')).toBe(once.agents);
    expect(readFileSync(claudePath, 'utf-8')).toBe(once.claude);
    expect(once.claude).toContain('## 用户自有段\n保留我。');
    expect(once.claude).toContain(specLine('zh'));
  }, 180_000);
});
