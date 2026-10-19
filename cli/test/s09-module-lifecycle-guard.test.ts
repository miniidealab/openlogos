/**
 * S09 guard 按模块生命周期判定测试（module-lifecycle-guard，[code] 切片 1）。
 *
 * 覆盖 logos/resources/test/core-S09-test-cases.md「S09 guard 按模块生命周期判定测试」UT-S09-467～UT-S09-477；
 * 根规范 spec/pretooluse-guard.md「按文件归属的模块生命周期判定（module-lifecycle-guard，规范性）」。
 *
 * - 被测对象一律为分发源真实实现：plugin/bin/guard-check（bash）、plugin/bin/guard-post-check.cjs（引擎）、
 *   plugin-cursor / plugin-qoder / plugin-workbuddy / plugin-zcode 运行时；函数层直接调用其导出，不另写规则副本。
 * - 「与修改前相同」类断言的基准为 fixtures/s09-module-lifecycle-baseline.json：由 0.16.8（adce1e8）分发源对同一输入
 *   实测生成（生成器 fixtures/gen-s09-module-lifecycle-baseline.ts），测试内不复述期望。
 * - 夹具位于 mkdtemp 隔离目录，不触碰本仓或用户其他仓库。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { ENGINE_SRC, REPO_ROOT, cleanEnv, loadGuardRegion } from './s09-guard-vcs-fixtures.js';
import { nextId, postToolUse, preToolUse } from './s09-guard-post-check-helpers.js';
import {
  MLG_BASELINE_FILE, MLG_HOSTS, MLG_INPUTS, MLG_VECTOR_FILE, type MlgBaselineCase, type MlgHost, type MlgInput,
  type MlgKind, type MlgRun, type MlgState, baselineKey, buildMlgProject, resetRuntime, runCombo, runMlgHost, withProposal,
} from './s09-module-lifecycle-fixtures.js';

const require = createRequire(import.meta.url);
const TIMEOUT = 300_000;

const JS_RUNTIMES: Record<string, string> = {
  engine: 'plugin/bin/guard-post-check.cjs',
  cursor: 'plugin-cursor/hooks/runtime.cjs',
  qoder: 'plugin-qoder/hooks/runtime.cjs',
  workbuddy: 'plugin-workbuddy/hooks/runtime.cjs',
  zcode: 'plugin-zcode/runtime/hook-runtime.js',
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (rel: string): any => require(join(REPO_ROOT, rel));

interface Vector { fixtures: Record<string, string>; cases: Array<{ fixture: string; path: string; expect: string; step: number }> }
const vector = JSON.parse(readFileSync(MLG_VECTOR_FILE, 'utf-8')) as Vector;
const baseline = new Map<string, MlgBaselineCase>();
for (const c of (JSON.parse(readFileSync(MLG_BASELINE_FILE, 'utf-8')) as { cases: MlgBaselineCase[] }).cases) baseline.set(baselineKey(c), c);

const roots: string[] = [];
function tmp(prefix = 'openlogos-mlg-t-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  roots.push(d);
  return d;
}
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function project(kind: MlgKind, state: MlgState = 'none'): string {
  return withProposal(buildMlgProject(tmp(), kind), state);
}

/** 向量夹具根：只含 logos-project.yaml（向量原文）与不含 guard 字段的 logos.config.json。 */
const vectorRoots = new Map<string, string>();
function vectorRoot(fixture: string): string {
  let root = vectorRoots.get(fixture);
  if (!root) {
    root = tmp('openlogos-mlg-v-');
    mkdirSync(join(root, 'logos'), { recursive: true });
    writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ name: 'v', locale: 'zh' }));
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), vector.fixtures[fixture]);
    vectorRoots.set(fixture, root);
  }
  return root;
}

const REPO = REPO_ROOT;
const run = (host: MlgHost, root: string, key: string): MlgRun => {
  const item = MLG_INPUTS.find(i => i.key === key);
  if (!item) throw new Error(`未知输入：${key}`);
  const r = runMlgHost(REPO, host, root, item);
  resetRuntime(root);
  return r;
};
const base = (host: MlgHost, kind: MlgKind, state: MlgState, key: string): MlgBaselineCase => {
  const c = baseline.get(baselineKey({ host, kind, state, key }));
  if (!c) throw new Error(`基准缺失：${host} ${kind} ${state} ${key}`);
  return c;
};
/** Cursor 文件编辑为 afterFileEdit 事后报告：有越界报告视为「阻断」，统一折算为 0 / 2 便于与其余宿主比较。 */
const outcome = (host: MlgHost, item: MlgInput, r: MlgRun): number =>
  host === 'cursor' && item.tool !== 'Bash' ? (r.stdout.includes('outside allowed scope') ? 2 : 0) : r.exit;

/** bash 归属函数（分发源 guard-check 函数区，含 mlg_*）在 root 下的判定结果。 */
let regionFile = '';
function bashOwner(root: string, rel: string, pathEnv?: string): { verdict: string; step: string } {
  if (!regionFile) regionFile = loadGuardRegion(tmp('openlogos-mlg-r-')).file;
  const r = spawnSync('bash', ['-c', 'set -u; source "$1"; mlg_owner "$2"; printf "%s %s\\n" "$MLG_VERDICT" "$MLG_STEP"', 'fn', regionFile, rel], {
    cwd: root, encoding: 'utf-8', timeout: 20_000, env: cleanEnv(pathEnv ? { PATH: pathEnv } : {}),
  });
  const m = /^(\S+) (\S+)\n$/.exec(r.stdout ?? '');
  if (!m) throw new Error(`mlg_owner 无结果：${rel}\n${r.stdout}\n${r.stderr}`);
  return { verdict: m[1], step: m[2] };
}

function block(text: string): string {
  const s = text.indexOf('// >>> openlogos module-ownership v1');
  const e = text.indexOf('// <<< openlogos module-ownership v1');
  if (s < 0 || e < 0) throw new Error('缺少 module-ownership 代码块标记');
  return text.slice(s, e);
}

describe('S09 guard 按模块生命周期判定（module-lifecycle-guard）', () => {
  it('UT-S09-467: 归属规则与共享向量（引擎实现）', () => {
    const engine = load(JS_RUNTIMES.engine);
    expect(vector.cases.length).toBeGreaterThanOrEqual(40);
    for (const c of vector.cases) {
      const r = engine.mlgOwnership(engine.mlgLoadModel(vectorRoot(c.fixture)), c.path);
      expect(`${r.verdict} ${r.step}`, `${c.fixture} ${c.path}`).toBe(`${c.expect} ${c.step}`);
    }
    // 非法 paths 条目被忽略、合法条目照常生效（M-invalid-paths 的 /abs、../x、空串）
    const model = engine.mlgParseProject(vector.fixtures['M-invalid-paths']);
    expect(model.modules.find((m: { id: string }) => m.id === 'team').paths).toEqual(['/abs', '../x', '', 'team/**']);
    // 不可解析：modules 缺失、不是序列、流式数组未闭合、未闭合引号、节内制表符
    for (const bad of ['project:\n  name: x\n', 'modules:\n  core: x\n', 'modules:\n  - id: a\n    paths: ["x"\n',
      'modules:\n  - id: "a\n', 'modules:\n\t- id: a\n']) {
      expect(engine.mlgParseProject(bad), JSON.stringify(bad)).toBeNull();
    }
    // code-r1 F1 差异对照：子集解析成功时，归属字段须与项目使用的 yaml 库逐模块一致（非字符串 id / lifecycle 视为缺失，
    // paths 只保留字符串条目）；子集解析不了的写法一律返回 null（保守，不做按文件判定），不得丢失 launched 路径后继续放行
    for (const [fixture, text] of Object.entries(vector.fixtures)) {
      const ours = engine.mlgParseProject(text);
      if (ours === null) continue;
      const lib = parseYaml(text) as { modules?: Array<Record<string, unknown>> };
      const expected = (lib.modules ?? []).map(m => ({
        id: typeof m.id === 'string' ? m.id : '',
        lifecycle: typeof m.lifecycle === 'string' ? m.lifecycle : '',
        paths: Array.isArray(m.paths) ? m.paths.filter(x => typeof x === 'string') : [],
      }));
      expect(ours.modules, `${fixture} 与 yaml 库不一致`).toEqual(expected);
    }
    for (const fixture of ['M-alias', 'M-escape', 'M-scalar-paths', 'M-block-id']) {
      expect(engine.mlgParseProject(vector.fixtures[fixture]), `${fixture} 应保守不解析`).toBeNull();
    }
    // 块标量内容不被当作结构
    const withBlock = engine.mlgParseProject('modules:\n  - id: a\n    description: |\n      - not: an item\n      text\n    lifecycle: initial\n');
    expect(withBlock.modules).toEqual([{ id: 'a', lifecycle: 'initial', paths: [] }]);
  }, TIMEOUT);

  it('UT-S09-468: bash guard-check 与共享向量逐条一致；JS 代码块逐字节相同', () => {
    for (const c of vector.cases) {
      const r = bashOwner(vectorRoot(c.fixture), c.path);
      expect(`${r.verdict} ${r.step}`, `bash ${c.fixture} ${c.path}`).toBe(`${c.expect} ${c.step}`);
    }
    // 不依赖 python / node：受控 PATH 中只有 bash 与少量外部命令，结论不变
    const stub = join(tmp('openlogos-mlg-p-'), 'bin');
    mkdirSync(stub, { recursive: true });
    for (const tool of ['bash', 'cat', 'grep', 'sed', 'head', 'tr', 'env', 'find']) {
      const real = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf-8' }).stdout.trim();
      if (real) symlinkSync(real, join(stub, tool));
    }
    for (const c of vector.cases.filter(v => v.fixture === 'M-variant-quoted' || v.fixture === 'M-variant-block' || v.fixture === 'M-variant-crlf')) {
      const r = bashOwner(vectorRoot(c.fixture), c.path, stub);
      expect(`${r.verdict} ${r.step}`, `bash（无 python/node）${c.fixture} ${c.path}`).toBe(`${c.expect} ${c.step}`);
    }
    const canonical = block(readFileSync(join(REPO_ROOT, JS_RUNTIMES.engine), 'utf-8'));
    for (const [name, rel] of Object.entries(JS_RUNTIMES)) {
      expect(block(readFileSync(join(REPO_ROOT, rel), 'utf-8')), `${name} 的 module-ownership 代码块须与引擎逐字节相同`).toBe(canonical);
    }
  }, TIMEOUT);

  it('UT-S09-469: Edit / Write / MultiEdit / NotebookEdit，无活跃提案', () => {
    const root = project('M-repo');
    for (const key of ['Write team spec', 'Edit team/app.ts', 'MultiEdit S44 api', 'NotebookEdit team/n.ipynb']) {
      expect(run('claude', root, key).exit, key).toBe(0);
    }
    for (const key of ['Write src/main.ts', 'Write core spec', 'Write scripts/release.sh']) {
      const r = run('claude', root, key);
      expect(r.exit, key).toBe(2);
      expect(r.stdout, `${key} 的 reason 应与修改前相同`).toBe(base('claude', 'M-repo', 'none', key).stdout);
    }
    const shared = project('M-shared');
    expect(run('claude', shared, 'Write shared/protocol.ts').exit).toBe(2);
    expect(run('claude', shared, 'Edit team/app.ts').exit).toBe(0);
  }, TIMEOUT);

  it('UT-S09-470: 其他模块有活跃提案时不受 proposal_step 收窄；launched 目标结论不变', () => {
    for (const state of ['plan', 'delta-writing', 'ready-to-merge'] as MlgState[]) {
      const root = project('M-repo', state);
      for (const host of ['claude', 'qoder', 'workbuddy', 'zcode'] as MlgHost[]) {
        for (const key of ['Write team spec', 'Edit team/app.ts']) {
          expect(run(host, root, key).exit, `${host} ${state} ${key}`).toBe(0);
        }
        const r = run(host, root, 'Write src/main.ts');
        const want = base(host, 'M-repo', state, 'Write src/main.ts');
        expect(r, `${host} ${state} src/main.ts 应与修改前相同`).toEqual({ exit: want.exit, stdout: want.stdout });
        if (host === 'claude') expect(r.exit, `claude ${state} 提案期不收窄非 delta 路径`).toBe(0);
        if (host !== 'claude' && state !== 'plan') expect(r.exit, `${host} ${state} 按 proposal_step 收窄`).toBe(2);
      }
      if (state === 'plan') {
        const r = run('claude', root, 'Write core-x delta');
        expect(r.exit, 'plan 阶段非原型 delta 仍被收窄').toBe(2);
        expect(r.stdout).toBe(base('claude', 'M-repo', 'plan', 'Write core-x delta').stdout);
      }
    }
  }, TIMEOUT);

  it('UT-S09-471: 不可豁免项与受限命令先于归属判定', () => {
    const keys = ['Write team/.gitignore', 'Write runtime state', 'Write logos.config.json', 'Bash openlogos exempt add team/', 'Bash openlogos approve'];
    for (const state of ['none', 'delta-writing'] as MlgState[]) {
      const root = project('M-repo', state);
      for (const key of keys) {
        const want = base('claude', 'M-repo', state, key);
        expect(run('claude', root, key), `${state} ${key}`).toEqual({ exit: want.exit, stdout: want.stdout });
      }
    }
    // 已配置门禁的环境登记表：team 的 paths 覆盖该文件也不改变宿主原生审批
    const gated = project('M-repo');
    const yaml = readFileSync(join(gated, 'logos/logos-project.yaml'), 'utf-8').replace('paths: ["team/**"]', 'paths: ["team/**", "logos/environments.yaml"]');
    writeFileSync(join(gated, 'logos/logos-project.yaml'), yaml);
    writeFileSync(join(gated, 'logos/environments.yaml'), 'environments:\n  prod:\n    promote_from: staging\n    require_approval: true\n');
    const r = runMlgHost(REPO, 'claude', gated, { key: 'Edit gated', tool: 'Edit', input: { file_path: 'logos/environments.yaml', old_string: 'a', new_string: 'b' } });
    expect(r.stdout).toContain('"permissionDecision":"ask"');
  }, TIMEOUT);

  it('UT-S09-472: Bash 事前判定（git 判据生效）', () => {
    const root = project('M-repo');
    for (const key of ['Bash echo > team/app.ts', 'Bash rm team/app.ts', 'Bash cp README team spec']) {
      expect(run('claude', root, key).exit, key).toBe(0);
    }
    const mixed = run('claude', root, 'Bash team && src');
    expect(mixed.exit).toBe(2);
    expect(mixed.stdout).toContain('检测到写入目标：src/main.ts');
    expect(mixed.stdout).not.toContain('检测到写入目标：team/c.ts');
    expect(run('claude', root, 'Bash echo > src/main.ts').exit).toBe(2);
    const item = MLG_INPUTS.find(i => i.key === 'Bash node -e team/b.ts')!;
    expect(runMlgHost(REPO, 'claude', root, item).exit).toBe(0);
    expect(readdirSync(join(root, 'logos/.openlogos-runtime/guard-records')).some(n => n.endsWith('.json')), '解析不出目标应拍快照').toBe(true);
    resetRuntime(root);
  }, TIMEOUT);

  it('UT-S09-473: 事后检查不报告 initial 归属变化', () => {
    const pending = (root: string) => {
      const f = join(root, 'logos/.openlogos-runtime/pending-reports.jsonl');
      return existsSync(f) ? readFileSync(f, 'utf-8').trim() : '';
    };
    // ① 只改 team：不报告
    const a = project('M-repo');
    let id = nextId();
    const cmd = 'node tools/x.js';
    expect(preToolUse(a, 'Bash', { command: cmd }, id).exitCode).toBe(0);
    writeFileSync(join(a, 'team/app.ts'), 'changed\n');
    writeFileSync(join(a, 'team/b.ts'), 'new\n');
    const r1 = postToolUse(a, cmd, id);
    expect(r1.exitCode, r1.stderr).toBe(0);
    expect(pending(a)).toBe('');
    // ② team 与 src 同改：只列 src/main.ts，恢复命令只针对 src/main.ts
    const b = project('M-repo');
    id = nextId();
    expect(preToolUse(b, 'Bash', { command: cmd }, id).exitCode).toBe(0);
    writeFileSync(join(b, 'team/app.ts'), 'changed\n');
    writeFileSync(join(b, 'src/main.ts'), 'changed\n');
    const r2 = postToolUse(b, cmd, id);
    expect(r2.exitCode).toBe(2);
    expect(r2.stderr).toContain('src/main.ts');
    expect(r2.stderr).not.toContain('team/app.ts');
    // ③ 跨模块文件照常报告
    const c = project('M-shared');
    id = nextId();
    expect(preToolUse(c, 'Bash', { command: cmd }, id).exitCode).toBe(0);
    writeFileSync(join(c, 'shared/protocol.ts'), 'changed\n');
    const r3 = postToolUse(c, cmd, id);
    expect(r3.exitCode).toBe(2);
    expect(r3.stderr).toContain('shared/protocol.ts');
    // ④ core 提案期拍快照、改 team 与 src、删 guard 后检查：只报告 src/main.ts
    const d = project('M-repo', 'delta-writing');
    id = nextId();
    expect(preToolUse(d, 'Bash', { command: cmd }, id).exitCode).toBe(0);
    writeFileSync(join(d, 'team/app.ts'), 'changed\n');
    writeFileSync(join(d, 'src/main.ts'), 'changed\n');
    rmSync(join(d, 'logos/.openlogos-guard'));
    const r4 = postToolUse(d, cmd, id);
    expect(r4.stderr).toContain('src/main.ts');
    expect(r4.stderr).not.toContain('team/app.ts');
  }, TIMEOUT);

  it('UT-S09-474: 非 git 回落逐路径同判', () => {
    const root = project('M-nogit');
    expect(run('claude', root, 'Edit team/app.ts').exit).toBe(0);
    expect(run('claude', root, 'Write src/main.ts').exit).toBe(2);
    expect(run('claude', root, 'Bash echo > team/app.ts').exit).toBe(0);
    // 回落阻断文案沿用修改前（逐字一致的回落回归锚），只断言阻断结论
    expect(run('claude', root, 'Bash team && src').exit).toBe(2);
    const want = base('claude', 'M-nogit', 'none', 'Bash rm $VAR');
    expect(run('claude', root, 'Bash rm $VAR')).toEqual({ exit: want.exit, stdout: want.stdout });
  }, TIMEOUT);

  it('UT-S09-475: 目录目标、yaml 异常与 lifecycle 非法', () => {
    const repo = project('M-repo');
    expect(run('claude', repo, 'Bash rm -rf team/src').exit, '① 目录下全部归 team').toBe(0);
    expect(run('claude', project('M-gitignore-team'), 'Bash rm -rf team').exit, '② 目录下含不可豁免项').toBe(2);
    expect(run('claude', repo, 'Bash rm -rf logos/resources/prd').exit, '③ 含 core 规格').toBe(2);
    const bad = project('M-badyaml');
    const want = base('claude', 'M-badyaml', 'none', 'Edit team/app.ts');
    expect(run('claude', bad, 'Edit team/app.ts'), '④ yaml 不可解析时不做按文件判定').toEqual({ exit: want.exit, stdout: want.stdout });
    for (const kind of ['M-lc-missing', 'M-lc-Initial', 'M-lc-draft'] as MlgKind[]) {
      expect(run('claude', project(kind), 'Edit team/app.ts').exit, `⑤ ${kind}`).toBe(2);
    }
    const ignored = project('M-ignored-spec');
    expect(run('claude', ignored, 'Bash rm -rf 1-product-requirements').exit, '⑥ 被忽略但受保护的 core 规格计入枚举').toBe(2);
    const direct = runMlgHost(REPO, 'claude', ignored, { key: 'Write private', tool: 'Write', input: { file_path: 'logos/resources/prd/1-product-requirements/core-02-private.md', content: 'x' } });
    expect(direct.exit, '⑥ 直接判定该 ignored core 规格').toBe(2);
    const build = project('M-build');
    expect(run('claude', build, 'Bash rm -rf team/build').exit, '⑦ 被忽略的产物').toBe(0);
    expect(run('claude', build, 'Bash rm -rf team').exit, '⑦ 被忽略产物不影响整目录').toBe(0);
    // ⑧ 候选采集失败（git ls-files -s 非零退出）：不豁免
    const wrap = join(tmp('openlogos-mlg-g-'), 'bin');
    mkdirSync(wrap, { recursive: true });
    const realGit = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf-8' }).stdout.trim();
    writeFileSync(join(wrap, 'git'), `#!/bin/bash\nfor a in "$@"; do [ "$a" = "-s" ] && { echo "fault" >&2; exit 128; }; done\nexec ${JSON.stringify(realGit)} "$@"\n`);
    chmodSync(join(wrap, 'git'), 0o755);
    const fail = project('M-repo');
    const r = spawnSync('bash', [join(REPO_ROOT, 'plugin/bin/guard-check')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf team/src' }, permission_mode: 'default' }),
      cwd: fail, encoding: 'utf-8', timeout: 60_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: fail, PATH: `${wrap}:${process.env.PATH}` }),
    });
    expect(r.status, '⑧ 枚举失败不豁免').toBe(2);
    // ⑨ code-r1 F2：core.excludesFile 位于 initial 目录内——直接写该文件与删除父目录都不获得模块豁免
    const ex = project('M-repo');
    writeFileSync(join(ex, 'team/ignore-rules'), '*.tmp\n');
    expect(spawnSync('git', ['config', 'core.excludesFile', 'team/ignore-rules'], { cwd: ex, env: cleanEnv() }).status).toBe(0);
    const exDirect = runMlgHost(REPO, 'claude', ex, { key: 'Write excludes', tool: 'Write', input: { file_path: 'team/ignore-rules', content: 'x' } });
    expect(exDirect.exit, '⑨ 直接写 core.excludesFile').toBe(2);
    resetRuntime(ex);
    expect(run('claude', ex, 'Bash rm -rf team').exit, '⑨ 删除含 core.excludesFile 的 initial 目录').toBe(2);
    const engine = load(JS_RUNTIMES.engine);
    const pctx = engine.makeProtectCtx(engine.gitContext(ex));
    expect(engine.protectVerdict(pctx, 'team/ignore-rules').step, '⑨ 引擎直接判定').toBe(3);
    expect(engine.protectVerdict(pctx, 'team').step, '⑨ 引擎目录判定不得为模块一步').not.toBe('M');
    expect(engine.protectVerdict(pctx, 'team/src').step, '⑨ 不含该文件的子目录照常豁免').toBe('M');
  }, TIMEOUT);

  it('UT-S09-476: 四个非 Claude 宿主运行时同判', () => {
    for (const host of ['cursor', 'qoder', 'workbuddy', 'zcode']) {
      const rt = load(JS_RUNTIMES[host]);
      for (const c of vector.cases) {
        const r = rt.mlgOwnership(rt.mlgLoadModel(vectorRoot(c.fixture)), c.path);
        expect(`${r.verdict} ${r.step}`, `${host} ${c.fixture} ${c.path}`).toBe(`${c.expect} ${c.step}`);
      }
    }
    const writes = ['Write team spec', 'Edit team/app.ts', 'MultiEdit S44 api', 'NotebookEdit team/n.ipynb', 'Write src/main.ts',
      'Write core spec', 'Write scripts/release.sh'];
    for (const kind of ['M-repo', 'M-shared', 'M-nopaths'] as MlgKind[]) {
      const root = project(kind);
      const keys = kind === 'M-shared' ? [...writes, 'Write shared/protocol.ts'] : writes;
      const claude = new Map(keys.map(k => [k, run('claude', root, k).exit]));
      for (const host of ['cursor', 'qoder', 'workbuddy', 'zcode'] as MlgHost[]) {
        for (const key of keys) {
          const item = MLG_INPUTS.find(i => i.key === key)!;
          expect(outcome(host, item, run(host, root, key)), `${host} ${kind} ${key}`).toBe(claude.get(key));
        }
      }
    }
    // 目录用例：Cursor beforeShellExecution（git 判据，经引擎）与 Claude 同判
    const dirCases: Array<[MlgKind, string]> = [['M-repo', 'Bash rm -rf team/src'], ['M-gitignore-team', 'Bash rm -rf team'],
      ['M-repo', 'Bash rm -rf logos/resources/prd'], ['M-ignored-spec', 'Bash rm -rf 1-product-requirements'],
      ['M-build', 'Bash rm -rf team/build'], ['M-build', 'Bash rm -rf team']];
    for (const [kind, key] of dirCases) {
      const root = project(kind);
      expect(run('cursor', root, key).exit, `cursor ${kind} ${key}`).toBe(run('claude', root, key).exit);
    }
    // Qoder / WorkBuddy / ZCode 不提取 shell 写入目标（Bash 仍按 fail-closed 阻断，行为不变）；
    // 其目录目标判定由同一代码块的 mlgInitialOwned 按非 git 枚举全部现存文件，结论与 Claude 相同
    const dirTargets: Array<[MlgKind, string, boolean]> = [['M-repo', 'team/src', true], ['M-gitignore-team', 'team', false],
      ['M-repo', 'logos/resources/prd', false], ['M-ignored-spec', 'logos/resources/prd/1-product-requirements', false],
      ['M-build', 'team/build', true], ['M-build', 'team', true]];
    for (const host of ['qoder', 'workbuddy', 'zcode']) {
      const rt = load(JS_RUNTIMES[host]);
      for (const [kind, rel, want] of dirTargets) {
        const root = project(kind);
        expect(rt.mlgInitialOwned(rt.mlgLoadModel(root), rel), `${host} ${kind} ${rel}`).toBe(want);
      }
    }
  }, TIMEOUT);

  it('UT-S09-477: 全 initial 与全 launched 项目零回归', () => {
    for (const kind of ['A-initial', 'A-launched'] as MlgKind[]) {
      for (const state of ['none', 'delta-writing'] as MlgState[]) {
        for (const host of MLG_HOSTS) {
          for (const [key, r] of runCombo(REPO, host, kind, state)) {
            const want = base(host, kind, state, key);
            expect(r, `${host} ${kind} ${state} ${key}`).toEqual({ exit: want.exit, stdout: want.stdout });
          }
        }
      }
    }
    // 引擎函数层：全 launched 夹具上 protectVerdict 不出现模块生命周期一步
    const engine = load(JS_RUNTIMES.engine);
    const root = project('A-launched');
    const pctx = engine.makeProtectCtx(engine.gitContext(root));
    for (const rel of ['team/app.ts', 'src/main.ts', 'logos/resources/prd/1-product-requirements/team-01-requirements.md']) {
      expect(engine.protectVerdict(pctx, rel).step, rel).not.toBe('M');
    }
    expect(ENGINE_SRC).toBe(join(REPO_ROOT, JS_RUNTIMES.engine));
  }, TIMEOUT);
});
