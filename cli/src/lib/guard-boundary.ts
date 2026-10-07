import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * 提案边界（spec/pretooluse-guard.md「提案边界（C12）」）：`openlogos change` 写入 guard 文件之前调用事后检查引擎
 * `boundary-start`，`openlogos archive` 删除 guard 文件之前调用 `boundary-end`。
 *
 * 引擎按已部署的托管路径查找（Claude 宿主 `.claude/openlogos/bin/guard-post-check.cjs`，Cursor 宿主
 * `.cursor/hooks/openlogos-guard-post.cjs`）；都不存在（非 Claude / Cursor 项目或未部署）→ 跳过。
 * 边界调用失败只告警，不阻断 change / archive。
 */
export const GUARD_ENGINE_CANDIDATES = [
  '.claude/openlogos/bin/guard-post-check.cjs',
  '.cursor/hooks/openlogos-guard-post.cjs',
] as const;

export type GuardBoundaryKind = 'boundary-start' | 'boundary-end';

export interface GuardBoundaryResult {
  status: 'skipped' | 'ok' | 'failed';
  engine?: string;
  detail?: string;
}

export function findGuardEngine(root: string): string | null {
  for (const rel of GUARD_ENGINE_CANDIDATES) {
    const abs = join(root, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

export function runGuardBoundary(root: string, kind: GuardBoundaryKind): GuardBoundaryResult {
  const engine = findGuardEngine(root);
  if (!engine) return { status: 'skipped' };
  const r = spawnSync(process.execPath, [engine, kind], {
    cwd: root,
    input: '',
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  if (r.error || r.status !== 0) {
    const detail = (r.error ? r.error.message : (r.stderr || r.stdout || `exit ${r.status}`)).trim();
    console.error(`  ⚠ openlogos guard ${kind} 未完成（不影响本命令）：${detail}`);
    return { status: 'failed', engine, detail };
  }
  return { status: 'ok', engine, detail: (r.stdout || '').trim() };
}
