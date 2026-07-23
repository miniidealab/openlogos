/**
 * r4 F12：dist 构建的唯一入口——Vitest 在任何 worker 启动**之前**串行构建一次。
 * 需要真实进程边界的测试（S35 真实 CLI ST、S32 并发 marker 竞态）只读既有 dist；
 * 禁止任何测试文件在 worker 内再跑 tsc / npm run build——多 worker 并发编译同一
 * outDir 会互相改写 dist，子进程可能加载到半成品模块（曾致全量偶发红）。
 */
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalSetup(): void {
  const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync(process.execPath, [join(cliRoot, 'node_modules', 'typescript', 'bin', 'tsc')], { cwd: cliRoot });
}
