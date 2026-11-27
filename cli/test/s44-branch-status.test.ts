/**
 * branch-sync-generated-files 切片 1：openlogos branch status 与主分支确定（S44）。
 *
 * 覆盖 UT-S44-01、UT-S44-22、UT-S44-28（logos/resources/test/core-S44-test-cases.md）。
 * 规范源：spec/branch-sync.md §3、§4.8、§10；spec/cli-json-output.md「`openlogos branch sync|status --format json`」。
 * 一次性 git 仓库：main 上提交一个已初始化的 OpenLogos 项目作为共同起点，再分出 proposal/a；
 * 需要远端默认分支的用例以本地裸仓库充当 origin，不访问网络。全部经真实 CLI 进程执行。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { acquireLock, lockPath, releaseLock } from '../src/lib/baseline-seed-txn.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const REPO = resolve(HERE, '../..');
const SCHEMA_PATH = join(REPO, 'spec', 'logos.config.schema.json');
const SCHEMA_BASELINE = join(HERE, 'golden', 's44-config-schema-baseline.json');

let root: string;
let cleanup: () => void;
const extraCleanups: Array<() => void> = [];

function gitIn(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const git = (args: string[]): string => gitIn(root, args);

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function commit(message: string): string {
  git(['add', '-A']);
  git(['commit', '-q', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}

function setConfig(patch: Record<string, unknown>): void {
  const p = join(root, 'logos', 'logos.config.json');
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf-8')), ...patch }, null, 2));
}

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function statusJson(args: string[] = []): { status: number | null; data?: Record<string, any>; error?: Record<string, any>; stdout: string } {
  const r = cli(['branch', 'status', ...args, '--format', 'json']);
  if (r.status === 0) return { status: 0, data: JSON.parse(r.stdout).data, stdout: r.stdout };
  return { status: r.status, error: JSON.parse(r.stderr).error, stdout: r.stdout };
}

/** 项目全部文件（含 .git 之外的未跟踪文件）的相对路径 → SHA-256。 */
function snapshotFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (rel === '' && name === '.git') continue;
      const abs = join(dir, name);
      const r = rel === '' ? name : `${rel}/${name}`;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else out[r] = createHash('sha256').update(readFileSync(abs)).digest('hex');
    }
  };
  walk(root, '');
  return out;
}

/** main 上的共同起点提交 O，随后 main 再前进 mainExtra 个提交，proposal/a 从 O 分出并前进 propExtra 个提交。 */
function buildBranches(mainExtra: number, propExtra: number): { O: string; main: string; prop: string } {
  const O = git(['rev-parse', 'HEAD']);
  for (let i = 0; i < mainExtra; i++) { put(`main-${i}.txt`, `m${i}\n`); commit(`main ${i}`); }
  const main = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'proposal/a', O]);
  for (let i = 0; i < propExtra; i++) { put(`prop-${i}.txt`, `p${i}\n`); commit(`prop ${i}`); }
  return { O, main, prop: git(['rev-parse', 'HEAD']) };
}

/** 以本地裸仓库充当 origin，并让 refs/remotes/origin/HEAD 指向 origin/main。 */
function addOrigin(): void {
  const bare = makeTempRoot();
  extraCleanups.push(bare.cleanup);
  gitIn(bare.root, ['init', '-q', '--bare', '-b', 'main', '.']);
  git(['remote', 'add', 'origin', bare.root]);
  git(['push', '-q', 'origin', 'main']);
  git(['fetch', '-q', 'origin']);
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
}

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  git(['init', '-q', '-b', 'main', '.']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  scaffoldProject(root, { locale: 'en' });
  put('README.md', 'fixture\n');
  commit('init');
});

afterEach(() => {
  cleanup();
  while (extraCleanups.length > 0) extraCleanups.pop()!();
});

describe('S44 branch status 与主分支确定', () => {
  it('UT-S44-01: 主分支的确定顺序与解析失败', () => {
    // ① --base 优先于配置
    git(['branch', 'other']);
    setConfig({ branch_sync: { base_branch: 'other' } });
    commit('config other');
    const { main } = buildBranches(1, 1);
    const r1 = statusJson(['--base', 'main']);
    expect(r1.status).toBe(0);
    expect(r1.data!.base).toEqual({ ref: 'main', source: 'flag', commit: main });

    // ② 只配置 branch_sync.base_branch
    setConfig({ branch_sync: { base_branch: 'main' } });
    commit('config main');
    const r2 = statusJson();
    expect(r2.status).toBe(0);
    expect(r2.data!.base).toEqual({ ref: 'main', source: 'config', commit: main });

    // ③ 都不给，取远端 origin 的默认分支
    setConfig({ branch_sync: undefined });
    commit('no config');
    addOrigin();
    const r3 = statusJson();
    expect(r3.status).toBe(0);
    expect(r3.data!.base).toEqual({ ref: 'origin/main', source: 'remote-default', commit: main });

    // ⑤ 配置给出了解析不到的引用：直接报错，不回落到 origin/main
    setConfig({ branch_sync: { base_branch: 'nosuch' } });
    commit('config nosuch');
    const r5 = statusJson();
    expect(r5.status).toBe(1);
    expect(r5.stdout).toBe('');
    expect(r5.error!.code).toBe('BRANCH_BASE_UNRESOLVED');
    expect(r5.error!.message).toContain('nosuch');

    // --base 出现但缺值同样不回落
    const r5b = statusJson(['--base']);
    expect(r5b.status).toBe(1);
    expect(r5b.error!.code).toBe('BRANCH_BASE_UNRESOLVED');
  });

  it('UT-S44-01: 三个来源都没有时报 BRANCH_BASE_UNRESOLVED；无共同起点与非 git 目录各有错误码', () => {
    // ④ 都不给且没有远端
    buildBranches(1, 1);
    const r4 = statusJson();
    expect(r4.status).toBe(1);
    expect(r4.error!.code).toBe('BRANCH_BASE_UNRESOLVED');
    expect(r4.error!.message).toContain('--base');

    // 没有共同起点（孤儿分支）
    git(['checkout', '-q', '--orphan', 'lonely']);
    commit('orphan');
    const orphan = statusJson(['--base', 'main']);
    expect(orphan.status).toBe(1);
    expect(orphan.error!.code).toBe('BRANCH_NO_MERGE_BASE');

    // 文本模式的错误形态
    const text = cli(['branch', 'status']);
    expect(text.status).toBe(1);
    expect(text.stdout).toBe('');
    expect(text.stderr).toMatch(/^Error: \[BRANCH_BASE_UNRESOLVED\] /);

    // 不在 git 仓库内
    const plain = makeTempRoot();
    extraCleanups.push(plain.cleanup);
    scaffoldProject(plain.root, { locale: 'en' });
    const r = spawnSync(process.execPath, [CLI, 'branch', 'status', '--format', 'json'], {
      cwd: plain.root, encoding: 'utf-8', env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(plain.root) },
    });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stderr).error.code).toBe('BRANCH_NOT_GIT_REPO');

    // 未初始化的目录
    const bare = makeTempRoot();
    extraCleanups.push(bare.cleanup);
    const r0 = spawnSync(process.execPath, [CLI, 'branch', 'status', '--format', 'json'], { cwd: bare.root, encoding: 'utf-8' });
    expect(r0.status).toBe(1);
    expect(JSON.parse(r0.stderr).error.code).toBe('PROJECT_NOT_INITIALIZED');
  });

  it('UT-S44-22: branch status 只读——落后 / 领先计数正确，未提交改动与锁被占用都不导致拒绝，不改任何文件', () => {
    const { O, main, prop } = buildBranches(3, 5);
    // 工作区有未提交改动；core 的事务锁被占用
    writeFileSync(join(root, 'README.md'), 'dirty\n');
    expect(acquireLock(root, 'core')).toBe(true);
    try {
      expect(existsSync(lockPath(root, 'core'))).toBe(true);
      const before = snapshotFiles();
      const indexBefore = git(['ls-files', '-s']);
      const refsBefore = git(['for-each-ref']);

      const r = statusJson(['--base', 'main']);
      expect(r.status).toBe(0);
      const env = JSON.parse(r.stdout);
      expect(env.command).toBe('branch status');
      expect(r.data).toEqual({
        branch: 'proposal/a',
        head: prop,
        base: { ref: 'main', source: 'flag', commit: main },
        merge_base: O,
        behind: 3,
        ahead: 5,
        up_to_date: false,
      });
      expect(r.data!.merge_base).toBe(git(['merge-base', 'HEAD', 'main']));

      // 文本模式（en）
      const text = cli(['branch', 'status', '--base', 'main']);
      expect(text.status).toBe(0);
      expect(text.stdout).toContain(`Current branch: proposal/a (${prop.slice(0, 8)})`);
      expect(text.stdout).toContain(`Base branch: main (${main.slice(0, 8)}, source: --base)`);
      expect(text.stdout).toContain(`Merge base: ${O.slice(0, 8)}`);
      expect(text.stdout).toContain('Behind by 3 commits, ahead by 5 commits.');
      expect(text.stdout).toContain('openlogos branch sync');

      // 执行前后项目全部文件、索引与分支指向一致；没有新建锁文件
      expect(snapshotFiles()).toEqual(before);
      expect(git(['ls-files', '-s'])).toBe(indexBefore);
      expect(git(['for-each-ref'])).toBe(refsBefore);
    } finally {
      releaseLock(root, 'core');
    }

    // 没有锁时也不创建锁文件与运行目录
    git(['checkout', '-q', '--', 'README.md']);
    const clean = snapshotFiles();
    expect(statusJson(['--base', 'main']).status).toBe(0);
    expect(snapshotFiles()).toEqual(clean);
    expect(existsSync(lockPath(root, 'core'))).toBe(false);
  });

  it('UT-S44-22: HEAD 分离时 branch 为 null；已包含主分支时 up_to_date；zh 文案跟随 locale', () => {
    const { main, prop } = buildBranches(2, 1);
    git(['checkout', '-q', '--detach', prop]);
    const detached = statusJson(['--base', 'main']);
    expect(detached.status).toBe(0);
    expect(detached.data!.branch).toBeNull();
    expect(detached.data!.head).toBe(prop);
    expect(detached.data!.behind).toBe(2);
    expect(cli(['branch', 'status', '--base', 'main']).stdout).toContain('(detached HEAD)');

    // 本分支与 main 指向同一提交：behind=0
    git(['checkout', '-q', 'main']);
    const same = statusJson(['--base', 'main']);
    expect(same.data).toMatchObject({ branch: 'main', head: main, behind: 0, ahead: 0, up_to_date: true });

    // zh
    setConfig({ locale: 'zh' });
    const zh = cli(['branch', 'status', '--base', 'main']);
    expect(zh.status).toBe(0);
    expect(zh.stdout).toContain('当前分支：main');
    expect(zh.stdout).toContain('来源：--base');
    expect(zh.stdout).toContain('已包含 main 的最新提交。');
    const zhErr = cli(['branch', 'status', '--base', 'nosuch']);
    expect(zhErr.status).toBe(1);
    expect(zhErr.stderr).toMatch(/^Error: \[BRANCH_BASE_UNRESOLVED\] 主分支引用 "nosuch"（来源：--base）解析不到提交。/);

    // 未知子命令
    const unknown = cli(['branch', 'nope']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Usage: openlogos branch');
  });

  it('UT-S44-28: 配置 Schema 含合法的 branch_sync 定义，其余部分与基线逐项相等', async () => {
    const raw = readFileSync(SCHEMA_PATH, 'utf-8');
    // 严格解析：文件末尾没有多余内容
    const schema = JSON.parse(raw) as Record<string, any>;
    const baseline = JSON.parse(readFileSync(SCHEMA_BASELINE, 'utf-8')) as Record<string, any>;

    const bs = schema.properties.branch_sync;
    expect(bs).toBeDefined();
    expect(bs.type).toBe('object');
    expect(bs.additionalProperties).toBe(false);
    expect(Object.keys(bs.properties).sort()).toEqual(['base_branch', 'replace_paths']);
    expect(bs.properties.base_branch).toMatchObject({ type: 'string', minLength: 1 });
    expect(bs.properties.replace_paths).toMatchObject({ type: 'array', uniqueItems: true, default: [] });
    expect(bs.properties.replace_paths.items).toMatchObject({ type: 'string' });

    // required / definitions / examples 与 properties 中的其他属性同基线逐项相等
    expect(baseline.properties.branch_sync).toBeUndefined();
    expect(schema.required).toEqual(baseline.required);
    // verify-self-sufficient-cases：新增 VerifyRequirements 定义（verify.requirements 引用），属该提案的增量，比较前剔除
    const { VerifyRequirements: _req, ...restDefinitions } = schema.definitions;
    expect(restDefinitions).toEqual(baseline.definitions);
    expect(schema.examples).toEqual(baseline.examples);
    const { branch_sync: _added, ...restProps } = schema.properties;
    // verification-history：verify 节新增 history（raw_in_proposal），属该提案的增量，比较前剔除
    if (restProps.verify?.properties?.history) {
      restProps.verify = { ...restProps.verify, properties: { ...restProps.verify.properties } };
      delete restProps.verify.properties.history;
    }
    // verify-self-sufficient-cases：verify 节与 verify.modules.<id> 新增 requirements，属该提案的增量，比较前剔除
    if (restProps.verify?.properties?.requirements) {
      restProps.verify = { ...restProps.verify, properties: { ...restProps.verify.properties } };
      delete restProps.verify.properties.requirements;
      const mod = restProps.verify.properties.modules;
      if (mod?.additionalProperties?.properties?.requirements) {
        const { requirements: _mr, ...modProps } = mod.additionalProperties.properties;
        restProps.verify.properties.modules = { ...mod, additionalProperties: { ...mod.additionalProperties, properties: modProps } };
      }
    }
    expect(restProps).toEqual(baseline.properties);
    const { properties: _p1, definitions: _d1, ...restTop } = schema;
    const { properties: _p2, definitions: _d2, ...baselineTop } = baseline;
    expect(restTop).toEqual(baselineTop); // definitions 已在上方剔除本提案增量后逐项比对

    // 用 Schema 校验配置样例
    const { default: Ajv } = await import('ajv');
    const ajv = new Ajv({ strict: false, allowUnionTypes: true });
    const validate = ajv.compile(schema);
    const base = { name: 'x', documents: {} };
    expect(validate({ ...base, branch_sync: { base_branch: 'main', replace_paths: ['logos/resources/verify/run-log.jsonl'] } })).toBe(true);
    expect(validate({ ...base, branch_sync: { unknown: 1 } })).toBe(false);
    expect(validate({ ...base, branch_sync: { replace_paths: 'x' } })).toBe(false);
    expect(validate({ ...base, branch_sync: { base_branch: '' } })).toBe(false);
    // 没有 branch_sync 的既有样例照旧通过
    for (const example of schema.examples as unknown[]) expect(validate(example)).toBe(true);
    expect(validate(base)).toBe(true);
  });
});
