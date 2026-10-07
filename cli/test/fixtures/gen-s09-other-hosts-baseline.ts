/**
 * 生成 s09-other-hosts-baseline.json：以**修改前**的 qoder / workbuddy / zcode hook 入口对 UT-S09-407 输入集实测
 * 退出码与 stdout，作为「三宿主行为不变」的入库基准（不在测试内复述期望）。
 *
 * 用法（仓库根执行；<修改前提交> 之后三宿主适配层不应有任何改动）：
 *   cd cli && npx vite-node test/fixtures/gen-s09-other-hosts-baseline.ts -- <修改前提交>
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from '../s09-guard-vcs-fixtures.js';
import {
  HOST_INPUTS, HOST_STATES, OTHER_HOSTS, OTHER_HOST_BASELINE_FILE, buildHostProject, runHost,
} from '../s09-other-hosts-fixtures.js';

const args = process.argv.slice(2).filter(a => a !== '--');
const [commit] = args;
if (!commit) throw new Error('用法：gen-s09-other-hosts-baseline.ts <修改前提交>');

const scratch = mkdtempSync(join(tmpdir(), 'openlogos-s09-hosts-old-'));
const cases: Array<{ host: string; state: string; key: string; exit: number; stdout: string }> = [];
try {
  for (const [host, rel] of Object.entries(OTHER_HOSTS)) {
    // 修改前字节取自 git 对象库；统一存为 .cjs，避免受目标目录 package.json type 影响
    const entry = join(scratch, `${host}-runtime.cjs`);
    writeFileSync(entry, execFileSync('git', ['show', `${commit}:${rel}`], { cwd: REPO_ROOT }));
    for (const state of HOST_STATES) {
      for (const item of HOST_INPUTS) {
        const root = mkdtempSync(join(tmpdir(), 'openlogos-s09-hosts-'));
        try {
          buildHostProject(root, state);
          const r = runHost(entry, root, item);
          cases.push({ host, state, key: item.key, exit: r.exit, stdout: r.stdout });
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(OTHER_HOST_BASELINE_FILE, `${JSON.stringify({
  description: '修改前 qoder / workbuddy / zcode hook 入口对 UT-S09-407 输入集的实测退出码与 stdout（guard-versioned-content-scope：三宿主行为不变的回归锚）',
  generated_from: commit,
  cases,
}, null, 2)}\n`);
console.log(`baseline: ${cases.length} cases → ${OTHER_HOST_BASELINE_FILE}`);
