import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit, writeLoopPass } from './helpers.js';
import { collectSmokeData, extractSmokeDefinedIds, smoke } from '../src/commands/smoke.js';
import { detectRuntimeWriteProtection, DEPENDENCY_DIR_EXEMPT_INFO } from '../src/lib/sandbox.js';
import { checkSmokeCoverage, discoverSmokeRunners } from '../src/lib/smoke-coverage.js';
import { detectProposalStep } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';
import { deployDone } from '../src/commands/deploy-done.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('S19 Unit Tests — smoke cases', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S19-01: extract SMOKE IDs from smoke test case specs', () => {
    const dir = join(root, 'logos/resources/test/smoke');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'core-smoke-test-cases.md'), 'SMOKE-core-02\nSMOKE-core-01\nSMOKE-core-01');

    expect(extractSmokeDefinedIds(root)).toEqual(['SMOKE-core-01', 'SMOKE-core-02']);
  });

  it('UT-S19-SMOKE-04: smoke 表格只提取 ID 列，不把操作示例当成用例', () => {
    const dir = join(root, 'logos/resources/test/smoke');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'core-smoke-test-cases.md'), [
      '| ID | 描述 | 操作 |',
      '|----|------|------|',
      '| SMOKE-core-28 | runner missing | 构造 SMOKE-TEMP-01 作为临时数据 |',
    ].join('\n'));

    expect(extractSmokeDefinedIds(root)).toEqual(['SMOKE-core-28']);
  });

  it('UT-S19-04: proposal smoke_required controls smoke gate step', () => {
    const proposalDir = join(root, 'logos', 'changes', 'runtime-change');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：runtime-change',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 是否需要 smoke：是',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: false })).toBe('ready-to-deploy');

    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: false })).toBe('ready-to-smoke');
  });

  it('UT-S19-SMOKE-01: 缺少 smoke runner 时输出诊断', () => {
    const proposalDir = join(root, 'logos', 'changes', 'add-smoke');
    mkdirSync(join(proposalDir, 'deltas/test/smoke'), { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'add-smoke', module: 'core' }));
    writeFileSync(join(proposalDir, 'deltas/test/smoke/core-smoke-test-cases.md'), '| SMOKE-TEMP-01 | temp |');

    const check = checkSmokeCoverage(root);

    expect(check.result).toBe('FAIL');
    expect(check.changed_case_ids).toEqual(['SMOKE-TEMP-01']);
    expect(check.diagnostics.map(d => d.code)).toContain('smoke_runner_missing');
  });

  it('UT-S19-SMOKE-02: runner 未写入 result path 时输出诊断', () => {
    const proposalDir = join(root, 'logos', 'changes', 'add-smoke');
    mkdirSync(join(proposalDir, 'deltas/test/smoke'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'add-smoke', module: 'core' }));
    writeFileSync(join(proposalDir, 'deltas/test/smoke/core-smoke-test-cases.md'), '| SMOKE-TEMP-02 | temp |');
    writeFileSync(join(root, 'scripts/smoke-temp.sh'), '#!/usr/bin/env bash\nexit 0\n');

    const check = checkSmokeCoverage(root, { command: 'node scripts/run-smoke.js' });

    expect(check.result).toBe('FAIL');
    expect(check.runners).toEqual(['scripts/smoke-temp.sh']);
    expect(check.diagnostics.map(d => d.code)).toContain('smoke_reporter_missing');
  });

  it('UT-S19-SMOKE-03: dispatcher 可发现 smoke runner', () => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'website/scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/smoke-core.sh'), '#!/usr/bin/env bash\n');
    writeFileSync(join(root, 'website/scripts/smoke-releases.mjs'), 'process.exit(0);\n');

    expect(discoverSmokeRunners(root)).toEqual([
      'scripts/smoke-core.sh',
      'website/scripts/smoke-releases.mjs',
    ]);
  });

  it('UT-S19-07: smoke skip 计入有效通过率', () => {
    scaffoldProject(root, { locale: 'zh' });
    const casesDir = join(root, 'logos/resources/test/smoke');
    mkdirSync(casesDir, { recursive: true });
    writeFileSync(join(casesDir, 'core-smoke-test-cases.md'), [
      '| SMOKE-core-01 | health |',
      '| SMOKE-core-02 | environment skip |',
    ].join('\n'));
    const verifyDir = join(root, 'logos/resources/verify');
    mkdirSync(verifyDir, { recursive: true });
    writeFileSync(join(verifyDir, 'smoke-results.jsonl'), [
      '{"id":"SMOKE-core-01","status":"pass"}',
      '{"id":"SMOKE-core-02","status":"skip"}',
    ].join('\n') + '\n');

    const data = collectSmokeData(root);

    expect(data.gate.result).toBe('PASS');
    expect(data.gate.reason).toBeNull();
    expect(data.summary.pass_rate_pct).toBe(100);
    expect(data.summary.skipped_count).toBe(1);
    expect(data.skipped_cases).toEqual(['SMOKE-core-02']);
  });
});

describe('S19 Scenario Tests — smoke command', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'en' });
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanup();
  });

  function writeSmokeCases() {
    const dir = join(root, 'logos/resources/test/smoke');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'core-smoke-test-cases.md'), '| SMOKE-core-01 | health |\n| SMOKE-core-02 | main flow |');
  }

  function writeSmokeResults(lines: string[]) {
    const dir = join(root, 'logos/resources/verify');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'smoke-results.jsonl'), lines.join('\n') + '\n');
  }

  function writeChangedSmokeDelta(slug: string, id: string) {
    const proposalDir = join(root, 'logos', 'changes', slug);
    mkdirSync(join(proposalDir, 'deltas/test/smoke'), { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
    writeFileSync(join(proposalDir, 'deltas/test/smoke/core-smoke-test-cases.md'), `| ${id} | temp |`);
    return proposalDir;
  }

  function writeLaunchedModule() {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
        deployment_gates: { core: { deployment_required: true, smoke_required: true } },
      }, { lineWidth: 0 }),
    );
  }

  it('ST-S19-01: all smoke cases pass → Gate PASS and SMOKE_PASS marker', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
      '{"id":"SMOKE-core-02","status":"pass"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'deploy-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'deploy-feature', module: 'core' }));
    writeFileSync(join(proposalDir, 'SMOKE_FAIL'), '');

    smoke('text', 'staging');

    const out = con.logs.join('\n');
    expect(out).toContain('Gate 3.8: PASS');
    expect(out).toContain('staging');
    expect(existsSync(join(root, 'logos/resources/verify/smoke-report.md'))).toBe(true);
    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(true);
    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(false);
  });

  it('ST-S19-02: uncovered smoke case → Gate FAIL and SMOKE_FAIL marker', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'deploy-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'deploy-feature', module: 'core' }));

    expect(() => smoke()).toThrow('process.exit(1)');

    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(true);
    const report = readFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'utf-8');
    expect(report).toContain('SMOKE-core-02');
  });

  it('ST-S19-SMOKE-01: 新增 smoke case 未执行时 Gate FAIL 且诊断明确', () => {
    writeSmokeCases();
    writeChangedSmokeDelta('deploy-feature', 'SMOKE-core-02');
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
    ]);

    expect(() => smoke('json')).toThrow('process.exit(1)');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('FAIL');
    expect(parsed.data.uncovered_cases).toContain('SMOKE-core-02');
    expect(parsed.data.diagnostics.map((d: { code: string }) => d.code)).toContain('smoke_runner_missing');
    expect(parsed.data.diagnostics.map((d: { code: string }) => d.code)).toContain('smoke_cases_uncovered');
  });

  it('ST-S19-03: json output has smoke envelope', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
      '{"id":"SMOKE-core-02","status":"pass"}',
    ]);

    smoke('json', 'production');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.command).toBe('smoke');
    expect(parsed.data.environment).toBe('production');
    expect(parsed.data.gate.result).toBe('PASS');
    expect(parsed.data.sandbox).toBeDefined();
    expect(parsed.data.sandbox.mode).toBe('auto');
    expect(['pass', 'warn', 'skipped']).toContain(parsed.data.sandbox.status);
  });

  it('ST-S19-08: smoke 含环境性 skip 时报告 PASS 且保留跳过列表', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
      '{"id":"SMOKE-core-02","status":"skip"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'verify-skip-counts-as-pass');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({
      activeChange: 'verify-skip-counts-as-pass',
      module: 'core',
    }));
    writeFileSync(join(proposalDir, 'SMOKE_FAIL'), '');

    smoke('json', 'staging');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('PASS');
    expect(parsed.data.gate.reason).toBeNull();
    expect(parsed.data.summary.pass_rate_pct).toBe(100);
    expect(parsed.data.summary.skipped_count).toBe(1);
    expect(parsed.data.skipped_cases).toEqual(['SMOKE-core-02']);
    const report = readFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'utf-8');
    expect(report).toContain('## Skipped Cases');
    expect(report).toContain('SMOKE-core-02');
    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(true);
    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // 原名 ST-S19-06 与规格中「缺少 DEPLOY_DONE 拒绝推进」的 ST-S19-06 撞号，
  // 更正为归属 UT-S19-08 的回归分支（豁免目录之外的非白名单写入仍按 EX-4.3 阻断）
  it('UT-S19-08: 回归——smoke always 沙箱阻断 node_modules 之外的非白名单写入', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
      '{"id":"SMOKE-core-02","status":"pass"}',
    ]);
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.smoke = {
      ...(config.smoke ?? {}),
      sandbox_mode: 'always',
      command: `node -e "require('fs').writeFileSync('smoke-forbidden.txt','x')"`,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    expect(() => smoke('json', 'staging')).toThrow('process.exit(1)');
    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('FAIL');
    expect(parsed.data.sandbox.mode).toBe('always');
    expect(parsed.data.sandbox.status).toBe('fail');
  });

  it.skipIf(!detectRuntimeWriteProtection().available)('UT-S19-08: smoke 沙箱 always 模式下 node_modules 写入豁免，说明走 infos 通道', () => {
    writeSmokeCases();
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    // 模拟真实 runner：先做 pnpm 式依赖修复写入，再产出 smoke 结果
    writeFileSync(join(root, 'nm-write.js'), [
      "const fs=require('fs');",
      "fs.mkdirSync('node_modules/.bin',{recursive:true});",
      "fs.writeFileSync('node_modules/.bin/x','x');",
      "fs.mkdirSync('logos/resources/verify',{recursive:true});",
      "fs.writeFileSync('logos/resources/verify/smoke-results.jsonl',",
      "  '{\"id\":\"SMOKE-core-01\",\"status\":\"pass\"}\\n{\"id\":\"SMOKE-core-02\",\"status\":\"pass\"}\\n');",
    ].join('\n'));
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.smoke = {
      ...(config.smoke ?? {}),
      sandbox_mode: 'always',
      command: 'node nm-write.js',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    smoke('json', 'staging');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('PASS');
    expect(parsed.data.sandbox.status).toBe('pass');
    expect(parsed.data.sandbox.infos).toContain(DEPENDENCY_DIR_EXEMPT_INFO);
    expect(parsed.data.sandbox.diagnostics.join('\n')).not.toContain('非白名单');
    // node_modules 写入不回收到原 workspace
    expect(existsSync(join(root, 'node_modules/.bin/x'))).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it.skipIf(!detectRuntimeWriteProtection().available)('internal-S19-nested-node-modules-infos: 仅含嵌套 node_modules 的 monorepo 同样产生 infos（共享执行器回归）', () => {
    writeSmokeCases();
    mkdirSync(join(root, 'packages/a/node_modules'), { recursive: true });
    writeFileSync(join(root, 'nested-nm.js'), [
      "const fs=require('fs');",
      "fs.mkdirSync('packages/a/node_modules/.bin',{recursive:true});",
      "fs.writeFileSync('packages/a/node_modules/.bin/x','x');",
      "fs.mkdirSync('logos/resources/verify',{recursive:true});",
      "fs.writeFileSync('logos/resources/verify/smoke-results.jsonl',",
      "  '{\"id\":\"SMOKE-core-01\",\"status\":\"pass\"}\\n{\"id\":\"SMOKE-core-02\",\"status\":\"pass\"}\\n');",
    ].join('\n'));
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.smoke = {
      ...(config.smoke ?? {}),
      sandbox_mode: 'always',
      command: 'node nested-nm.js',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    smoke('json', 'staging');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('PASS');
    expect(parsed.data.sandbox.status).toBe('pass');
    expect(parsed.data.sandbox.infos).toContain(DEPENDENCY_DIR_EXEMPT_INFO);
    expect(parsed.data.sandbox.diagnostics.join('\n')).not.toContain(DEPENDENCY_DIR_EXEMPT_INFO);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it.skipIf(!detectRuntimeWriteProtection().available)('UT-S19-09: smoke 结果文件位于 node_modules 下仍被定点采集回收', () => {
    writeSmokeCases();
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'nm-result.js'), [
      "const fs=require('fs');",
      "fs.mkdirSync('node_modules/.cache/openlogos',{recursive:true});",
      "fs.writeFileSync('node_modules/.cache/openlogos/smoke-results.jsonl',",
      "  '{\"id\":\"SMOKE-core-01\",\"status\":\"pass\"}\\n{\"id\":\"SMOKE-core-02\",\"status\":\"pass\"}\\n');",
    ].join('\n'));
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.smoke = {
      ...(config.smoke ?? {}),
      sandbox_mode: 'always',
      result_path: 'node_modules/.cache/openlogos/smoke-results.jsonl',
      command: 'node nm-result.js',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    smoke('json', 'staging');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('PASS');
    expect(parsed.data.sandbox.status).toBe('pass');
    expect(parsed.data.sandbox.diagnostics.join('\n')).not.toContain('非白名单');
    // 定点采集：白名单结果文件即使位于 node_modules 下也回收到原 workspace
    expect(existsSync(join(root, 'node_modules/.cache/openlogos/smoke-results.jsonl'))).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('ST-S19-SMOKE-02: 统一 dispatcher 执行新增 runner 后无 uncovered', () => {
    writeSmokeCases();
    const proposalDir = writeChangedSmokeDelta('deploy-feature', 'SMOKE-core-02');
    writeSmokeResults([
      '{"id":"SMOKE-core-99","status":"pass","scenario":"stale result from previous deployment"}',
    ]);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'website/scripts'), { recursive: true });
    copyFileSync(join(REPO_ROOT, 'scripts/run-smoke.js'), join(root, 'scripts/run-smoke.js'));
    writeFileSync(join(root, 'scripts/smoke-root.js'), [
      "import { mkdirSync, appendFileSync } from 'node:fs';",
      "import { dirname } from 'node:path';",
      "const resultPath = process.env.OPENLOGOS_SMOKE_RESULT_PATH;",
      "if (!resultPath) throw new Error('missing OPENLOGOS_SMOKE_RESULT_PATH');",
      "mkdirSync(dirname(resultPath), { recursive: true });",
      "appendFileSync(resultPath, JSON.stringify({ id: 'SMOKE-core-01', status: 'pass' }) + '\\n');",
    ].join('\n'));
    writeFileSync(join(root, 'website/scripts/smoke-nested.js'), [
      "import { mkdirSync, appendFileSync } from 'node:fs';",
      "import { dirname } from 'node:path';",
      "const resultPath = process.env.OPENLOGOS_SMOKE_RESULT_PATH;",
      "if (!resultPath) throw new Error('missing OPENLOGOS_SMOKE_RESULT_PATH');",
      "mkdirSync(dirname(resultPath), { recursive: true });",
      "appendFileSync(resultPath, JSON.stringify({ id: 'SMOKE-core-02', status: 'pass' }) + '\\n');",
    ].join('\n'));
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.smoke.command = 'node scripts/run-smoke.js';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    smoke('json');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('PASS');
    expect(parsed.data.summary.executed_count).toBe(2);
    expect(parsed.data.uncovered_cases).not.toContain('SMOKE-core-02');
    expect(parsed.data.diagnostics).toEqual([]);
    expect(readFileSync(join(root, 'logos/resources/verify/smoke-results.jsonl'), 'utf-8')).not.toContain('SMOKE-core-99');
    expect(existsSync(join(root, 'website/logos/resources/verify/smoke-results.jsonl'))).toBe(false);
    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(true);
  });

  it('ST-S19-EX-SMOKE-01: 禁止无 runner 审计时伪造 smoke PASS', () => {
    writeSmokeCases();
    const proposalDir = writeChangedSmokeDelta('deploy-feature', 'SMOKE-core-02');
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
      '{"id":"SMOKE-core-02","status":"pass"}',
    ]);

    expect(() => smoke('json')).toThrow('process.exit(1)');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('FAIL');
    expect(parsed.data.diagnostics.map((d: { code: string }) => d.code)).toContain('smoke_runner_missing');
    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(false);
    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(true);
  });

  it('ST-S19-04: deploy done with smoke_required=false allows archive', () => {
    writeLaunchedModule();
    const proposalDir = join(root, 'logos', 'changes', 'runtime-change');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'runtime-change', module: 'core', createdAt: new Date().toISOString() }),
    );
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：runtime-change',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 影响环境：生产',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：是',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '修改运行时代码。',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    writeSmokeCases();

    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true })).toBe('deploy-done');

    next();
    const out = con.logs.join('\n');
    expect(out).toMatch(/archive/i);
    expect(out).not.toContain('openlogos smoke');
  });

  it('ST-S19-05: deployment decision conflict blocks smoke transition', () => {
    writeLaunchedModule();
    const proposalDir = join(root, 'logos', 'changes', 'conflict');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'conflict', module: 'core', createdAt: new Date().toISOString() }),
    );
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：conflict',
      '',
      '## 部署影响',
      '- 是否需要部署：否',
      '- 部署原因：仅更新文档，不需要发布运行产物',
      '- 影响环境：无',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：否',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '补充文档。',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    const step = detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true });
    expect(step).toBe('verify-passed');

    next();
    const out = con.logs.join('\n');
    expect(out).toContain('部署决策冲突');
    expect(out).not.toContain('openlogos smoke');
    expect(out).not.toMatch(/archive/i);
  });

  it('ST-S19-EX-2.1: smoke_required=false 时不进入 ready-to-smoke（提示可归档）', () => {
    writeLaunchedModule();
    const proposalDir = join(root, 'logos', 'changes', 'no-smoke');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'no-smoke', module: 'core', createdAt: new Date().toISOString() }),
    );
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：no-smoke',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 影响环境：生产',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：是',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '修改运行时代码。',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');

    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true })).toBe('deploy-done');
    next();
    const out = con.logs.join('\n');
    expect(out).toMatch(/archive/i);
    expect(out).not.toContain('openlogos smoke');
  });

  it('ST-S19-EX-2.2: 部署决策冲突时 smoke 门禁被阻断并提示冲突', () => {
    writeLaunchedModule();
    const proposalDir = join(root, 'logos', 'changes', 'smoke-conflict');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'smoke-conflict', module: 'core', createdAt: new Date().toISOString() }),
    );
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：smoke-conflict',
      '',
      '## 部署影响',
      '- 是否需要部署：否',
      '- 部署原因：仅更新文档，不需要发布运行产物',
      '- 影响环境：无',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：否',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '补充文档。',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    const step = detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true });
    expect(step).toBe('verify-passed');

    next();
    const out = con.logs.join('\n');
    expect(out).toContain('部署决策冲突');
    expect(out).not.toContain('openlogos smoke');
  });

  it('ST-S19-06: 缺少 DEPLOY_DONE 时拒绝 smoke 门禁推进', () => {
    writeLaunchedModule();
    const proposalDir = join(root, 'logos', 'changes', 'need-deploy-marker');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'need-deploy-marker', module: 'core', createdAt: new Date().toISOString() }),
    );
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：need-deploy-marker',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 影响环境：生产',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：是',
      '- 是否需要 smoke：是',
      '',
      '## 变更概述',
      '修改运行时代码。',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);
    writeSmokeCases();
    // 关键前置：[deploy] 已全勾但没有 DEPLOY_DONE marker

    const step = detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true });
    expect(step).not.toBe('ready-to-smoke');

    next();
    const out = con.logs.join('\n');
    // 不建议进入 smoke，提示先完成部署标记（deploy-done）
    expect(out).not.toContain('openlogos smoke');
    expect(out).toMatch(/deploy/i);
    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(false);
  });

  it('ST-S19-07: 重新标记部署完成后旧 smoke 结论失效', async () => {
    writeLaunchedModule();
    const proposalDir = join(root, 'logos', 'changes', 'runtime-change');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'runtime-change', module: 'core', createdAt: new Date().toISOString() }),
    );
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：runtime-change',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 影响环境：生产',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：是',
      '- 是否需要 smoke：是',
      '',
      '## 变更概述',
      '修改运行时代码。',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    writeFileSync(join(proposalDir, 'SMOKE_PASS'), '');
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), '# Deployment Report\n\nok\n');

    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true })).toBe('smoke-passed');

    await deployDone('json', 'staging');

    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(false);
    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true })).toBe('ready-to-smoke');
    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.cleared_smoke_markers).toEqual(['SMOKE_PASS']);
  });
});
