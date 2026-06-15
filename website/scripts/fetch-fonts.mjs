/**
 * 下载 Noto Sans SC 源字体（5 字重）到 fonts-src/，供子集化脚本使用。
 *
 * 源字体体积大（每字重 ~10MB，合计 ~50MB），不纳入 git；CI 或新环境运行
 * `npm run fetch:fonts` 即可按需获取。已存在则跳过。
 *
 * 字体来源：Google Fonts（gstatic），Noto Sans SC，SIL OFL 1.1 许可。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'fonts-src');

// 字重 → gstatic 完整 ttf 直链（Noto Sans SC v40）。
const FONTS = {
  400: 'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf',
  500: 'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG-3FnYw.ttf',
  600: 'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGwHCnYw.ttf',
  700: 'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGzjCnYw.ttf',
  900: 'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG3bCnYw.ttf',
};

async function main() {
  mkdirSync(SRC_DIR, { recursive: true });
  for (const [weight, url] of Object.entries(FONTS)) {
    const dest = join(SRC_DIR, `NotoSansSC-${weight}.ttf`);
    if (existsSync(dest)) {
      console.log(`[fetch-fonts] 字重 ${weight} 已存在，跳过`);
      continue;
    }
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[fetch-fonts] 字重 ${weight} 下载失败：HTTP ${res.status}`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    console.log(`[fetch-fonts] 字重 ${weight} → ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  }
  console.log('[fetch-fonts] 完成');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
