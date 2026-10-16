/**
 * ST-S41-06 ④（proposal-default-environment）旧读取方兼容夹具：登记表顶层写有合法 `proposal_default_env` 时，
 * 执行 `env check` / `env list`，记录规范化后的输出与退出码。
 *
 * 本文件是夹具的唯一定义点：基线生成（引入本提案前的 0.16.5 CLI）与测试（当前 CLI）调用同一函数，
 * 保证比较的是同一输入。见 test/golden/README.md「s41-proposal-default-env-baseline.json」。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** 合法默认环境：test 已登记；prod 配置了 deploy 与门禁（默认值不限制所指环境以外的配置）。 */
export const REGISTRY_WITH_DEFAULT = [
  'schema_version: 1',
  'proposal_default_env: test',
  'environments:',
  '  - {id: test, name: Test, tier: test, aliases: [测试]}',
  '  - {id: staging, name: Staging, tier: staging, deploy: {mode: script, script: deploy/staging.sh}}',
  '  - {id: prod, name: Production, tier: prod, aliases: [生产], deploy: {mode: script, script: deploy/prod.sh}, promote_from: staging, require_approval: true}',
  '',
].join('\n');

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function normalizer(root) {
  const roots = [root, realpathSync(root)];
  return text => {
    let out = text;
    for (const r of roots) out = out.split(r).join('<ROOT>');
    return out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TIME>');
  };
}

function envelope(raw, norm) {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  try {
    const parsed = JSON.parse(trimmed);
    delete parsed.version;
    delete parsed.timestamp;
    return JSON.parse(norm(JSON.stringify(parsed)));
  } catch {
    return norm(trimmed);
  }
}

/**
 * 在合法默认环境的登记表上执行 env check / env list，返回可比较的观测结果。
 * @param {string} cliEntry  CLI 入口（dist/index.js）
 */
export function observeDefaultEnvFixture(cliEntry) {
  const root = mkdtempSync(join(tmpdir(), 'ol-s41-default-env-'));
  try {
    put(root, 'logos/logos.config.json', JSON.stringify({ name: 'fixture', locale: 'en' }, null, 2));
    put(root, 'logos/logos-project.yaml', 'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
    put(root, 'deploy/prod.sh', '#!/bin/sh\nexit 0\n');
    put(root, 'deploy/staging.sh', '#!/bin/sh\nexit 0\n');
    put(root, 'logos/environments.yaml', REGISTRY_WITH_DEFAULT);
    const norm = normalizer(root);
    const run = args => {
      const r = spawnSync(process.execPath, [cliEntry, ...args], { cwd: root, encoding: 'utf-8', timeout: 60_000, env: { ...process.env, NO_COLOR: '1' } });
      return { args: args.join(' '), exit: r.status, stdout: envelope(r.stdout ?? '', norm), stderr: envelope(r.stderr ?? '', norm) };
    };
    return { steps: [run(['env', 'check', '--format', 'json']), run(['env', 'list', '--format', 'json'])] };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 直接执行：node s41-proposal-default-env-fixture.mjs <cli-entry> <out.json>（只用于以引入前的 CLI 生成基线）
if (process.argv[1] && process.argv[1].endsWith('s41-proposal-default-env-fixture.mjs') && process.argv.length >= 4) {
  writeFileSync(process.argv[3], JSON.stringify(observeDefaultEnvFixture(process.argv[2]), null, 2) + '\n');
  console.log(`baseline written: ${process.argv[3]}`);
}
