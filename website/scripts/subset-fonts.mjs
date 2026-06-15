/**
 * 中文字体子集化 —— 在 astro build 之后运行。
 *
 * 流程：
 *  1. 扫描 dist/ 下所有 .html，提取实际出现的汉字与中文标点（以及 ASCII 兜底）。
 *  2. 对 fonts-src/ 下每个字重，调用 Python fontTools 的 subset 模块，
 *     仅保留用到的字形，输出 woff2 到 public/fonts/。
 *
 * 依赖：python3 + fonttools + brotli（woff2 压缩）。
 *   安装：python3 -m pip install --user fonttools brotli
 *
 * 设计取舍：用「实际用字静态子集」而非固定常用字表 —— 站点内容固定（营销页 + 文档），
 * 用字集稳定，能把每个字重从 ~10MB 压到几百 KB，且不漏字。
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(ROOT, 'dist');
const SRC_DIR = join(ROOT, 'fonts-src');
const PUBLIC_OUT_DIR = join(ROOT, 'public', 'fonts');
const DIST_OUT_DIR = join(ROOT, 'dist', 'fonts');

// 字重 → 源文件名。与 BaseLayout / custom.css 的 @font-face 对应。
const WEIGHTS = {
  400: 'NotoSansSC-400.ttf',
  500: 'NotoSansSC-500.ttf',
  600: 'NotoSansSC-600.ttf',
  700: 'NotoSansSC-700.ttf',
  900: 'NotoSansSC-900.ttf',
};

function walkHtml(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkHtml(full, files);
    else if (entry.endsWith('.html')) files.push(full);
  }
  return files;
}

function collectChars() {
  const chars = new Set();
  // ASCII 可见字符兜底（中英混排时数字 / 标点也可能用中文字体渲染）。
  for (let c = 0x20; c <= 0x7e; c++) chars.add(c);
  for (const file of walkHtml(DIST_DIR)) {
    const text = readFileSync(file, 'utf-8');
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      // CJK 统一表意文字、扩展 A、兼容、中文标点、全角符号。
      if (
        (cp >= 0x4e00 && cp <= 0x9fff) ||
        (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0x3000 && cp <= 0x303f) ||
        (cp >= 0xff00 && cp <= 0xffef) ||
        (cp >= 0x2018 && cp <= 0x201f)
      ) {
        chars.add(cp);
      }
    }
  }
  return chars;
}

function main() {
  if (!existsSync(DIST_DIR)) {
    console.error('[subset-fonts] dist/ 不存在，请先运行 astro build');
    process.exit(1);
  }
  const chars = collectChars();
  const cjkCount = [...chars].filter((c) => c >= 0x3000).length;
  console.log(`[subset-fonts] 收集到 ${chars.size} 个字符（其中 CJK/标点约 ${cjkCount} 个）`);

  mkdirSync(PUBLIC_OUT_DIR, { recursive: true });
  mkdirSync(DIST_OUT_DIR, { recursive: true });
  // pyftsubset 接受 --unicodes=U+XXXX,... 列表。
  const unicodes = [...chars].map((c) => `U+${c.toString(16).toUpperCase()}`).join(',');

  for (const [weight, srcName] of Object.entries(WEIGHTS)) {
    const src = join(SRC_DIR, srcName);
    const out = join(PUBLIC_OUT_DIR, `NotoSansSC-${weight}.subset.woff2`);
    const distOut = join(DIST_OUT_DIR, `NotoSansSC-${weight}.subset.woff2`);
    if (!existsSync(src)) {
      // 源字体不进 git。缺失但已有子集产物时跳过（容忍 CI 缓存了产物的情况）；
      // 否则提示运行 fetch:fonts 获取源字体。
      if (existsSync(out)) {
        console.warn(`[subset-fonts] 源字体缺失，沿用已有子集：${out.replace(ROOT + '/', '')}`);
        copyFileSync(out, distOut);
        continue;
      }
      console.error(`[subset-fonts] 源字体缺失：${src}\n  请先运行：npm run fetch:fonts`);
      process.exit(1);
    }
    execFileSync(
      'python3',
      [
        '-m',
        'fontTools.subset',
        src,
        `--unicodes=${unicodes}`,
        '--flavor=woff2',
        '--layout-features=*',
        `--output-file=${out}`,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    copyFileSync(out, distOut);
    const kb = (statSync(out).size / 1024).toFixed(0);
    console.log(`[subset-fonts] 字重 ${weight} → ${out.replace(ROOT + '/', '')} + ${distOut.replace(ROOT + '/', '')} (${kb} KB)`);
  }
  console.log('[subset-fonts] 完成');
}

main();
