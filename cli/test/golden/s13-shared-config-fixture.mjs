/**
 * verify-scope-fields-and-slice-module 切片 2 的夹具辅助：共享验收配置按字段判断（功能规格 §2.96.3.1）。
 * 建在两套既有夹具之上：夹具 MS（s13-module-scope-fixture.mjs，多模块 core / portal-web）与夹具 LV（s13-layered-fixture.mjs）。
 *
 * 作为脚本运行时生成 UT-S13-286 的 golden（两个范围机制都未进入字段比较的三个夹具，在引入前实现上的输出）：
 *   node cli/test/golden/s13-shared-config-fixture.mjs <引入前 CLI 的 dist/index.js> <输出 json>
 * 只依赖 CLI 入口与其 lib/test-change-set.js，对引入前、引入后的构建都能运行。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addProposal, createScopeProject, put, runVerify as runMsVerify } from './s13-module-scope-fixture.mjs';
import { ALL_DEFAULT, RESULTS, createLv, destroyLv, normalizer, runVerify as runLvVerify } from './s13-layered-fixture.mjs';

export const MS_IDS = ['UT-S01-01', 'UT-S01-02', 'UT-S50-01', 'UT-S50-02', 'UT-S90-01'];
export const CONFIG = 'logos/logos.config.json';
export const YAML = 'logos/logos-project.yaml';

/** 在缺省结果路径预置与已定义用例匹配的合法结果（配置损坏或没有可执行命令时，verify 只能读取既有结果）。 */
export function seedResults(root, ids) {
  const path = join(root, RESULTS);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${ids.map(id => JSON.stringify({ id, status: 'pass', timestamp: '2026-11-28T00:00:00.000Z' })).join('\n')}\n`);
}

export const readConfig = root => JSON.parse(readFileSync(join(root, CONFIG), 'utf8'));
export const writeConfig = (root, cfg, indent = 2) => writeFileSync(join(root, CONFIG), JSON.stringify(cfg, null, indent));
export const editConfig = (root, mutate) => { const cfg = readConfig(root); mutate(cfg); writeConfig(root, cfg); };
export const readYaml = root => readFileSync(join(root, YAML), 'utf8');
export const writeYaml = (root, text) => writeFileSync(join(root, YAML), text);
export const appendYaml = (root, text) => writeYaml(root, `${readYaml(root)}${text}`);
export const corruptConfig = root => writeFileSync(join(root, CONFIG), '{ "name": "broken", ');

/** 夹具 MS 上建立活跃提案并留下一处范围内的源码改动（保证改动集合非空、范围可计算）。 */
export function msProposal(root, proposal = {}) {
  addProposal(root, proposal);
  put(root, 'portal-web/app.ts', 'export const app = 2;\n');
}

function normalizeEnvelope(root, run) {
  const norm = normalizer({ root, outside: root });
  const envelope = run.envelope ? { ...run.envelope } : null;
  if (envelope) { delete envelope.version; delete envelope.timestamp; }
  if (envelope?.data && typeof envelope.data === 'object') {
    envelope.data = { ...envelope.data };
    delete envelope.data.history;
  }
  let errorCode = null;
  try { errorCode = JSON.parse((run.stderr ?? '').trim()).error?.code ?? null; } catch { /* 成功时 stderr 不是信封 */ }
  return { status: run.status, error_code: errorCode, envelope: envelope ? JSON.parse(norm(JSON.stringify(envelope))) : null };
}

/**
 * UT-S13-286 的三个夹具：两个范围机制都没有对配置文件做字段比较，改动集合中也没有其他会产生
 * shared_config_changed / shared_path_changed 的文件。
 *   no-config    夹具 MS，删除工作区 logos/logos.config.json
 *   lv-corrupt   夹具 LV（单模块、分层开启），预置结果后把工作区 logos.config.json 改成损坏的 JSON
 *   no-yaml      夹具 MS（分层关闭），预置结果后删除工作区 logos/logos-project.yaml
 */
export function observeNotEntered(cliEntry, buildTestChangeSet) {
  const out = {};
  const made = [];
  try {
    const a = createScopeProject(); made.push(a);
    msProposal(a);
    rmSync(join(a, CONFIG));
    out['no-config'] = normalizeEnvelope(a, runMsVerify(cliEntry, a));

    const f = createLv({ buildTestChangeSet });
    try {
      seedResults(f.root, ALL_DEFAULT);
      corruptConfig(f.root);
      const run = runLvVerify(cliEntry, f);
      out['lv-corrupt'] = { ...normalizeEnvelope(f.root, run), calls: run.calls.length };
    } finally {
      destroyLv(f);
    }

    const c = createScopeProject(); made.push(c);
    msProposal(c);
    seedResults(c, MS_IDS);
    rmSync(join(c, YAML));
    const run = runMsVerify(cliEntry, c);
    out['no-yaml'] = { ...normalizeEnvelope(c, run), calls: run.calls.length };
  } finally {
    for (const root of made) rmSync(root, { recursive: true, force: true });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('s13-shared-config-fixture.mjs') && process.argv[2] && process.argv[3]) {
  const lib = await import(pathToFileURL(resolve(dirname(process.argv[2]), 'lib/test-change-set.js')).href);
  writeFileSync(process.argv[3], `${JSON.stringify(observeNotEntered(process.argv[2], lib.buildTestChangeSet), null, 2)}\n`);
  console.log(`golden written: ${process.argv[3]}`);
}
