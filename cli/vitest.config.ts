import { defineConfig } from 'vitest/config';

function eligibleTestPattern(): RegExp | undefined {
  const raw = process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
  if (!raw) return undefined;
  try {
    const ids = JSON.parse(raw) as unknown;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) return undefined;
    const escaped = ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return escaped.length > 0 ? new RegExp(`\\b(?:${escaped.join('|')})\\b`) : undefined;
  } catch {
    return undefined;
  }
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: true,
    testTimeout: 10_000,
    // r4 F12：worker 启动前串行构建一次 dist——真实 CLI/真实进程测试只读既有 dist，杜绝并发 tsc 竞态
    globalSetup: ['./test/global-setup.ts'],
    reporters: ['default', './test/openlogos-reporter.ts'],
    testNamePattern: eligibleTestPattern(),
    env: { OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '1' },
  },
});
