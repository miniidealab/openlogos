import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * 列出目录下所有文件（递归，排除 .gitkeep）。
 * 若 dir 指向单个文件，返回其 basename；不存在或出错返回空数组。
 *
 * 下沉到独立 lib，使 flow-derive.ts 与 status.ts 都能引用而不形成运行时循环依赖。
 */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    if (statSync(dir).isFile()) return [basename(dir)];
    return readdirSync(dir, { recursive: true })
      .map(f => String(f))
      .filter(f => {
        const full = join(dir, f);
        return statSync(full).isFile() && !f.endsWith('.gitkeep');
      });
  } catch {
    return [];
  }
}
