/**
 * S13 本仓测试入口按清单选文件（enable-layered-verify）。
 * 覆盖 UT-S13-323、UT-S13-324、UT-S13-325、UT-S13-326（`logos/resources/test/core-S13-test-cases.md`
 * 「S13 本仓测试入口按清单选文件测试」）。
 *
 * 夹具 VF：一次性目录里的一组小测试文件，由选文件函数直接读取，并用真实的 vitest（子进程）以同一份选文件逻辑
 * （`eligibleVitestOptions`，即 `vitest.config.ts` 使用的那个函数）执行；不依赖本仓的测试文件。
 * 子进程使用夹具自己的配置，不注册 OpenLogos reporter——夹具里的用例 ID 不会被当作本仓用例上报。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ELIGIBLE_IDS_ENV, fileNamesKnown, listTestFiles, scanTestDir, selectTestFiles } from './eligible-file-selection';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELECTION_MODULE = join(HERE, 'eligible-file-selection.ts');
const VITEST_ENTRY = join(HERE, '..', 'node_modules', 'vitest', 'vitest.mjs');
const RUN_TIMEOUT = 120_000;

// 夹具里的用例 ID。乙、戊的源码不得出现其中任何一个完整的 ID（见预检）。
const X1 = ['UT', 'X01', '01'].join('-');
const X2 = ['UT', 'X01', '02'].join('-');
const X3 = ['UT', 'X01', '03'].join('-');

type Member = 'jia' | 'yi' | 'bing' | 'ding' | 'wu' | 'yiAlias' | 'yiDefault' | 'yiGlobal' | 'yiDeclared';
const SOURCES: Record<Member, string> = {
  // 甲：全部名称为字面量，含 X1，通过
  jia: `describe('jia', () => {\n  it('${X1} jia passes', () => { expect(1).toBe(1); });\n});\n`,
  // 乙：把 ID 本身拆开拼出，运行时名称含 X1，失败
  yi: `const suffix = '01';\ndescribe('yi', () => {\n  it('UT-X01-' + suffix + ' yi fails', () => { expect(1).toBe(2); });\n});\n`,
  // 丙：全部名称为字面量，只含 X2
  bing: `it('${X2} bing passes', () => { expect(1).toBe(1); });\n`,
  // 丁：全部名称为字面量，只含 X3
  ding: `it('${X3} ding passes', () => { expect(1).toBe(1); });\n`,
  // 戊：带转义的字面量（十六进制转义写出第一个连字符），运行时名称含 X1，失败
  wu: `it('UT\\x2dX01-01 wu fails', () => { expect(1).toBe(2); });\n`,
  // 乙的别名写法（code-r1 F1）：把注册器从 vitest 改名导入，再用拆开的 ID 注册失败用例
  yiAlias: `import { it as check, expect as assertThat } from 'vitest';\ncheck('UT-X01-' + '01' + ' yiAlias fails', () => { assertThat(1).toBe(2); });\n`,
  // 乙的解构写法（code-r2 F1）：注册器作为解构的默认值取得
  yiDefault: `const { check = it } = {} as { check?: typeof it };\ncheck('UT-X01-' + '01' + ' yiDefault fails', () => { expect(1).toBe(2); });\n`,
  // 乙的解构写法前加一条类型声明（code-r3 F1）：声明在转译时被擦除，运行时取到的仍是全局注册器
  yiDeclared: `declare function it(name: string, body: () => void): void;\nconst { check = it } = {} as { check?: typeof it };\ncheck('UT-X01-' + '01' + ' yiDeclared fails', () => { throw new Error('yi fails'); });\n`,
  // 乙的解构写法（code-r2 F1）：从全局对象解构出注册器并改名
  yiGlobal: `const { it: check } = globalThis as unknown as { it: (name: string, fn: () => void) => void };\ncheck('UT-X01-' + '01' + ' yiGlobal fails', () => { expect(1).toBe(2); });\n`,
};

const dirs: string[] = [];
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function makeFixture(members: Member[]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-vf-')));
  dirs.push(root);
  mkdirSync(join(root, 'cases'));
  // 让夹具文件里的 `import … from 'vitest'` 能解析（链接在 cases 之外，不影响测试文件的枚举）
  symlinkSync(join(HERE, '..', 'node_modules'), join(root, 'node_modules'), 'junction');
  for (const m of members) writeFileSync(join(root, 'cases', `${m}.test.ts`), SOURCES[m]);
  // 夹具配置：与本仓 vitest.config.ts 使用同一个函数算出 include 与 testNamePattern；VF_SELECT=off 时只按用例名过滤（等价基准）
  writeFileSync(join(root, 'vitest.config.mjs'), [
    `import { ELIGIBLE_IDS_ENV, eligibleVitestOptions } from ${JSON.stringify(SELECTION_MODULE)};`,
    `const o = eligibleVitestOptions({ raw: process.env[ELIGIBLE_IDS_ENV], root: ${JSON.stringify(root)}, testDir: 'cases', allGlob: 'cases/**/*.test.ts', selectFiles: process.env.VF_SELECT !== 'off' });`,
    `export default { test: { globals: true, include: o.include, testNamePattern: o.testNamePattern, reporters: [['json', { outputFile: ${JSON.stringify(join(root, 'out.json'))} }]] } };`,
    '',
  ].join('\n'));
  return root;
}

interface Run { collected: string[]; executed: string[]; failed: string[]; status: number | null }

/** 用真实的 vitest 执行夹具。`raw` 为环境变量取值（undefined 表示不设置）；`select=false` 为等价基准。 */
function runFixture(root: string, raw: string | undefined, select = true): Run {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(VITEST|OPENLOGOS_|TEST$|NODE_OPTIONS$)/.test(k)) continue;
    env[k] = v;
  }
  if (raw !== undefined) env[ELIGIBLE_IDS_ENV] = raw;
  if (!select) env.VF_SELECT = 'off';
  rmSync(join(root, 'out.json'), { force: true });
  const r = spawnSync(process.execPath, [VITEST_ENTRY, 'run', '--root', root, '--config', join(root, 'vitest.config.mjs')], { cwd: root, env, encoding: 'utf8', timeout: RUN_TIMEOUT });
  let out: { testResults: Array<{ name: string; assertionResults: Array<{ fullName: string; status: string }> }> };
  try { out = JSON.parse(readFileSync(join(root, 'out.json'), 'utf8')); } catch { throw new Error(`夹具运行没有产出结果：status=${r.status}\n${r.stdout}\n${r.stderr}`); }
  const member = (name: string): string => name.replace(/\\/g, '/').split('/').pop()!.replace('.test.ts', '');
  const rows = out.testResults.flatMap(f => f.assertionResults.map(t => ({ file: member(f.name), name: t.fullName, status: t.status })));
  const ran = rows.filter(t => t.status === 'passed' || t.status === 'failed');
  return {
    collected: out.testResults.map(f => member(f.name)).sort(),
    executed: ran.map(t => `${t.file} :: ${t.name}`).sort(),
    failed: ran.filter(t => t.status === 'failed').map(t => t.file).sort(),
    status: r.status,
  };
}

/** 夹具预检：乙、戊的源码不含任何完整的夹具 ID；只按用例名过滤时，当前夹具中名称含 X1 的文件各有一条被执行。 */
function precheck(root: string, members: Member[], baseline?: Run): void {
  for (const m of ['yi', 'wu', 'yiAlias', 'yiDefault', 'yiGlobal', 'yiDeclared'] as Member[]) {
    if (!members.includes(m)) continue;
    const src = readFileSync(join(root, 'cases', `${m}.test.ts`), 'utf8');
    for (const id of [X1, X2, X3]) expect(src.includes(id), `夹具无效：${m} 的源码含完整的 ${id}`).toBe(false);
  }
  const base = baseline ?? runFixture(root, JSON.stringify([X1]), false);
  const expected = (['jia', 'yi', 'wu', 'yiAlias', 'yiDefault', 'yiGlobal', 'yiDeclared'] as Member[]).filter(m => members.includes(m)).sort();
  expect(base.executed.map(e => e.split(' :: ')[0]), '夹具无效：只按用例名过滤时的执行集合不符').toEqual(expected);
  expect(base.collected, '夹具无效：基准应收集全部文件').toEqual([...members].sort());
}

const ALL: Member[] = ['jia', 'yi', 'bing', 'ding', 'wu'];

describe('S13 本仓测试入口按清单选文件', () => {
  it('UT-S13-323: 收到清单时只收集相关文件', () => {
    const root = makeFixture(ALL);
    precheck(root, ALL);
    // 选文件函数：乙、戊因名称不能从源码确定而保留；甲、丁不收集
    const files = listTestFiles(join(root, 'cases'));
    const picked = selectTestFiles([X2], files);
    expect(picked.mode).toBe('narrowed');
    expect(picked.files.map(f => basename(f))).toEqual(['bing.test.ts', 'wu.test.ts', 'yi.test.ts']);
    for (const m of ALL) expect(fileNamesKnown(join(root, 'cases', `${m}.test.ts`), SOURCES[m])).toBe(m !== 'yi' && m !== 'wu');
    // 导入环（code-r1 F2）：f2、f3 各经 A、B 取得注册函数，A 与 B 互相导入，helper 以拼接的名称注册目标 ID。
    // 结论不得受扫描顺序或候选集合影响：f2、f3 都必须保留。
    const ring = makeFixture([]);
    const cases = join(ring, 'cases');
    mkdirSync(join(cases, 'support'));
    writeFileSync(join(cases, 'support', 'helper.ts'), `export function register(): void {\n  it('UT-X01-' + '01' + ' via helper', () => { expect(1).toBe(2); });\n}\n`);
    writeFileSync(join(cases, 'support', 'a.ts'), `import './b';\nexport { register } from './helper';\n`);
    writeFileSync(join(cases, 'support', 'b.ts'), `export { register } from './a';\n`);
    writeFileSync(join(cases, 'f1.test.ts'), SOURCES.jia);
    writeFileSync(join(cases, 'f2.test.ts'), `import { register } from './support/a';\nregister();\n`);
    writeFileSync(join(cases, 'f3.test.ts'), `import { register } from './support/b';\nregister();\n`);
    const [f1, f2, f3] = ['f1', 'f2', 'f3'].map(n => join(cases, `${n}.test.ts`));
    expect(selectTestFiles([X1], [f1, f2, f3]).files).toEqual([f1, f2, f3]);
    expect(selectTestFiles([X1], [f3, f2, f1]).files).toEqual([f1, f2, f3]);
    expect(selectTestFiles([X1], [f1, f3]).files).toEqual([f1, f3]);
    expect(selectTestFiles([X1], [f1, f2]).files).toEqual([f1, f2]);
    // 只导入 vi、expect 等非注册器的辅助模块不构成保留理由
    writeFileSync(join(cases, 'support', 'plain.ts'), `import { expect, vi } from 'vitest';\nexport const check = (v: unknown): void => { expect(v).toBeDefined(); void vi; };\n`);
    writeFileSync(join(cases, 'f4.test.ts'), `import { check } from './support/plain';\nit('${X3} f4', () => { check(1); });\n`);
    expect(selectTestFiles([X1], [f1, join(cases, 'f4.test.ts')]).files).toEqual([f1]);
    // 真实执行：收集的文件恰为乙、丙、戊；只执行丙的目标用例；甲、丁既不执行也不出现在结果中
    const run = runFixture(root, JSON.stringify([X2]));
    expect(run.collected).toEqual(['bing', 'wu', 'yi']);
    expect(run.executed).toEqual([`bing :: ${X2} bing passes`]);
    expect(run.failed).toEqual([]);
    expect(run.status).toBe(0);
  }, RUN_TIMEOUT * 3);

  it('UT-S13-324: 同一 ID 在其他文件中由代码拼出、或以带转义的字面量写出时不被漏掉', () => {
    // 第一组（两文件对照）：夹具去掉戊
    const first: Member[] = ['jia', 'yi', 'bing', 'ding'];
    const rootA = makeFixture(first);
    const baseA = runFixture(rootA, JSON.stringify([X1]), false);
    precheck(rootA, first, baseA);
    const narrowA = runFixture(rootA, JSON.stringify([X1]));
    expect(narrowA.collected).toEqual(['jia', 'yi']);
    for (const run of [baseA, narrowA]) {
      expect(run.executed).toEqual([`jia :: jia ${X1} jia passes`, `yi :: yi ${X1} yi fails`]);
      expect(run.failed).toEqual(['yi']);
      expect(run.status).not.toBe(0);
    }
    expect(narrowA.executed).toEqual(baseA.executed);

    // 第二组：完整夹具，再加入以带转义的字面量写出同一 ID 的戊
    const rootB = makeFixture(ALL);
    const baseB = runFixture(rootB, JSON.stringify([X1]), false);
    precheck(rootB, ALL, baseB);
    const narrowB = runFixture(rootB, JSON.stringify([X1]));
    expect(narrowB.collected).toEqual(['jia', 'wu', 'yi']);
    for (const run of [baseB, narrowB]) {
      expect(run.executed).toEqual([`jia :: jia ${X1} jia passes`, `wu :: ${X1} wu fails`, `yi :: yi ${X1} yi fails`]);
      expect(run.failed).toEqual(['wu', 'yi']);
      expect(run.status).not.toBe(0);
    }
    expect(narrowB.executed).toEqual(baseB.executed);

    // 别名（code-r1 F1）：乙改为把注册器从 vitest 改名导入后注册。甲已含完整 ID，不会触发找不到 ID 的回落；
    // 乙必须因「不能证明名称」而保留，两次都恰好执行两条并报告乙失败。
    const alias: Member[] = ['jia', 'yiAlias', 'bing', 'ding'];
    const rootC = makeFixture(alias);
    expect(fileNamesKnown(join(rootC, 'cases', 'yiAlias.test.ts'), SOURCES.yiAlias)).toBe(false);
    for (const src of [
      `const check = it;\ncheck('UT-X01-' + '01', () => {});\n`, // 把全局注册器赋给别的名字
      `import * as v from 'vitest';\nv.it('UT-X01-' + '01', () => {});\n`, // 命名空间导入
      `[it].forEach(fn => fn('UT-X01-' + '01', () => {}));\n`, // 当作值传递
      `globalThis.test('UT-X01-' + '01', () => {});\n`, // 经全局对象访问
      `import { it } from './support/wrapped';\nit('literal name', () => {});\n`, // 从别的模块导入同名绑定
    ]) expect(fileNamesKnown(join(rootC, 'cases', 'probe.test.ts'), src), src).toBe(false);
    const baseC = runFixture(rootC, JSON.stringify([X1]), false);
    precheck(rootC, alias, baseC);
    const narrowC = runFixture(rootC, JSON.stringify([X1]));
    expect(narrowC.collected).toEqual(['jia', 'yiAlias']);
    for (const run of [baseC, narrowC]) {
      expect(run.executed).toEqual([`jia :: jia ${X1} jia passes`, `yiAlias :: ${X1} yiAlias fails`]);
      expect(run.failed).toEqual(['yiAlias']);
      expect(run.status).not.toBe(0);
    }
    expect(narrowC.executed).toEqual(baseC.executed);

    // 解构（code-r2 F1）：乙经解构默认值、或从全局对象解构取得注册器。两种写法在收窄前后都必须观察到乙失败。
    for (const variant of ['yiDefault', 'yiGlobal', 'yiDeclared'] as Member[]) {
      const members: Member[] = ['jia', variant, 'bing', 'ding'];
      const root = makeFixture(members);
      expect(fileNamesKnown(join(root, 'cases', `${variant}.test.ts`), SOURCES[variant]), variant).toBe(false);
      const base = runFixture(root, JSON.stringify([X1]), false);
      precheck(root, members, base);
      const narrow = runFixture(root, JSON.stringify([X1]));
      expect(narrow.collected, variant).toEqual(['jia', variant].sort());
      for (const run of [base, narrow]) {
        expect(run.executed, variant).toEqual([`jia :: jia ${X1} jia passes`, `${variant} :: ${X1} ${variant} fails`].sort());
        expect(run.failed, variant).toEqual([variant]);
        expect(run.status).not.toBe(0);
      }
      expect(narrow.executed).toEqual(base.executed);
    }
    // 其余经解构、声明或全局对象取得注册器的写法（函数级）
    for (const src of [
      `const { describe: group } = globalThis;\ngroup('UT-X01-' + '01', () => {});\n`,
      `const { it } = globalThis;\nit('UT-X01-' + '01', () => {});\n`, // 同名局部绑定遮住全局
      `const [check = test] = [];\ncheck('UT-X01-' + '01', () => {});\n`, // 数组解构的默认值
      `const g = globalThis;\ng['i' + 't']('UT-X01-' + '01', () => {});\n`, // 全局对象整体转手
      `const it = (globalThis as any)['i' + 't'];\nit('UT-X01-' + '01', () => {});\n`, // 下标取出后用同名变量接住
      `function run({ reg = it } = {}) { reg('UT-X01-' + '01', () => {}); }\nrun();\n`, // 参数解构的默认值
      // 与注册器同名、转译时被擦除或无法跟踪的声明（code-r3 F1）
      `declare const test: (n: string, f: () => void) => void;\nconst t = test;\nt('UT-X01-' + '01', () => {});\n`,
      `declare function describe(n: string, f: () => void): void;\nconst [g = describe] = [];\ng('UT-X01-' + '01', () => {});\n`,
      `declare namespace it { const x: number }\nconst { c = it } = {} as any;\nc('UT-X01-' + '01', () => {});\n`,
      `declare global { function it(n: string, f: () => void): void }\nconst { c = it } = {} as any;\nc('UT-X01-' + '01', () => {});\n`,
      `function it(n: string, f: () => void): void;\nfunction it(n: string, f: () => void) { test(n + '-01', f); }\nit('UT-X01', () => {});\n`, // 包了一层的同名实现
      `function outer(it: (n: string) => void): void;\nfunction outer() {}\nconst { c = it } = {} as any;\nc('UT-X01-' + '01', () => {});\n`, // 无函数体的重载签名里的参数不构成绑定
    ]) expect(fileNamesKnown(join(rootC, 'cases', 'probe.test.ts'), src), src).toBe(false);
    // 不应误伤：局部参数恰好叫 it、只取全局对象的普通属性
    expect(fileNamesKnown(join(rootC, 'cases', 'probe.test.ts'), `it('literal', () => { [1].map(it => it + 1); void globalThis.process; });\n`)).toBe(true);
    // 叫 global / self 的局部变量不是全局对象；但只有类型声明（declare）时，运行时仍是全局对象
    expect(fileNamesKnown(join(rootC, 'cases', 'probe.test.ts'), `it('literal', () => { const global = { a: 1 }; const self = [global]; void self; });\n`)).toBe(true);
    expect(fileNamesKnown(join(rootC, 'cases', 'probe.test.ts'), `declare const self: any;\nconst { it: c } = self;\nc('UT-X01-' + '01', () => {});\n`)).toBe(false);
    expect(fileNamesKnown(join(rootC, 'cases', 'probe.test.ts'), `declare const window: any;\nconst g = window;\ng.it('UT-X01-' + '01', () => {});\n`)).toBe(false);
  }, RUN_TIMEOUT * 16);

  it('UT-S13-325: 清单中有 ID 找不到时回落为收集全部文件', () => {
    const members: Member[] = ['jia', 'bing', 'ding'];
    const root = makeFixture(members);
    precheck(root, members);
    const missing = ['UT', 'X09', '99'].join('-');
    const picked = selectTestFiles([X2, missing], listTestFiles(join(root, 'cases')));
    expect(picked.mode).toBe('all');
    expect(picked.reason).toBe('id_not_found');
    expect(picked.missingIds).toEqual([missing]);
    const raw = JSON.stringify([X2, missing]);
    const base = runFixture(root, raw, false);
    const run = runFixture(root, raw);
    expect(run.collected).toEqual(['bing', 'ding', 'jia']);
    expect(run.executed).toEqual([`bing :: ${X2} bing passes`]);
    expect(run.executed).toEqual(base.executed);
    expect(run.collected).toEqual(base.collected);

    // 符号链接（code-r1 F3）：vitest 的发现规则会跟随链接，本模块的枚举不跟随；目录下有链接时不收窄。
    // 普通文件与链接各注册一条同 ID 用例，链接那条失败——基准与按规则执行的结果必须相同。
    const linked = makeFixture(['jia', 'bing', 'ding']);
    mkdirSync(join(linked, 'outside'));
    writeFileSync(join(linked, 'outside', 'target.ts'), `it('${X2} via link fails', () => { expect(1).toBe(2); });\n`);
    let canLink = true;
    try { symlinkSync(join(linked, 'outside', 'target.ts'), join(linked, 'cases', 'link.test.ts'), 'file'); } catch { canLink = false; }
    if (canLink) {
      const listing = scanTestDir(join(linked, 'cases'));
      expect(listing.symlinks.map(f => basename(f))).toEqual(['link.test.ts']);
      const viaLink = selectTestFiles([X2], listing.files, listing.symlinks);
      expect(viaLink.mode).toBe('all');
      expect(viaLink.reason).toBe('symlink_present');
      const baseL = runFixture(linked, JSON.stringify([X2]), false);
      const runL = runFixture(linked, JSON.stringify([X2]));
      expect(baseL.executed).toHaveLength(2); // 丙的一条与链接的一条
      expect(baseL.failed).toHaveLength(1);
      expect(runL.executed).toEqual(baseL.executed);
      expect(runL.failed).toEqual(baseL.failed);
      expect(runL.collected).toEqual(baseL.collected);
    }
  }, RUN_TIMEOUT * 7);

  it('UT-S13-326: 未收到清单、或清单不是合法的字符串数组时收集全部文件', () => {
    const root = makeFixture(ALL);
    precheck(root, ALL);
    const everything = [`bing :: ${X2} bing passes`, `ding :: ${X3} ding passes`, `jia :: jia ${X1} jia passes`, `wu :: ${X1} wu fails`, `yi :: yi ${X1} yi fails`];
    for (const raw of [undefined, '', '{not json', '[]']) {
      expect(selectTestFiles(undefined, listTestFiles(join(root, 'cases'))).mode).toBe('all');
      const run = runFixture(root, raw);
      expect(run.collected, `raw=${String(raw)}`).toEqual(['bing', 'ding', 'jia', 'wu', 'yi']);
      expect(run.executed, `raw=${String(raw)}`).toEqual(everything); // 不按用例名过滤
      expect(run.executed).toEqual(runFixture(root, raw, false).executed); // 与引入前相同
    }
  }, RUN_TIMEOUT * 10);
});
