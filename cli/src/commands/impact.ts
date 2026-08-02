/**
 * openlogos impact —— S36 生命周期变更影响分类（ci-change-impact-contract）。
 *
 * 只读命令（项目内外零写入红线）：全程不写任何项目文件 / marker / guard，
 * 也不得因参数值产生项目外任何文件系统写入；非人类确认点，任何角色任何阶段可跑。
 *
 * 双输入模式（同一（字节流, 前缀）输入逐字段结论一致，共用 lib/impact-classify 唯一判据）：
 * - `--base <rev> --head <rev>`：CLI 内部安全取流。修订参数安全三层防线，任何实现不得绕过：
 *   ① 词法拒 option-like（空值 / `-` 开头 → IMPACT_INPUT_INVALID，不传给任何 git 进程）；
 *   ② `git rev-parse --verify --end-of-options <rev>^{commit}` 隔离解析为完整十六进制 OID；
 *   ③ `git diff --no-relative --name-status -z <base_oid> <head_oid>` 位置参数只收规范化 OID，
 *      显式 `--no-relative` 中和仓库/用户 `diff.relative=true` 配置（top-level 坐标不变量守卫）。
 * - `--stdin [--prefix <dir/>]`：消费管道字节流，完全不依赖 git；`--prefix` 仅本模式合法。
 *
 * exit code：0 = 判定完成（lifecycle_only 真假皆 0，退出码不编码结论）；非零 = 操作错误
 * （IMPACT_GIT_DIFF_FAILED / IMPACT_INPUT_INVALID）。契约见 spec/change-impact.md 与
 * spec/cli-json-output.md §3.16。
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeEnvelope, makeErrorEnvelope, type OutputFormat } from '../lib/json-output.js';
import { readLocale, t, type Locale } from '../i18n.js';
import {
  classifyImpact, isRevArgLexicallyValid, isValidPrefixArg, IMPACT_SCHEMA_VERSION, type ImpactResult,
} from '../lib/impact-classify.js';

const COMMAND = 'impact';

export type ImpactErrorCode = 'IMPACT_GIT_DIFF_FAILED' | 'IMPACT_INPUT_INVALID';

function opError(format: OutputFormat, code: ImpactErrorCode, message: string): never {
  if (format === 'json') {
    console.error(JSON.stringify(makeErrorEnvelope(COMMAND, code, message)));
  } else {
    console.error(`Error [${code}]: ${message}`);
  }
  process.exit(1);
  throw new Error('unreachable'); // process.exit 被测试 mock 成 throw 时的类型收口
}

interface ImpactArgs {
  stdin: boolean;
  base?: string;
  head?: string;
  prefix?: string;
}

function parseImpactArgs(args: string[]): ImpactArgs {
  const parsed: ImpactArgs = { stdin: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--stdin') {
      parsed.stdin = true;
    } else if (a === '--base') {
      parsed.base = args[++i] ?? '';
    } else if (a === '--head') {
      parsed.head = args[++i] ?? '';
    } else if (a === '--prefix') {
      parsed.prefix = args[++i] ?? '';
    } else if (a === '--format') {
      i++; // 值已由全局 parseFormat 消费
    }
  }
  return parsed;
}

/**
 * git 只读取流。显式 maxBuffer（256 MiB，spec/change-impact.md §5 取流缓冲上限）：
 * execFileSync 默认缓冲约 1 MiB，会把合法大变更集（数千文件的 name-status 流）以
 * ENOBUFS 杀死并误报 IMPACT_GIT_DIFF_FAILED；超出显式上限仍 fail-closed 报错，不误判 true。
 */
const GIT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

function gitReadOnly(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GIT_MAX_BUFFER_BYTES,
  });
}

const OID_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

/** 三层防线第二层：修订解析隔离，失败抛出（调用方映射 IMPACT_GIT_DIFF_FAILED）。 */
function resolveCommitOid(cwd: string, rev: string): string {
  const out = gitReadOnly(cwd, ['rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`]).trim();
  if (!OID_RE.test(out)) {
    throw new Error(`rev-parse produced non-OID output for ${JSON.stringify(rev)}`);
  }
  return out;
}

export function impact(args: string[], format: OutputFormat = 'text'): void {
  const cwd = process.cwd();
  const locale = readLocale(cwd);
  const opts = parseImpactArgs(args);

  // 参数组合校验：--stdin 与 --base/--head 互斥；两组皆缺、只给其一、--prefix 用于非 stdin 模式均非法
  if (opts.stdin && (opts.base !== undefined || opts.head !== undefined)) {
    opError(format, 'IMPACT_INPUT_INVALID', '--stdin and --base/--head are mutually exclusive');
  }
  if (!opts.stdin && opts.base === undefined && opts.head === undefined) {
    opError(format, 'IMPACT_INPUT_INVALID', 'missing input mode: pass --base <rev> --head <rev>, or --stdin');
  }
  if (!opts.stdin && (opts.base === undefined || opts.head === undefined)) {
    opError(format, 'IMPACT_INPUT_INVALID', '--base and --head must be provided together');
  }
  if (!opts.stdin && opts.prefix !== undefined) {
    opError(format, 'IMPACT_INPUT_INVALID', '--prefix is only valid in --stdin mode');
  }
  // --prefix 段级不变量：非空须为合法 git top-level 相对目录前缀（拒绝绝对路径、空段、`.`/`..` 段）
  if (opts.prefix !== undefined && !isValidPrefixArg(opts.prefix)) {
    opError(format, 'IMPACT_INPUT_INVALID', `--prefix is not a valid top-level relative directory prefix: ${JSON.stringify(opts.prefix)}`);
  }

  let stream: string;
  let prefix: string;

  if (opts.stdin) {
    prefix = opts.prefix ?? '';
    try {
      stream = readFileSync(0, 'utf-8');
    } catch (e) {
      opError(format, 'IMPACT_INPUT_INVALID', `failed to read stdin: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    // 三层防线第一层：词法拒 option-like，值不传给任何 git 进程
    if (!isRevArgLexicallyValid(opts.base)) {
      opError(format, 'IMPACT_INPUT_INVALID', `--base value is empty or option-like: ${JSON.stringify(opts.base)}`);
    }
    if (!isRevArgLexicallyValid(opts.head)) {
      opError(format, 'IMPACT_INPUT_INVALID', `--head value is empty or option-like: ${JSON.stringify(opts.head)}`);
    }
    let baseOid: string;
    let headOid: string;
    try {
      baseOid = resolveCommitOid(cwd, opts.base!);
      headOid = resolveCommitOid(cwd, opts.head!);
    } catch (e) {
      opError(format, 'IMPACT_GIT_DIFF_FAILED', `cannot resolve revision (git unavailable, not a git repository, or unknown rev): ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
    try {
      prefix = gitReadOnly(cwd, ['rev-parse', '--show-prefix']).trim();
    } catch (e) {
      opError(format, 'IMPACT_GIT_DIFF_FAILED', `git rev-parse --show-prefix failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
    try {
      // 三层防线第三层：位置参数只收规范化 OID；显式 --no-relative 中和 diff.relative 配置
      stream = gitReadOnly(cwd, ['diff', '--no-relative', '--name-status', '-z', baseOid, headOid]);
    } catch (e) {
      opError(format, 'IMPACT_GIT_DIFF_FAILED', `git diff failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }

  const result = classifyImpact(stream, prefix);

  if (format === 'json') {
    // data 递归键集合恰为 §3.16 契约声明键（全 snake_case）——显式字面量映射，防内部类型键泄漏
    const data = {
      schema_version: IMPACT_SCHEMA_VERSION,
      lifecycle_only: result.lifecycle_only,
      files: result.files.map(f => ({
        status: f.status,
        path: f.path,
        old_path: f.old_path,
        class: f.class,
      })),
      non_lifecycle_paths: result.non_lifecycle_paths,
      operations: result.operations,
      changes: result.changes,
      reasons: result.reasons,
    };
    console.log(JSON.stringify(makeEnvelope(COMMAND, data)));
    return;
  }

  printText(locale, result);
}

function printText(locale: Locale, result: ImpactResult): void {
  console.log(t(locale, 'impact.header', { value: String(result.lifecycle_only) }));
  if (result.files.length > 0) {
    console.log(t(locale, 'impact.filesHeader', { count: String(result.files.length) }));
    for (const f of result.files) {
      const pathLabel = f.old_path !== null ? `${f.old_path} -> ${f.path}` : f.path;
      console.log(`  ${f.status}  ${f.class.padEnd(9)}  ${pathLabel}`);
    }
  }
  if (result.non_lifecycle_paths.length > 0) {
    console.log(t(locale, 'impact.nonLifecycleHeader', { count: String(result.non_lifecycle_paths.length) }));
    for (const p of result.non_lifecycle_paths) {
      console.log(`  - ${p}`);
    }
  }
  if (result.operations.length > 0) {
    console.log(t(locale, 'impact.operationsLine', { ops: result.operations.join(', ') }));
  }
  if (result.changes.length > 0) {
    console.log(t(locale, 'impact.changesLine', { changes: result.changes.join(', ') }));
  }
  if (result.reasons.length > 0) {
    console.log(t(locale, 'impact.reasonsHeader'));
    for (const r of result.reasons) {
      console.log(`  - ${r}`);
    }
  }
  console.log(t(locale, result.lifecycle_only ? 'impact.footerTrue' : 'impact.footerFalse'));
}
