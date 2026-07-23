import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: true,
    testTimeout: 10_000,
    // r4 F12：worker 启动前串行构建一次 dist——真实 CLI/真实进程测试只读既有 dist，杜绝并发 tsc 竞态
    globalSetup: ['./test/global-setup.ts'],
    reporters: ['default', './test/openlogos-reporter.ts'],
  },
});
