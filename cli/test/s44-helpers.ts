/**
 * S44（提案分支同步主分支）测试夹具：一次性 git 仓库。
 *
 * main 上提交一个已初始化的 OpenLogos 项目作为共同起点 O（验收报告、测试结果账本与登记表均被跟踪），
 * 再分出 proposal/a，两条分支各自提交改动。不配置远端，以 `--base main` 指定主分支。
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempRoot, scaffoldProject } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CLI = resolve(HERE, '../dist/index.js');
export const VERIFY = 'logos/resources/verify';
export const REPORT = `${VERIFY}/acceptance-report.md`;
export const LEDGER = `${VERIFY}/test-results.jsonl`;
export const REGISTRY = 'logos/logos-project.yaml';
export const CONFIG = 'logos/logos.config.json';

export interface CliResult { status: number | null; stdout: string; stderr: string }
export interface SyncResult extends CliResult { data?: Record<string, any>; error?: Record<string, any>; envelope?: Record<string, any> }

const cleanups: Array<() => void> = [];
/** afterEach 中调用：删除本用例创建的全部一次性仓库。 */
export function cleanupFixtures(): void {
  while (cleanups.length > 0) cleanups.pop()!();
}

export class Fixture {
  readonly root: string;

  constructor(opts: { locale?: 'en' | 'zh'; init?: boolean; registry?: string; config?: Record<string, unknown> } = {}) {
    const tmp = makeTempRoot();
    // 取真实路径：CLI 子进程的 cwd 是解析过符号链接的路径，夹具里写进文件的绝对路径要与之一致
    this.root = realpathSync(tmp.root);
    cleanups.push(tmp.cleanup);
    if (opts.init === false) return;
    this.git(['init', '-q', '-b', 'main', '.']);
    this.git(['config', 'user.email', 'test@example.com']);
    this.git(['config', 'user.name', 'Test']);
    this.git(['config', 'commit.gpgsign', 'false']);
    scaffoldProject(this.root, { locale: opts.locale ?? 'en' });
    if (opts.config) this.setConfig(opts.config);
    if (opts.registry !== undefined) this.put(REGISTRY, opts.registry);
    this.put(REPORT, '# Acceptance Report\n\nO\n');
    this.put(LEDGER, '{"id":"UT-O-01","status":"pass"}\n');
    this.commit('O');
  }

  git(args: string[], env?: NodeJS.ProcessEnv): string {
    const r = spawnSync('git', args, { cwd: this.root, encoding: 'utf-8', env: env ? { ...process.env, ...env } : process.env });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
    return r.stdout.trim();
  }

  /** 允许失败的 git 调用（用于构造冲突、进行中的操作）。 */
  tryGit(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync('git', args, { cwd: this.root, encoding: 'utf-8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  put(rel: string, content: string): void {
    mkdirSync(dirname(join(this.root, rel)), { recursive: true });
    writeFileSync(join(this.root, rel), content);
  }

  read(rel: string): string { return readFileSync(join(this.root, rel), 'utf-8'); }
  exists(rel: string): boolean { return existsSync(join(this.root, rel)); }
  remove(rel: string): void { rmSync(join(this.root, rel), { recursive: true, force: true }); }

  commit(message: string): string {
    this.git(['add', '-A']);
    this.git(['commit', '-q', '--allow-empty', '-m', message]);
    return this.head();
  }

  head(): string { return this.git(['rev-parse', 'HEAD']); }
  show(ref: string, rel: string): string { return this.git(['show', `${ref}:${rel}`]) + '\n'; }

  /** 提交中该文件的原始 blob 字节（不经换行与过滤转换）。 */
  blob(ref: string, rel: string): Buffer {
    const r = spawnSync('git', ['cat-file', 'blob', `${ref}:${rel}`], { cwd: this.root });
    if (r.status !== 0) throw new Error(`git cat-file ${ref}:${rel}: ${String(r.stderr)}`);
    return r.stdout;
  }

  /** 工作区文件的原始字节。 */
  bytes(rel: string): Buffer { return readFileSync(join(this.root, rel)); }

  setConfig(patch: Record<string, unknown>): void {
    const current = JSON.parse(this.read(CONFIG)) as Record<string, unknown>;
    writeFileSync(join(this.root, CONFIG), JSON.stringify({ ...current, ...patch }, null, 2));
  }

  /** 从当前提交（O）分出 proposal/a 并各自提交一次；结束时停在 proposal/a。 */
  diverge(prop: (fx: Fixture) => void, main: (fx: Fixture) => void): { O: string; main: string; prop: string } {
    const O = this.head();
    this.git(['checkout', '-q', '-b', 'proposal/a']);
    prop(this);
    const propHead = this.commit('A');
    this.git(['checkout', '-q', 'main']);
    main(this);
    const mainHead = this.commit('B');
    this.git(['checkout', '-q', 'proposal/a']);
    return { O, main: mainHead, prop: propHead };
  }

  cli(args: string[]): CliResult {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: this.root, encoding: 'utf-8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  /** `branch sync --base main --format json`，解析 stdout 的 success envelope 或 stderr 的 error envelope。 */
  sync(extra: string[] = ['--base', 'main']): SyncResult {
    const r = this.cli(['branch', 'sync', ...extra, '--format', 'json']);
    if (r.status === 0 || r.status === 2) {
      const envelope = JSON.parse(r.stdout) as Record<string, any>;
      return { ...r, envelope, data: envelope.data };
    }
    let error: Record<string, any> | undefined;
    try { error = (JSON.parse(r.stderr) as Record<string, any>).error; } catch { /* 非 envelope 的崩溃输出由调用方断言 */ }
    return { ...r, error };
  }

  /** 项目全部文件（不含 .git，含未跟踪与被忽略的文件）：相对路径 → SHA-256。 */
  files(): Record<string, string> {
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
    walk(this.root, '');
    return out;
  }

  /** 「零改动」取证：全部文件、git 索引、各分支指向与 HEAD。 */
  state(): { files: Record<string, string>; index: string; refs: string; head: string; merging: boolean } {
    return {
      files: this.files(),
      index: this.git(['ls-files', '-s']),
      refs: this.git(['for-each-ref']),
      head: this.head(),
      merging: this.merging(),
    };
  }

  merging(): boolean { return existsSync(join(this.root, '.git', 'MERGE_HEAD')); }

  /**
   * 同一构造下纯 `git merge --no-commit` 之后某个文件的字节（「未写回」取证）：
   * 在仓库副本中执行，不影响本仓库。
   */
  plainMergeBytes(rel: string): string | null {
    const copy = makeTempRoot();
    cleanups.push(copy.cleanup);
    cpSync(this.root, copy.root, { recursive: true });
    // 与 CLI 相同：按主分支的提交哈希合并（冲突标记里的标签因此一致）
    spawnSync('git', ['merge', '--no-ff', '--no-commit', this.git(['rev-parse', 'main'])], { cwd: copy.root, encoding: 'utf-8' });
    const p = join(copy.root, rel);
    return existsSync(p) ? readFileSync(p, 'utf-8') : null;
  }
}

/** 登记表文本：以给定的若干顶层片段拼出，末尾带换行。 */
export function registryText(parts: string[]): string {
  return parts.join('\n') + '\n';
}
