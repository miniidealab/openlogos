/**
 * r4 F12：dist 构建的唯一入口——Vitest 在任何 worker 启动**之前**串行构建一次。
 * 需要真实进程边界的测试（S35 真实 CLI ST、S32 并发 marker 竞态）只读既有 dist；
 * 禁止任何测试文件在 worker 内再跑 tsc / npm run build——多 worker 并发编译同一
 * outDir 会互相改写 dist，子进程可能加载到半成品模块（曾致全量偶发红）。
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REUSE_PREFIX = 'openlogos-cli-sandbox-reuse-';

/**
 * verify-sandbox-reuse-0-16-1：沙箱默认复用后，未显式指定 sandbox_root 的既有夹具会在默认沙箱根下
 * 留下持久项目目录。收尾时只删除本次测试运行期间创建、且其记录的项目根位于临时目录下并已不存在的目录。
 */
function cleanupOrphanReuseDirs(startedAt: number): void {
  const tmpRoots = new Set<string>();
  for (const p of [tmpdir(), '/private/tmp']) {
    try { tmpRoots.add(realpathSync(p)); } catch { /* 不存在 */ }
  }
  for (const base of tmpRoots) {
    let names: string[] = [];
    try { names = readdirSync(base); } catch { continue; }
    for (const name of names) {
      if (!name.startsWith(REUSE_PREFIX)) continue;
      const dir = join(base, name);
      try {
        if (statSync(dir).birthtimeMs < startedAt) continue;
        const meta = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as { project_root?: string };
        const projectRoot = meta.project_root ?? '';
        const underTmp = [...tmpRoots].some(t => projectRoot.startsWith(`${t}${sep}`));
        if (!underTmp || existsSync(projectRoot)) continue;
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // 无元数据或读取失败：不是本次夹具留下的目录，保留
      }
    }
  }
}

export default function globalSetup(): () => void {
  const startedAt = Date.now();
  const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync(process.execPath, [join(cliRoot, 'node_modules', 'typescript', 'bin', 'tsc')], { cwd: cliRoot });
  // 与 `npm run build` 一致：tsc 不保留入口的可执行位。干净构建下缺执行位时，经 PATH 链接到 dist 入口的
  // 测试会被 `command -v` 跳过而落到本机全局 openlogos（release-0-16-0 干净克隆实证）。
  chmodSync(join(cliRoot, 'dist', 'index.js'), 0o755);
  // 预热仓库 git 索引：在一次性沙箱副本（全量复制、mtime 被重置）里首次 `git status` 需重建索引统计信息，
  // 实测约 50 秒且几乎全为 I/O；在任何用例计时开始前付清，避免读仓库 git 状态的用例被默认时限误杀。
  try {
    execFileSync('git', ['status', '--porcelain'], { cwd: join(cliRoot, '..'), stdio: 'ignore', timeout: 600_000 });
  } catch {
    // 非 git 工作区或 git 不可用：读仓库状态的用例自行处理
  }
  return () => cleanupOrphanReuseDirs(startedAt);
}
