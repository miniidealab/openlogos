import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ELIGIBLE_IDS_ENV, eligibleVitestOptions } from './test/eligible-file-selection';

// 收到 verify 注入的用例清单时只收集可能含清单内用例的测试文件，文件内仍按用例名过滤（enable-layered-verify；
// spec/test-results.md「测试入口的义务」第 2 条）。规则与回落见 test/eligible-file-selection.ts。
const eligible = eligibleVitestOptions({ raw: process.env[ELIGIBLE_IDS_ENV], root: dirname(fileURLToPath(import.meta.url)) });

export default defineConfig({
  test: {
    include: eligible.include,
    globals: true,
    // 全量运行时 vitest 按 CPU 数并发执行 240+ 个测试文件，单独运行 1～3 秒的端到端用例（真实子进程、多宿主部署）
    // 在负载下会被拖慢 5～10 倍：fix-claude-hook-windows-powershell-fallback 期间三轮全量与两轮 verify 每次都有 1～4 条
    // 不同的此类用例撞上原 10 秒上限，单独复跑均在 3 秒内通过。默认上限提高到 30 秒，只为负载留出余量，不放宽任何断言；
    // 真正卡死的用例仍会在 30 秒时失败。已知更重的用例另行显式声明更长的超时。
    testTimeout: 30_000,
    // r4 F12：worker 启动前串行构建一次 dist——真实 CLI/真实进程测试只读既有 dist，杜绝并发 tsc 竞态
    globalSetup: ['./test/global-setup.ts'],
    // 同步重度测试文件累计超过 60s 时 worker RPC（onTaskUpdate）应答被饿死：每条用例后让出一次宏任务
    setupFiles: ['./test/setup-yield-event-loop.ts'],
    reporters: ['default', './test/openlogos-reporter.ts'],
    testNamePattern: eligible.testNamePattern,
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
