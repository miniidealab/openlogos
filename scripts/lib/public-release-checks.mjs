/**
 * 公开发布 smoke（scripts/smoke-public-release-0-16-0.js，SMOKE-core-232）的安装态判据，抽成纯函数以便回归测试。
 *
 * - 隔离 prefix 的**真实命令入口**：Unix 为 `<prefix>/bin/openlogos`（指向包内入口的链接，须可执行）；
 *   Windows 为 npm 生成的 `<prefix>/openlogos.cmd` shim（文件本身不在包目录内，按 shim 内容核对其指向）。
 *   所有命令都经该入口执行，不得绕过入口直接 `node <包>/dist/index.js`（code 评审 r1 F1）。
 * - `status --format json` 的成功判据：子进程正常退出（无启动错误、无信号、退出码 0），stdout 为成功 envelope
 *   （command=status、version=V、合法 timestamp、data 为对象、不含 error）（code 评审 r1 F2）。
 */
import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

const PKG_SCOPE = '@miniidealab';
const PKG_NAME = 'openlogos';

const within = (dir, path) => {
  const rel = relative(dir, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/** 隔离 prefix 下的安装布局：入口位置与包目录（npm folders 约定：Unix 用 prefix/bin 与 prefix/lib/node_modules）。 */
export function installedLayout(prefix, platform = process.platform) {
  if (platform === 'win32') {
    return {
      kind: 'win-shim',
      entry: join(prefix, `${PKG_NAME}.cmd`),
      pkgDir: join(prefix, 'node_modules', PKG_SCOPE, PKG_NAME),
    };
  }
  return {
    kind: 'unix',
    entry: join(prefix, 'bin', PKG_NAME),
    pkgDir: join(prefix, 'lib', 'node_modules', PKG_SCOPE, PKG_NAME),
  };
}

/**
 * 入口身份与可执行性核对，返回问题列表（空即通过）。
 * - unix：入口存在、realpath 落在包目录内、对当前用户可执行；包目录本身不得是链接（workspace link 不构成安装态证据）。
 * - win-shim：shim 存在且内容指向 `%dp0%\node_modules\@miniidealab\openlogos\dist\index.js`，该目标文件在包目录内存在。
 */
export function entryIdentityProblems(layout) {
  const problems = [];
  const { kind, entry, pkgDir } = layout;
  if (!existsSync(pkgDir)) return [`包目录不存在：${pkgDir}`];
  if (lstatSync(pkgDir).isSymbolicLink()) problems.push(`包目录是链接：${pkgDir}`);
  if (!existsSync(entry)) return [...problems, `入口不存在：${entry}`];
  if (kind === 'unix') {
    const target = realpathSync(entry);
    if (!within(realpathSync(pkgDir), target)) problems.push(`入口 ${entry} 解析到 ${target}，不在隔离安装包目录内`);
    try { accessSync(entry, constants.X_OK); } catch { problems.push(`入口不可执行：${entry}`); }
    return problems;
  }
  const text = readFileSync(entry, 'utf8').replace(/\//g, '\\');
  const expected = `%dp0%\\node_modules\\${PKG_SCOPE}\\${PKG_NAME}\\dist\\index.js`;
  if (!text.toLowerCase().includes(expected.toLowerCase())) problems.push(`shim ${entry} 未指向 ${expected}`);
  if (!existsSync(join(pkgDir, 'dist', 'index.js'))) problems.push(`shim 目标不存在：${join(pkgDir, 'dist', 'index.js')}`);
  return problems;
}

/** 经真实入口执行的命令形态：Unix 直接执行入口；Windows 经 cmd.exe 执行 shim（绝对路径，不做 PATH 查找）。 */
export function entryCommand(layout, args) {
  if (layout.kind === 'win-shim') {
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', layout.entry, ...args] };
  }
  return { command: layout.entry, args };
}

/** 子进程结果的统一失败描述：启动错误、信号终止或非零退出。 */
export function processProblem(result, label) {
  if (result.error) return `${label} 启动失败：${result.error.message ?? String(result.error)}`;
  if (result.signal) return `${label} 被信号 ${result.signal} 终止`;
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim().slice(-300);
    return `${label} 退出码 ${result.status}${stderr ? `：${stderr}` : ''}`;
  }
  return null;
}

/** ISO-8601 日期时间（envelope.timestamp 合同，spec/cli-json-output.md）：语法匹配且为有效日期。 */
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
export function isIso8601(value) {
  if (typeof value !== 'string' || !ISO_8601_RE.test(value)) return false;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && !Number.isNaN(Date.parse(value));
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** `status --format json` 的成功判据，返回问题列表（空即通过）。 */
export function statusEnvelopeProblems(result, version) {
  const failed = processProblem(result, 'status --format json');
  if (failed) return [failed];
  let envelope;
  try { envelope = JSON.parse(String(result.stdout || '')); } catch {
    return [`status 输出不是合法 JSON：${String(result.stdout || '').trim().slice(0, 200)}`];
  }
  if (!isPlainObject(envelope)) return ['status 输出不是 JSON 对象'];
  const problems = [];
  if (envelope.command !== 'status') problems.push(`envelope.command=${JSON.stringify(envelope.command)}，应为 "status"`);
  if (envelope.version !== version) problems.push(`envelope.version=${JSON.stringify(envelope.version)}，应为 ${version}`);
  // Date.parse 接受 "1" 这类非 ISO 文本，故先按 ISO-8601 语法判定再校验日期有效（code 评审 r2 F2）
  if (!isIso8601(envelope.timestamp)) problems.push(`envelope.timestamp=${JSON.stringify(envelope.timestamp)} 不是 ISO-8601 时间`);
  if ('error' in envelope) problems.push(`envelope 含 error：${JSON.stringify(envelope.error).slice(0, 200)}`);
  // status data 为 JSON object（spec/schema/status.schema.json），数组同样满足 typeof object，须显式排除（code 评审 r2 F2）
  if (!isPlainObject(envelope.data)) problems.push(`envelope.data 缺失或不是 JSON 对象（${Array.isArray(envelope.data) ? '数组' : typeof envelope.data}）`);
  return problems;
}
