import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, basename, sep } from 'node:path';

/**
 * 列出目录下所有文件（递归，排除 .gitkeep）。
 * 若 dir 指向单个文件，返回其 basename；不存在或出错返回空数组。
 *
 * 下沉到独立 lib，使 flow-derive.ts 与 status.ts 都能引用而不形成运行时循环依赖。
 *
 * 返回值定义为「相对 dir、`/` 分隔」的 posix 相对路径（架构 §五十二 52.1-3）：全部消费方都把结果
 * 当 posix 相对路径使用，Windows 上 readdirSync 的 `\` 在此统一出口，消费方不各自 replace。
 */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    if (statSync(dir).isFile()) return [basename(dir)];
    return readdirSync(dir, { recursive: true })
      .map(f => String(f).split(sep).join('/'))
      .filter(f => {
        const full = join(dir, f);
        return statSync(full).isFile() && !f.endsWith('.gitkeep');
      });
  } catch {
    return [];
  }
}
