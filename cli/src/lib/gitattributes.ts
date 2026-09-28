/**
 * 项目根 `.gitattributes` 的 OpenLogos 托管块（架构 §五十二 52.4 预防）。
 *
 * 哈希绑定的规格 / 原型与托管钩子脚本依赖原始字节跨机一致；`core.autocrlf=true` 签出会把 LF 改成 CRLF。
 * 托管块对 `logos/**` 与托管钩子 / 运行时目录设 `-text`（关闭换行转换、字节原样；不影响 diff），
 * 只作用于之后的签出——已被转换的工作区由 `crlf-recovery.ts` 受控恢复。
 *
 * 托管块以起止标记识别：块外用户内容字节保真，重复执行零 diff；已有旧版托管块原地替换，不重复追加。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const GITATTRIBUTES_BLOCK_START = '# >>> OpenLogos managed: line-ending fidelity (do not edit) >>>';
export const GITATTRIBUTES_BLOCK_END = '# <<< OpenLogos managed <<<';

/** `-text` 覆盖面：规格 / 原型所在的 logos 树，以及各宿主的托管钩子与运行时目录。 */
export const GITATTRIBUTES_MANAGED_PATTERNS: readonly string[] = [
  'logos/**',
  '.claude/openlogos/**',
  '.cursor/hooks/**',
  '.agents/plugins/openlogos/hooks/**',
  '.zcode/plugins/openlogos/**',
  '.qoder/plugins/openlogos/**',
  '.workbuddy/plugins/openlogos/**',
];

export function managedGitattributesBlock(): string {
  return [
    GITATTRIBUTES_BLOCK_START,
    ...GITATTRIBUTES_MANAGED_PATTERNS.map(pattern => `${pattern} -text`),
    GITATTRIBUTES_BLOCK_END,
  ].join('\n') + '\n';
}

/** 纯函数：返回写入托管块后的内容（`null` 表示文件不存在）。 */
export function mergeGitattributesContent(existing: string | null): string {
  const block = managedGitattributesBlock();
  if (existing === null || existing.length === 0) return block;
  const start = existing.indexOf(GITATTRIBUTES_BLOCK_START);
  const endMarker = start >= 0 ? existing.indexOf(GITATTRIBUTES_BLOCK_END, start) : -1;
  if (start >= 0 && endMarker >= 0) {
    let end = endMarker + GITATTRIBUTES_BLOCK_END.length;
    if (existing.startsWith('\r\n', end)) end += 2;
    else if (existing[end] === '\n') end += 1;
    return existing.slice(0, start) + block + existing.slice(end);
  }
  const separator = existing.endsWith('\n') ? '' : '\n';
  return `${existing}${separator}${block}`;
}

/** 幂等写入；返回是否发生变更。 */
export function ensureManagedGitattributes(root: string): boolean {
  const target = join(root, '.gitattributes');
  const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
  const next = mergeGitattributesContent(existing);
  if (next === existing) return false;
  writeFileSync(target, next);
  return true;
}
