/**
 * 平台跳过原因的登记入口（verify-self-sufficient-cases，spec/test-results.md「平台跳过原因的 reporter 写法」）。
 *
 * vitest 的通用 `skipIf` 不携带原因，reporter 写出的 skip 行无法区分「本平台不适用」与「环境没准备好」。
 * 这里把原因编码进用例（或所在 describe）的名称：不适用时追加 `[platform-unavailable: <detail>]` 标记，
 * OpenLogos reporter 在写 skip 行时据此写 `reason_code: "platform-unavailable"` 与 `detail`。适用时名称不变。
 *
 * 只用于「平台 / 执行身份 / 平台能力」不适用；适用条件全部成立但缺前置工具时不得跳过——把工具写成
 * `verify.requirements.checks`，由 verify 预检报 verify_env_not_ready。
 */
import { describe, it } from 'vitest';

export const PLATFORM_SKIP_MARKER_RE = /\[platform-unavailable: ([^\]]+)\]/;

/** 不适用时在名称后追加平台跳过标记。 */
export function platformSkipName(name: string, applicable: boolean, detail: string): string {
  return applicable ? name : `${name} [platform-unavailable: ${detail}]`;
}

/** 平台限定用例：不适用时跳过并登记原因。 */
export function itOnPlatform(
  applicable: boolean,
  detail: string,
  name: string,
  fn: Parameters<typeof it>[1],
  timeout?: number,
): void {
  it.skipIf(!applicable)(platformSkipName(name, applicable, detail), fn, timeout);
}

/** 平台限定的用例组：不适用时整组跳过，组名带标记（reporter 按 fullName 读取）。 */
export function describeOnPlatform(applicable: boolean, detail: string, name: string, fn: () => void): void {
  describe.skipIf(!applicable)(platformSkipName(name, applicable, detail), fn);
}
