/**
 * 切片1：切片事务状态机、命令面与 initial-plan 原子落盘。
 * 覆盖 UT-S32-52～55、UT-S32-57、UT-S32-58、ST-S32-18、UT-S09-287、UT-S09-288、UT-S13-67。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import {
  TestSliceTransactionError, applyTestSliceTransaction, createTestSliceTransaction,
  readTestSliceTransactionIfPresent, sealTestSliceTransaction, submitTestSliceContent,
} from '../src/lib/test-slice-transaction.js';
import { computeTaskFingerprint, deriveSliceVerificationState } from '../src/lib/test-slice-manifest.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SRC_ROOT = resolve(__dirname, '..', 'src');
const SLUG = 'stx';

const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', '- [ ] 实现代码变更', '',
  '## [deploy] 部署任务', '', '- [ ] 部署项。', '',
].join('\n');

const CODE_BODY = '- [ ] 切片1：第一片（覆盖 UT-S01-01）\n- [ ] 切片2：第二片（覆盖 UT-S01-02）';
const SLICES = [
  { slice_id: 'slice-01-a', task_text: '切片1：第一片（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: ['logos/resources/test/core-S01-test-cases.md'] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: ['logos/resources/test/core-S01-test-cases.md'] },
];

function setup(tasks = TASKS) {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true });
  writeFileSync(join(root, 'logos', 'resources', 'test', 'core-S01-test-cases.md'),
    ['| ID | 描述 |', '|---|---|', '| UT-S01-01 | a |', '| UT-S01-02 | b |', ''].join('\n'));
  const dir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SPEC_MERGED'), '{}');
  writeFileSync(join(dir, 'tasks.md'), tasks);
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  const codeFile = join(root, 'code.txt');
  const slicesFile = join(root, 'slices.json');
  writeFileSync(codeFile, CODE_BODY);
  writeFileSync(slicesFile, JSON.stringify(SLICES));
  return { root, dir, codeFile, slicesFile };
}

const runToSealed = (f: ReturnType<typeof setup>) => {
  createTestSliceTransaction(f.root, f.dir, SLUG);
  submitTestSliceContent(f.dir, 'slot_codesection', f.codeFile);
  submitTestSliceContent(f.dir, 'slot_slices', f.slicesFile);
  return sealTestSliceTransaction(f.dir);
};

describe('S32 切片事务 initial-plan 全链', () => {
  it('UT-S32-52: 两 slot 收齐后原子写出两产物', () => {
    const f = setup();
    const sealed = runToSealed(f);
    expect(sealed.phase).toBe('sealed');
    expect(sealed.content_slots).toMatchObject({ required: 2, submitted: 2, missing_slot_ids: [] });

    const applied = applyTestSliceTransaction(f.root, f.dir);
    expect(applied.phase).toBe('completed');
    expect(applied.receipt).not.toBeNull();
    // 两产物同时存在
    expect(readFileSync(join(f.dir, 'tasks.md'), 'utf8')).toContain('切片1：第一片');
    expect(existsSync(join(f.dir, 'TEST_SLICE_MANIFEST.json'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(f.dir, 'TEST_SLICE_MANIFEST.json'), 'utf8'));
    expect(manifest.slices.map((s: { slice_id: string }) => s.slice_id)).toEqual(['slice-01-a', 'slice-02-b']);
  });

  it('UT-S32-53: apply 中途失败整体回滚，无半写态', () => {
    const f = setup();
    createTestSliceTransaction(f.root, f.dir, SLUG);
    submitTestSliceContent(f.dir, 'slot_codesection', f.codeFile);
    // slot_slices 的 spec_targets 指向不存在的文件 → computeSpecFingerprint 在写 manifest 前抛错
    const broken = join(f.root, 'broken.json');
    writeFileSync(broken, JSON.stringify([{ ...SLICES[0], spec_targets: ['logos/resources/test/nonexistent.md'] }]));
    submitTestSliceContent(f.dir, 'slot_slices', broken);
    sealTestSliceTransaction(f.dir);

    const before = readFileSync(join(f.dir, 'tasks.md'), 'utf8');
    expect(() => applyTestSliceTransaction(f.root, f.dir)).toThrow();
    // 两产物**同时不存在**——tasks.md 回滚到 apply 前，manifest 未创建
    expect(readFileSync(join(f.dir, 'tasks.md'), 'utf8')).toBe(before);
    expect(existsSync(join(f.dir, 'TEST_SLICE_MANIFEST.json'))).toBe(false);
    expect(readTestSliceTransactionIfPresent(f.dir)!.phase).toBe('failed');
  });

  it('UT-S32-54: task_fingerprint 由 OpenLogos 自算，不采信外部提供', () => {
    const f = setup();
    // slot 内容里塞一个伪造指纹——事务必须忽略它
    writeFileSync(f.slicesFile, JSON.stringify({ task_fingerprint: 'sha256:' + 'f'.repeat(64), slices: SLICES }));
    runToSealed(f);
    applyTestSliceTransaction(f.root, f.dir);
    const manifest = JSON.parse(readFileSync(join(f.dir, 'TEST_SLICE_MANIFEST.json'), 'utf8'));
    const actual = computeTaskFingerprint(readFileSync(join(f.dir, 'tasks.md'), 'utf8'));
    expect(manifest.task_fingerprint).toBe(actual);
    expect(manifest.task_fingerprint).not.toContain('ffffffff');
  });

  it('UT-S32-55: [code] 整节替换，其余段字节恒等', () => {
    const f = setup();
    const before = readFileSync(join(f.dir, 'tasks.md'), 'utf8');
    runToSealed(f);
    applyTestSliceTransaction(f.root, f.dir);
    const after = readFileSync(join(f.dir, 'tasks.md'), 'utf8');
    const section = (text: string, tag: string) =>
      new RegExp(`## \\[${tag}\\][\\s\\S]*?(?=\\n## |$)`).exec(text)?.[0] ?? '';
    // [delta] 的已勾选状态与 [deploy] 段字节恒等
    expect(section(after, 'delta')).toBe(section(before, 'delta'));
    expect(section(after, 'deploy')).toBe(section(before, 'deploy'));
    // [code] 已被替换
    expect(section(after, 'code')).toContain('切片1：第一片');
    expect(section(after, 'code')).not.toContain('实现代码变更');
  });

  it('UT-S32-57: Agent 直接写产物的路径不存在', () => {
    // 生产代码中 writeTestSliceManifestAtomic 的调用方只能在切片事务内。
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (name.endsWith('.ts')) out.push(path);
      }
      return out;
    };
    const callers = walk(SRC_ROOT)
      .filter(path => /writeTestSliceManifestAtomic\s*\(/.test(readFileSync(path, 'utf8')))
      .filter(path => !path.endsWith(join('lib', 'test-slice-manifest.ts')))   // 定义处
      .map(path => path.slice(SRC_ROOT.length));
    expect(callers).toEqual([join('/', 'lib', 'test-slice-transaction.ts')]);
    // 且没有任何命令直接暴露该写入能力
    const commandFiles = walk(join(SRC_ROOT, 'commands'));
    expect(commandFiles.filter(p => /writeTestSliceManifestAtomic/.test(readFileSync(p, 'utf8')))).toEqual([]);
  });

  it('UT-S32-58: 单活跃事务与 apply 幂等', () => {
    const f = setup();
    const first = createTestSliceTransaction(f.root, f.dir, SLUG);
    const second = createTestSliceTransaction(f.root, f.dir, SLUG);
    expect(second.transaction_id).toBe(first.transaction_id);   // 不产生第二个活跃事务

    submitTestSliceContent(f.dir, 'slot_codesection', f.codeFile);
    submitTestSliceContent(f.dir, 'slot_slices', f.slicesFile);
    sealTestSliceTransaction(f.dir);
    applyTestSliceTransaction(f.root, f.dir);
    const manifestBytes = readFileSync(join(f.dir, 'TEST_SLICE_MANIFEST.json'), 'utf8');
    // completed 后 allowed_actions 为空，重复 apply 被拒且产物字节不变
    expect(() => applyTestSliceTransaction(f.root, f.dir)).toThrow(TestSliceTransactionError);
    expect(readFileSync(join(f.dir, 'TEST_SLICE_MANIFEST.json'), 'utf8')).toBe(manifestBytes);
  });

  it('ST-S32-18: 真实 CLI 下 initial-plan 全链', () => {
    const f = setup();
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, [CLI, 'slice', 'transaction', ...args], { cwd: f.root, encoding: 'utf8', timeout: 120000 });

    expect(cli('status').status).toBe(0);
    expect(cli('submit-content', '--slot', 'slot_codesection', '--file', f.codeFile).status).toBe(0);
    expect(cli('submit-content', '--slot', 'slot_slices', '--file', f.slicesFile).status).toBe(0);
    expect(cli('seal').status).toBe(0);
    expect(cli('apply').status).toBe(0);

    const json = cli('status', '--format', 'json');
    const data = JSON.parse(json.stdout).data;
    expect(data.phase).toBe('completed');
    expect(data.origin).toBe('initial-plan');
    // 成功 envelope 公开契约哈希，供跨仓消费方精确匹配
    expect(data.schema_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(data.contract_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(existsSync(join(f.dir, 'TEST_SLICE_MANIFEST.json'))).toBe(true);
  });
});

describe('S09 切片事务命令面与归档只读', () => {
  it('UT-S09-287: 动作白名单按 phase 生效', () => {
    const f = setup();
    createTestSliceTransaction(f.root, f.dir, SLUG);
    // collecting 下不许 seal / apply
    expect(readTestSliceTransactionIfPresent(f.dir)!.allowed_actions).toEqual(['submit_content', 'abort']);
    expect(() => sealTestSliceTransaction(f.dir)).toThrow(TestSliceTransactionError);
    expect(() => applyTestSliceTransaction(f.root, f.dir)).toThrow(TestSliceTransactionError);

    submitTestSliceContent(f.dir, 'slot_codesection', f.codeFile);
    submitTestSliceContent(f.dir, 'slot_slices', f.slicesFile);
    expect(readTestSliceTransactionIfPresent(f.dir)!.allowed_actions).toContain('seal');
    sealTestSliceTransaction(f.dir);
    // sealed 下不许再提交内容
    expect(() => submitTestSliceContent(f.dir, 'slot_slices', f.slicesFile)).toThrow(TestSliceTransactionError);
    expect(readTestSliceTransactionIfPresent(f.dir)!.allowed_actions).toEqual(['apply', 'abort']);
  });

  it('UT-S09-288: 归档提案仅放行 status', () => {
    const f = setup();
    runToSealed(f);
    applyTestSliceTransaction(f.root, f.dir);
    // 把提案移入归档目录
    const archived = join(f.root, 'logos', 'changes', 'archive', `20260101-0000-${SLUG}`);
    mkdirSync(join(f.root, 'logos', 'changes', 'archive'), { recursive: true });
    spawnSync('mv', [f.dir, archived]);

    const cli = (...args: string[]) =>
      spawnSync(process.execPath, [CLI, 'slice', 'transaction', ...args, '--slug', SLUG],
        { cwd: f.root, encoding: 'utf8', timeout: 120000 });
    const before = readFileSync(join(archived, 'TEST_SLICE_MANIFEST.json'), 'utf8');
    expect(cli('status').status).toBe(0);
    for (const write of ['seal', 'apply', 'abort']) {
      const r = cli(write);
      expect(r.status, `${write} 应被拒`).not.toBe(0);
      expect(`${r.stdout}${r.stderr}`).toContain('action_not_allowed');
    }
    // 拒绝路径零副作用
    expect(readFileSync(join(archived, 'TEST_SLICE_MANIFEST.json'), 'utf8')).toBe(before);
  });
});

describe('S13 写入权转移后 verify 消费零漂移', () => {
  it('UT-S13-67: 同字节同结论——判定不携带写入者假设', () => {
    // 由事务写出的产物
    const viaTx = setup();
    runToSealed(viaTx);
    applyTestSliceTransaction(viaTx.root, viaTx.dir);
    const tasksBytes = readFileSync(join(viaTx.dir, 'tasks.md'), 'utf8');
    const manifestBytes = readFileSync(join(viaTx.dir, 'TEST_SLICE_MANIFEST.json'), 'utf8');

    // 同一份字节，改由「Agent 直接写出」构造
    const viaAgent = setup();
    writeFileSync(join(viaAgent.dir, 'tasks.md'), tasksBytes);
    writeFileSync(join(viaAgent.dir, 'TEST_SLICE_MANIFEST.json'), manifestBytes);

    const a = deriveSliceVerificationState(viaTx.root, viaTx.dir);
    const b = deriveSliceVerificationState(viaAgent.root, viaAgent.dir);
    // 深相等——不以「测试仍然通过」当零漂移证据
    expect(b).toEqual(a);
  });
});
