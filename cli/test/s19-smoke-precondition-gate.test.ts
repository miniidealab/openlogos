/**
 * fix-deploy-done-leak-failclosed-selfheal 切片1：
 * smoke 前置 fail-closed 校验（S19 §2.67.1）——四项前置的判定顺序与错误码、
 * 拒绝时的零副作用、补救命令提示，以及前置满足时的零回归。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { smoke } from '../src/commands/smoke.js';
import { deployDone } from '../src/commands/deploy-done.js';

const DEPLOY_PROPOSAL = [
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
].join('\n');

const NO_SMOKE_PROPOSAL = DEPLOY_PROPOSAL.replace('- 是否需要 smoke：是', '- 是否需要 smoke：否');

const DEPLOY_TASKS = [
  '# 实现任务',
  '',
  '## [code] 代码实现',
  '- [x] 修改运行时代码',
  '',
  '## [deploy] 部署任务',
  '- [ ] 发布 npm 包',
].join('\n');

const DEPLOY_TASKS_DONE = DEPLOY_TASKS.replace('- [ ] 发布 npm 包', '- [x] 发布 npm 包');

let root: string;
let cleanup: () => void;
let restoreCwd: () => void;
let con: ReturnType<typeof captureConsole>;
let exitSpy: ReturnType<typeof mockProcessExit>;

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }, { lineWidth: 0 }));
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

function setupProposal(opts: {
  slug?: string;
  proposal?: string;
  tasks?: string;
  verifyPass?: boolean;
  deployDone?: boolean;
} = {}) {
  const slug = opts.slug ?? 'deploy-feature';
  const proposalDir = join(root, 'logos', 'changes', slug);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({
    activeChange: slug, module: 'core', createdAt: new Date().toISOString(),
  }));
  writeFileSync(join(proposalDir, 'proposal.md'), opts.proposal ?? DEPLOY_PROPOSAL);
  writeFileSync(join(proposalDir, 'tasks.md'), opts.tasks ?? DEPLOY_TASKS);
  if (opts.verifyPass !== false) writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
  if (opts.deployDone) writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
  return proposalDir;
}

/** 配置一个会留下可观察副作用的 smoke.command，用于证明拒绝时它从未被执行。 */
function configureSmokeCommand(marker = 'smoke-command-ran.txt') {
  const configPath = join(root, 'logos', 'logos.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  config.smoke = { command: `node -e "require('fs').writeFileSync('${marker}','ran')"` };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return join(root, marker);
}

function markerSnapshot(proposalDir: string): string[] {
  return readdirSync(proposalDir).sort();
}

function runSmoke(format: 'text' | 'json' = 'text'): { code: string; output: string } {
  exitSpy.mockClear();
  try { smoke(format); } catch { /* mockProcessExit throws */ }
  const output = [...con.errors, ...con.logs].join('\n');
  const match = output.match(/SMOKE_[A-Z_]+/);
  return { code: match ? match[0] : '', output };
}

/** 拒绝时的零副作用断言：命令未执行、无 smoke marker/报告/账本新增、marker 集合不变。 */
function expectNoSideEffects(proposalDir: string, before: string[], commandMarker: string) {
  expect(existsSync(commandMarker), 'smoke.command 不得被执行').toBe(false);
  expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(false);
  expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(false);
  expect(existsSync(join(root, 'logos/resources/verify/smoke-report.md'))).toBe(false);
  expect(existsSync(join(root, 'logos/resources/verify/smoke-results.jsonl'))).toBe(false);
  expect(markerSnapshot(proposalDir)).toEqual(before);
}

describe('S19 smoke 前置 fail-closed 校验', () => {
  it('UT-S19-42: 缺 DEPLOY_DONE 时 fail-closed 拒绝且零副作用', () => {
    const proposalDir = setupProposal({ tasks: DEPLOY_TASKS_DONE });
    const commandMarker = configureSmokeCommand();
    const before = markerSnapshot(proposalDir);

    const text = runSmoke('text');
    expect(text.code).toBe('SMOKE_DEPLOY_NOT_DONE');
    expect(text.output).toContain('openlogos deploy-done');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expectNoSideEffects(proposalDir, before, commandMarker);

    // --format json 走通用错误 envelope（stderr）
    con.errors.length = 0; con.logs.length = 0;
    const json = runSmoke('json');
    const envelope = JSON.parse(con.errors[0]);
    expect(envelope.error.code).toBe('SMOKE_DEPLOY_NOT_DONE');
    expect(envelope.error.message).toContain('openlogos deploy-done');
    expect(json.code).toBe('SMOKE_DEPLOY_NOT_DONE');
    expectNoSideEffects(proposalDir, before, commandMarker);
  });

  it('UT-S19-43: [deploy] 未全勾时 fail-closed 拒绝', () => {
    // DEPLOY_DONE 旁路写入，但 [deploy] 仍有未勾条目
    const proposalDir = setupProposal({ deployDone: true, tasks: DEPLOY_TASKS });
    const commandMarker = configureSmokeCommand();
    const before = markerSnapshot(proposalDir);

    const result = runSmoke('text');
    expect(result.code).toBe('SMOKE_DEPLOY_TASKS_INCOMPLETE');
    expect(result.output).toContain('[deploy]');
    expect(result.output).toContain('openlogos deploy-done');
    expectNoSideEffects(proposalDir, before, commandMarker);
  });

  it('UT-S19-44: 判定顺序固定 ①→②→③→④ 且只报第一个错误码', () => {
    // ①：smoke_required=false（同时缺 DEPLOY_DONE、[deploy] 未全勾）→ 只报 SMOKE_NOT_REQUIRED
    const proposalDir = setupProposal({ proposal: NO_SMOKE_PROPOSAL, tasks: DEPLOY_TASKS });
    const commandMarker = configureSmokeCommand();
    const before = markerSnapshot(proposalDir);
    expect(runSmoke('text').code).toBe('SMOKE_NOT_REQUIRED');
    expectNoSideEffects(proposalDir, before, commandMarker);

    // ②：恢复 smoke_required=true 并制造部署决策冲突（proposal 说需部署、tasks 无 [deploy] section）
    con.errors.length = 0; con.logs.length = 0;
    writeFileSync(join(proposalDir, 'proposal.md'), DEPLOY_PROPOSAL);
    writeFileSync(join(proposalDir, 'tasks.md'), ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码'].join('\n'));
    expect(runSmoke('text').code).toBe('SMOKE_DEPLOY_DECISION_CONFLICT');

    // ③：决策一致但缺 DEPLOY_DONE
    con.errors.length = 0; con.logs.length = 0;
    writeFileSync(join(proposalDir, 'tasks.md'), DEPLOY_TASKS_DONE);
    expect(runSmoke('text').code).toBe('SMOKE_DEPLOY_NOT_DONE');

    // ④：补 DEPLOY_DONE 但 [deploy] 未全勾
    con.errors.length = 0; con.logs.length = 0;
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    writeFileSync(join(proposalDir, 'tasks.md'), DEPLOY_TASKS);
    expect(runSmoke('text').code).toBe('SMOKE_DEPLOY_TASKS_INCOMPLETE');
    expect(existsSync(commandMarker), '四种拒绝路径 smoke.command 均不得执行').toBe(false);
  });

  it('ST-S19-20: 缺标拒绝 → deploy-done 补标 → 再次 smoke 进入既有正常路径', async () => {
    const proposalDir = setupProposal({ tasks: DEPLOY_TASKS });
    const commandMarker = configureSmokeCommand();
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), '# Deployment Report\n\nok\n');
    const before = markerSnapshot(proposalDir);

    // ① 缺 DEPLOY_DONE → 拒绝、零副作用
    expect(runSmoke('text').code).toBe('SMOKE_DEPLOY_NOT_DONE');
    expectNoSideEffects(proposalDir, before, commandMarker);

    // ② deploy-done 落标（唯一 writer）：[deploy] 全勾 + DEPLOY_DONE 在场
    con.errors.length = 0; con.logs.length = 0;
    exitSpy.mockClear();
    await deployDone('text');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(true);
    expect(readFileSync(join(proposalDir, 'tasks.md'), 'utf-8')).toContain('- [x] 发布 npm 包');

    // ③ 前置全满足 → 放行进入既有执行路径（smoke.command 真实执行）
    con.errors.length = 0; con.logs.length = 0;
    runSmoke('text');
    expect(existsSync(commandMarker), '前置满足后 smoke.command 应正常执行').toBe(true);
  });

  it('ST-S19-21: --auto standing 授权不跳过前置门', () => {
    // --auto 放行的是「运行 smoke 这个动作」，前置不满足时同样 fail-closed
    const proposalDir = setupProposal({ tasks: DEPLOY_TASKS_DONE });
    const commandMarker = configureSmokeCommand();
    writeFileSync(join(proposalDir, 'GATE_AUTO_PASSED'), 'deliver-entry auto-passed\n');
    const before = markerSnapshot(proposalDir);

    const result = runSmoke('text');
    expect(result.code).toBe('SMOKE_DEPLOY_NOT_DONE');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expectNoSideEffects(proposalDir, before, commandMarker);
  });
});
