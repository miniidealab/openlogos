/**
 * 生成 s09-module-instructions-baseline.json：以**修改前**（0.16.8，adce1e8）的指令生成实现与 SessionStart 脚本，
 * 实测布尔入参下的全部指令文本、全 initial / 全 launched 夹具的 SessionStart 注入，以及 init + sync 后的托管段，
 * 作为「initial、launched 视图逐字节不变」的入库基准（不在测试内复述期望）。
 *
 * 用法（仓库根执行；必须在 cli/src 指令生成代码与两个 SessionStart 脚本改动之前运行）：
 *   cd cli && npx vite-node test/fixtures/gen-s09-module-instructions-baseline.ts -- <修改前提交>
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentsMd, generatePolicyMdc, init } from '../../src/commands/init.js';
import { sync } from '../../src/commands/sync.js';
import { createQoderAgentsInstruction, createWorkBuddyAgentsInstruction, createZCodeAgentsInstruction } from '../../src/lib/ai-tool-adapter.js';
import { createCursorAgentsInstruction } from '../../src/lib/cursor-adapter.js';
import { MLI_BASELINE_FILE, initThenSync, instructionTextMatrix, sessionMatrix } from '../s09-module-instructions-fixtures.js';

const args = process.argv.slice(2).filter(a => a !== '--');
const [commit] = args;
if (!commit) throw new Error('用法：gen-s09-module-instructions-baseline.ts <修改前提交>');

const texts = instructionTextMatrix({
  createAgentsMd, generatePolicyMdc, createZCodeAgentsInstruction, createQoderAgentsInstruction,
  createWorkBuddyAgentsInstruction, createCursorAgentsInstruction,
});
const session = sessionMatrix();
const synced: Record<string, string> = {};
process.env.OPENLOGOS_CODEX_PERSONAL_HOME = join(tmpdir(), 'openlogos-mli-codex-home');
for (const kind of ['A-initial', 'A-launched'] as const) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mli-sync-'));
  try {
    const r = await initThenSync(root, kind, { init, sync });
    synced[`sync|${kind}|agents`] = r.agents;
    synced[`sync|${kind}|claude`] = r.claude;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
writeFileSync(MLI_BASELINE_FILE, `${JSON.stringify({
  description: '修改前（0.16.8）指令生成与 SessionStart 的实测文本：布尔入参指令矩阵、全 initial / 全 launched 夹具 SessionStart 注入、init + sync 托管段（module-lifecycle-guard：initial、launched 视图逐字节不变的回归锚）',
  generated_from: commit,
  texts: { ...texts, ...session, ...synced },
}, null, 2)}\n`);
console.log(`baseline: ${Object.keys(texts).length} texts + ${Object.keys(session).length} sessions + ${Object.keys(synced).length} synced → ${MLI_BASELINE_FILE}`);
