/**
 * openlogos check-ui-hash-match —— overlay-add 节点 `verify-ui-provenance` 的 `done_when: cmd:` 后端。
 *
 * 置于 merge 之前，重算 `2-page-design/` 原型 delta 现值 hash 与 `PLAN_APPROVED.hashes` 比对。
 * 三分支（键=持久化 PLAN_APPROVED provenance，不读会话 capability，F4 R7）：
 *   full   → 全匹配 exit 0 / 失配·损坏 fail closed（非 0）；
 *   legacy → 记 advisory 后 exit 0（节点 done、merge 可达）；
 *   partial→ fail closed（非 0）。
 */
import { existsSync } from 'node:fs';
import { type OutputFormat, makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import { resolveActiveProposal } from './check-ui-prototype.js';
import { checkUiHashMatch } from '../lib/ui-provenance.js';

const COMMAND = 'check-ui-hash-match';

export function checkUiHashMatchCommand(slug: string | undefined, format: OutputFormat = 'text'): void {
  const root = process.cwd();
  if (!existsSync(`${root}/logos/logos.config.json`)) {
    const msg = 'logos/logos.config.json not found.';
    if (format === 'json') console.error(JSON.stringify(makeErrorEnvelope(COMMAND, 'PROJECT_NOT_INITIALIZED', msg)));
    else console.error(`Error: ${msg}`);
    process.exit(1);
  }

  const resolved = resolveActiveProposal(root, slug);
  if (!resolved) {
    const msg = '无法定位活跃提案：请显式传入 slug，或确保 guard/单一提案目录可解析。';
    if (format === 'json') console.error(JSON.stringify(makeErrorEnvelope(COMMAND, 'no_active_proposal', msg)));
    else console.error(msg);
    process.exit(2);
  }

  const res = checkUiHashMatch(resolved.proposalDir);
  if (res.ok) {
    const data = { slug: resolved.slug, provenance_class: res.cls, advisory: res.advisory, code: res.code };
    if (format === 'json') process.stdout.write(JSON.stringify(makeEnvelope(COMMAND, data)) + '\n');
    else console.log(res.advisory
      ? `advisory: 无「曾渲染确认」证据（${res.cls}），不宣称 UI 已确认、放行（${res.code}）`
      : `✓ UI provenance hash 匹配（${res.cls}）`);
    process.exit(0);
  }

  const msg = `UI provenance 校验失败（${res.cls}/${res.code}）：${res.detail ?? '原型漂移或 provenance 不完整'}`;
  if (format === 'json') {
    console.error(JSON.stringify(makeErrorEnvelope(COMMAND, res.code, msg)));
  } else {
    console.error(msg);
  }
  process.exit(1);
}
