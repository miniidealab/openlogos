#!/usr/bin/env node
/**
 * ST-S13-26 适用条件的单一判定 + verify 环境检查 `linux-nondump-cc`（verify-self-sufficient-cases，功能规格 §2.106.4、§2.106.10）。
 *
 * - 判定：Linux、非 root、沙箱复用能力可用，三者同时成立才适用。复用能力与
 *   cli/src/lib/sandbox-reuse.ts 的 detectLivenessCapability 同口径（Linux 上能读 /proc/self/environ；
 *   测试接缝 OPENLOGOS_SANDBOX_TEST_NO_LIVENESS=1 时不可用）。
 * - 作为模块：ST-S13-26 的跳过条件导入 nondumpApplicable，不另写一份。
 * - 作为脚本（logos/logos.config.json → verify.requirements.checks）：不适用时直接以 0 退出；
 *   适用时要求 `cc --version` 成功（ST-S13-26 需要编译不可转储夹具）。只读，不写任何文件，跨平台可执行。
 */
import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 与 detectLivenessCapability 的 Linux 分支同口径。 */
export function livenessAvailable(env = process.env, platform = process.platform) {
  if (env.OPENLOGOS_SANDBOX_TEST_NO_LIVENESS === '1') return false;
  if (platform !== 'linux') return false;
  try {
    readFileSync('/proc/self/environ');
    return true;
  } catch {
    return false;
  }
}

/**
 * ST-S13-26 的完整适用条件。各项可注入（测试用），缺省取当前进程事实。
 * @param {{ platform?: string, uid?: number | null, liveness?: boolean }} [input]
 */
export function nondumpApplicable(input = {}) {
  const platform = input.platform ?? process.platform;
  const uid = input.uid !== undefined ? input.uid : (typeof process.getuid === 'function' ? process.getuid() : null);
  const liveness = input.liveness ?? livenessAvailable(process.env, platform);
  return platform === 'linux' && uid !== null && uid !== 0 && liveness === true;
}

/** 平台跳过时写给 reporter 的说明。 */
export const NONDUMP_SKIP_DETAIL = 'requires non-root linux with sandbox reuse capability';

/** 检查命令语义：不适用 → 0；适用 → cc 可用为 0、否则 1。`ccAvailable` 可注入。 */
export function checkExitCode(input = {}, ccAvailable = () => spawnSync('cc', ['--version'], { stdio: 'ignore' }).status === 0) {
  if (!nondumpApplicable(input)) return 0;
  return ccAvailable() ? 0 : 1;
}

function invokedDirectly() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exit(checkExitCode());
