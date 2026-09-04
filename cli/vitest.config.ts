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
    env: {
      OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '1',
      // S16/S19 安装态测试真实执行 `npm uninstall`（含生产回滚命令原样执行）。npm 默认在
      // uninstall 后跑 audit（registry 网络调用），且 `--prefix <tmp>` 会把项目配置解析到
      // 该临时 prefix——仓库 .npmrc 管不到。registry 间歇性变慢时该网络调用会撞上测试的
      // 120s spawnSync 超时（spawnSync npm ETIMEDOUT），verify 全量下呈随机假红。
      // env 级 npm 配置对子进程全部 npm 调用生效且不改写任何被测命令的参数合同。
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  },
});
