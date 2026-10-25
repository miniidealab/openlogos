/**
 * S09 guard 按模块生命周期判定测试——AI 指导文本部分（module-lifecycle-guard，[code] 切片 2）。
 *
 * 覆盖 logos/resources/test/core-S09-test-cases.md「S09 guard 按模块生命周期判定测试」UT-S09-478～UT-S09-480、ST-S09-206～ST-S09-209；
 * 根规范 spec/agents-md.md「混合生命周期项目的变更管理条款生成（module-lifecycle-guard）」、spec/pretooluse-guard.md「SessionStart 提示」。
 *
 * - 「与修改前逐字节相同」的基准为 fixtures/s09-module-instructions-baseline.json：由 0.16.8（adce1e8）的指令生成实现与
 *   SessionStart 脚本对同一输入实测生成（生成器 fixtures/gen-s09-module-instructions-baseline.ts），测试内不复述期望。
 * - guard 判定一律以 init / sync 部署到夹具项目内的托管副本为被测对象；夹具位于 mkdtemp 隔离目录。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { adopt } from '../src/commands/adopt.js';
import { change } from '../src/commands/change.js';
import { createAgentsMd, generatePolicyMdc, init } from '../src/commands/init.js';
import { launch } from '../src/commands/launch.js';
import { sync } from '../src/commands/sync.js';
import { createQoderAgentsInstruction, createWorkBuddyAgentsInstruction, createZCodeAgentsInstruction } from '../src/lib/ai-tool-adapter.js';
import { createCursorAgentsInstruction } from '../src/lib/cursor-adapter.js';
import { readLifecycleView } from '../src/lib/lifecycle-view.js';
import { captureConsole, mockProcessExit } from './helpers.js';
import { cleanEnv, git } from './s09-guard-vcs-fixtures.js';
import { buildMlgProject, type MlgKind } from './s09-module-lifecycle-fixtures.js';
import {
  LOCALES, MLI_BASELINE_FILE, TARGETS, initThenSync, instructionTextMatrix, managedBlock, runSessionStart,
} from './s09-module-instructions-fixtures.js';

const TIMEOUT = 300_000;
const baseline = (JSON.parse(readFileSync(MLI_BASELINE_FILE, 'utf-8')) as { texts: Record<string, string> }).texts;
const FNS = {
  createAgentsMd, generatePolicyMdc, createZCodeAgentsInstruction, createQoderAgentsInstruction,
  createWorkBuddyAgentsInstruction, createCursorAgentsInstruction,
};
const BANS = {
  zh: ['禁止修改任何源代码', '存在任何 launched 模块 → 必须先创建变更提案，再修改任何代码或文档'],
  en: ['modifying source code is FORBIDDEN', 'Any launched module exists** → you MUST create a change proposal'],
};

const roots: string[] = [];
function tmp(prefix = 'openlogos-mli-t-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  roots.push(d);
  return d;
}
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

let consoleCapture: ReturnType<typeof captureConsole>;
beforeEach(() => {
  consoleCapture = captureConsole();
  process.env.OPENLOGOS_CODEX_PERSONAL_HOME = join(tmpdir(), 'openlogos-mli-codex-home');
});
afterEach(() => {
  consoleCapture.restore();
  delete process.env.OPENLOGOS_CODEX_PERSONAL_HOME;
});

function view(kind: MlgKind) {
  return readLifecycleView(buildMlgProject(tmp(), kind));
}

/** mixed 文字的共同断言：豁免小节与 team 范围、提案期不受限、无全局禁令、保留的段落。 */
function expectMixed(text: string, locale: 'zh' | 'en', label: string, paths: boolean) {
  if (locale === 'zh') {
    expect(text, label).toContain('### 按模块生命周期豁免（initial 模块）');
    expect(text, label).toContain('`team`：规格——`logos/resources/**` 下 `team-` 前缀文件');
    expect(text, label).toContain('其他模块有活跃提案时，也不受该提案范围限制');
    expect(text, label).toContain(paths ? '代码——`team/**`' : '代码仍需提案（未声明 `paths`）');
    expect(text, label).toContain('**禁止修改 launched 模块文件、共享配置与未归属文件**');
    expect(text, label).toContain('保护范围配置');
  } else {
    expect(text, label).toContain('### Module Lifecycle Exemption (initial modules)');
    expect(text, label).toContain('files prefixed `team-` under `logos/resources/**`');
    expect(text, label).toContain("not limited by another module's active proposal");
    expect(text, label).toContain(paths ? 'code — `team/**`' : 'code still requires a proposal');
    expect(text, label).toContain('Protection scope');
  }
  for (const ban of BANS[locale]) expect(text, `${label} 不得含全局禁令：${ban}`).not.toContain(ban);
}

/** 夹具项目内托管 guard-check 的一次 PreToolUse 判定。 */
function guard(root: string, tool: string, input: Record<string, unknown>, id = `t-${Math.random()}`) {
  const r = spawnSync('bash', [join(root, '.claude/openlogos/bin/guard-check')], {
    input: JSON.stringify({ tool_name: tool, tool_input: input, tool_use_id: id, permission_mode: 'default', hook_event_name: 'PreToolUse', session_id: 's' }),
    cwd: root, encoding: 'utf-8', timeout: 60_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: root }),
  });
  return { exit: r.status ?? 1, stdout: r.stdout ?? '' };
}
function postCheck(root: string, command: string, id: string) {
  const r = spawnSync(process.execPath, [join(root, '.claude/openlogos/bin/guard-post-check.cjs'), 'check'], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: id, session_id: 's', tool_response: { stdout: '', stderr: '' } }),
    cwd: root, encoding: 'utf-8', timeout: 60_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: root }),
  });
  return r.status ?? 1;
}
const W = (file: string): [string, Record<string, unknown>] => ['Write', { file_path: file, content: 'x' }];
function commit(root: string) {
  for (const args of [['init', '-q'], ['config', 'user.name', 't'], ['config', 'user.email', 't@example.invalid'], ['config', 'commit.gpgsign', 'false'], ['add', '-A'], ['commit', '-qm', 'init']]) {
    const r = git(root, args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}：${r.stderr}`);
  }
}
/** M-repo 的业务文件（init 不会生成它们）。 */
function addFiles(root: string) {
  for (const [rel, body] of [['src/main.ts', 'x'], ['team/app.ts', 'x'], ['scripts/release.sh', 'x'],
    ['logos/resources/prd/1-product-requirements/team-01-requirements.md', '# t'], ['logos/resources/api/S44-seats.yaml', 'a: 1']]) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), `${body}\n`);
  }
}
function withCwd<T>(root: string, fn: () => T): T {
  const original = process.cwd;
  process.cwd = () => root;
  try { return fn(); } finally { process.cwd = original; }
}

describe('S09 按模块生命周期的 AI 指导文本（module-lifecycle-guard）', () => {
  it('UT-S09-478: SessionStart 按模块提示', () => {
    for (const script of ['phase', 'codex'] as const) {
      const mixed = runSessionStart(script, buildMlgProject(tmp(), 'M-repo'));
      expect(mixed, script).toContain('- team: initial — 按 Phase 推进，无需变更提案；豁免范围：logos/resources/** 下 team- 前缀规格；代码 paths: team/**');
      expect(mixed, script).toContain('- core: launched — 变更须先立案');
      const nopaths = runSessionStart(script, buildMlgProject(tmp(), 'M-nopaths'));
      expect(nopaths, script).toContain('代码仍需提案（未声明 paths）');
    }
    for (const key of Object.keys(baseline).filter(k => k.startsWith('session|'))) {
      const [, script, kind, state] = key.split('|') as ['session', 'phase' | 'codex', MlgKind, string];
      const root = buildMlgProject(tmp(), kind);
      if (state !== 'none') {
        writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'core-x' }));
        mkdirSync(join(root, 'logos/changes/core-x/deltas'), { recursive: true });
        writeFileSync(join(root, 'logos/changes/core-x/proposal.md'), '# 变更提案：core-x\n\n> module: core\n');
        writeFileSync(join(root, 'logos/changes/core-x/tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [ ] 产出 delta\n\n## [code] 代码实现\n- [ ] 单切片\n');
        writeFileSync(join(root, 'logos/changes/core-x/PLAN_APPROVED'), '{}');
      }
      expect(runSessionStart(script, root), key).toBe(baseline[key]);
    }
  }, TIMEOUT);

  it('UT-S09-479: 生命周期视图与 AGENTS.md / CLAUDE.md 托管段', () => {
    expect(view('M-repo')).toEqual({ kind: 'mixed', initialModules: [{ id: 'team', paths: ['team/**'], scenarios: ['S44'] }] });
    expect(view('M-nopaths').kind).toBe('mixed');
    expect(view('A-initial')).toEqual({ kind: 'initial', initialModules: [] });
    expect(view('A-launched')).toEqual({ kind: 'launched', initialModules: [] });
    const broken = buildMlgProject(tmp(), 'M-repo');
    writeFileSync(join(broken, 'logos/logos-project.yaml'), 'modules: [\n  - id: core\n');
    expect(readLifecycleView(broken).kind, 'yaml 不可解析为 initial').toBe('initial');
    // launch 前刷新：按目标模块切换后的状态计算
    const initial = buildMlgProject(tmp(), 'A-initial');
    expect(readLifecycleView(initial, { launched: ['core'] }).kind).toBe('mixed');
    expect(readLifecycleView(initial, { launched: ['core', 'team'] }).kind).toBe('launched');

    const repo = view('M-repo');
    const nopaths = view('M-nopaths');
    for (const tool of [undefined, 'claude-code', 'codex'] as const) {
      for (const target of TARGETS) {
        for (const locale of LOCALES) {
          expectMixed(createAgentsMd(locale, tool, target, repo), locale, `${tool} ${target} ${locale}`, true);
          expectMixed(createAgentsMd(locale, tool, target, nopaths), locale, `${tool} ${target} ${locale} nopaths`, false);
        }
      }
    }
    // initial、launched 视图（含布尔入参）与修改前逐字节相同
    const now = instructionTextMatrix(FNS);
    for (const [key, text] of Object.entries(now)) expect(text, key).toBe(baseline[key]);
    for (const locale of LOCALES) {
      expect(createAgentsMd(locale, 'claude-code', 'claude', view('A-initial'))).toBe(baseline[`agents|claude-code|claude|${locale}|false`]);
      expect(createAgentsMd(locale, 'claude-code', 'claude', view('A-launched'))).toBe(baseline[`agents|claude-code|claude|${locale}|true`]);
    }
  }, TIMEOUT);

  it('UT-S09-480: 宿主指令段、Cursor policy 与各入口取视图', async () => {
    const repo = view('M-repo');
    const nopaths = view('M-nopaths');
    for (const locale of LOCALES) {
      // ① mixed：宿主指令段带同一豁免信息，Cursor policy 按同一规则限定禁令
      for (const tool of ['zcode', 'qoder', 'workbuddy', 'cursor'] as const) {
        const text = createAgentsMd(locale, tool, 'agents', repo);
        expectMixed(text, locale, `${tool} ${locale}`, true);
        expect(text, `${tool} ${locale} 宿主指令段`).toContain(locale === 'zh' ? '当前 lifecycle=mixed' : 'lifecycle=mixed');
        expect(text, `${tool} ${locale} 宿主附注`).toContain(locale === 'zh' ? '混合生命周期：initial 模块 team（规格 team- 前缀；代码 team/**）' : 'Mixed lifecycle: files of initial modules team (specs prefixed team-; code team/**)');
        expect(createAgentsMd(locale, tool, 'agents', nopaths)).toContain(locale === 'zh' ? '代码 代码仍需提案' : 'code code still needs a proposal');
      }
      const policy = generatePolicyMdc(locale, repo);
      expectMixed(policy, locale, `policy ${locale}`, true);
      expect(policy).toContain(locale === 'zh' ? '- 修改 launched 模块文件、共享配置或未归属文件前：' : '- Before modifying launched module files, shared configuration or unattributed files:');
    }
    // ② 各入口经同一 helper：sync 与 init --ai-tool 在混合项目生成 mixed 文字；adopt（单模块 launched）与修改前相同
    const root = tmp();
    const synced = await initThenSync(root, 'M-repo', { init, sync });
    expectMixed(synced.agents, 'zh', 'sync AGENTS.md', true);
    expectMixed(synced.claude, 'zh', 'sync CLAUDE.md', true);
    // init --ai-tool（为已初始化项目补宿主）同样按视图重写；宿主指令段只在单宿主配置下生成（既有行为），此处只断言 mixed 文字
    await withCwd(root, () => init(undefined, { aiTool: 'cursor' }));
    expectMixed(managedBlock(join(root, 'AGENTS.md')), 'zh', 'init --ai-tool cursor', true);
    expectMixed(managedBlock(join(root, 'CLAUDE.md')), 'zh', 'init --ai-tool cursor CLAUDE.md', true);
    const adopted = tmp();
    await withCwd(adopted, () => adopt('demo', { locale: 'zh', aiTool: 'claude-code' }));
    expect(managedBlock(join(adopted, 'CLAUDE.md'))).toContain(createAgentsMd('zh', 'claude-code', 'claude', true).trim());
    // ③ launch：A-initial 上 launch core → mixed；再 launch team → launched（与修改前全 launched 相同）
    const exitSpy = mockProcessExit();
    try {
      const proj = tmp();
      const r = await initThenSync(proj, 'A-initial', { init, sync });
      expect(r.agents).toBe(baseline['sync|A-initial|agents']);
      writeLaunchEvidence(proj);
      withCwd(proj, () => launch('core'));
      expectMixed(managedBlock(join(proj, 'AGENTS.md')), 'zh', 'launch core', true);
      withCwd(proj, () => launch('team'));
      expect(managedBlock(join(proj, 'AGENTS.md'))).toBe(baseline['sync|A-launched|agents']);
      expect(managedBlock(join(proj, 'CLAUDE.md'))).toBe(baseline['sync|A-launched|claude']);
    } finally {
      exitSpy.mockRestore();
    }
  }, TIMEOUT);

  it('ST-S09-206: 无活跃提案——sync 后指令与 hook 同口径', async () => {
    const root = tmp();
    const r = await initThenSync(root, 'M-repo', { init, sync });
    expectMixed(r.agents, 'zh', 'AGENTS.md', true);
    expectMixed(r.claude, 'zh', 'CLAUDE.md', true);
    addFiles(root);
    commit(root);
    const decisions = [
      W('logos/resources/prd/1-product-requirements/team-01-requirements.md'), W('team/app.ts'), W('src/main.ts'), W('scripts/release.sh'),
    ].map(([tool, input]) => guard(root, tool, input).exit);
    expect(decisions).toEqual([0, 0, 2, 2]);
    const id = 'st206-post';
    const cmd = "node -e \"require('fs').writeFileSync('team/b.ts','x')\"";
    expect(guard(root, 'Bash', { command: cmd }, id).exit).toBe(0);
    spawnSync(process.execPath, ['-e', "require('fs').writeFileSync('team/b.ts','x')"], { cwd: root });
    expect(postCheck(root, cmd, id)).toBe(0);
    expect(existsSync(join(root, 'logos/.openlogos-runtime/pending-reports.jsonl'))
      ? readFileSync(join(root, 'logos/.openlogos-runtime/pending-reports.jsonl'), 'utf-8').trim() : '').toBe('');
  }, TIMEOUT);

  it('ST-S09-207: core 有活跃提案——initial 模块独立推进', async () => {
    const root = tmp();
    await initThenSync(root, 'M-repo', { init, sync });
    addFiles(root);
    commit(root);
    const exitSpy = mockProcessExit();
    try {
      withCwd(root, () => change('core-x', 'core'));
      withCwd(root, () => sync());
    } finally {
      exitSpy.mockRestore();
    }
    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
      const block = managedBlock(join(root, file));
      expectMixed(block, 'zh', file, true);
      expect(block).toContain('- **有 guard 文件** → launched 模块文件、共享配置与未归属文件可以修改，但 **只能在该提案范围内** 修改');
    }
    const delta = W('logos/changes/core-x/deltas/prd/1-product-requirements/core-01-requirements.md');
    expect(guard(root, ...W('team/app.ts')).exit, 'plan 阶段 team').toBe(0);
    expect(guard(root, ...W('src/main.ts')).exit, 'plan 阶段 src/main.ts（Claude 提案期不收窄非 delta 路径）').toBe(0);
    expect(guard(root, ...delta).exit, 'plan 阶段非原型 delta 仍被收窄').toBe(2);
    writeFileSync(join(root, 'logos/changes/core-x/PLAN_APPROVED'), '{}');
    expect(guard(root, ...W('team/app.ts')).exit, 'delta-writing team').toBe(0);
    expect(guard(root, ...W('src/main.ts')).exit, 'delta-writing src/main.ts').toBe(0);
    const id = 'st207-post';
    expect(guard(root, 'Bash', { command: 'echo x > team/c.ts' }, id).exit).toBe(0);
    writeFileSync(join(root, 'team/c.ts'), 'x\n');
    expect(postCheck(root, 'echo x > team/c.ts', id)).toBe(0);
  }, TIMEOUT);

  it('ST-S09-208: launch 切换下指令与 hook 随视图变化', async () => {
    const root = tmp();
    const r = await initThenSync(root, 'A-initial', { init, sync });
    expect(r.agents, '① 全 initial 与修改前相同').toBe(baseline['sync|A-initial|agents']);
    expect(r.claude).toBe(baseline['sync|A-initial|claude']);
    addFiles(root);
    writeLaunchEvidence(root);
    const exitSpy = mockProcessExit();
    try {
      withCwd(root, () => launch('core'));
      expectMixed(managedBlock(join(root, 'AGENTS.md')), 'zh', '② launch core', true);
      expect(guard(root, ...W('team/app.ts')).exit, '② team/app.ts').toBe(0);
      expect(guard(root, ...W('src/main.ts')).exit, '② src/main.ts').toBe(2);
      withCwd(root, () => launch('team'));
    } finally {
      exitSpy.mockRestore();
    }
    expect(managedBlock(join(root, 'AGENTS.md')), '③ 全 launched 与修改前相同').toBe(baseline['sync|A-launched|agents']);
    expect(managedBlock(join(root, 'CLAUDE.md'))).toBe(baseline['sync|A-launched|claude']);
    expect(guard(root, ...W('team/app.ts')).exit, '③ team/app.ts').toBe(2);
  }, TIMEOUT);

  it('ST-S09-209: 五个宿主一致', async () => {
    const root = tmp();
    const r = await initThenSync(root, 'M-repo', { init, sync }, 'all');
    expectMixed(r.agents, 'zh', 'AGENTS.md（all）', true);
    // ② 宿主指令段只在单宿主配置下生成（既有行为）：逐宿主以单宿主配置 init + sync 后读回
    for (const [tool, host] of [['zcode', 'ZCode'], ['qoder', 'Qoder'], ['workbuddy', 'WorkBuddy'], ['cursor', 'Cursor']]) {
      const single = await initThenSync(tmp(), 'M-repo', { init, sync }, tool);
      const at = single.agents.indexOf(`## ${host} 宿主指令`);
      expect(at, `${host} 宿主指令段`).toBeGreaterThan(0);
      expect(single.agents.slice(at, single.agents.indexOf('\n\n', at + 20)), host).toContain('混合生命周期：initial 模块 team');
      expectMixed(single.agents, 'zh', `${host} AGENTS.md`, true);
    }
    addFiles(root);
    commit(root);
    const runtimes: Record<string, string> = {
      cursor: join(root, '.cursor/hooks/openlogos-runtime.cjs'),
      qoder: join(root, '.qoder/plugins/openlogos/hooks/runtime.cjs'),
      workbuddy: join(root, '.workbuddy/plugins/openlogos/hooks/runtime.cjs'),
      zcode: join(root, '.zcode/plugins/openlogos/runtime/hook-runtime.js'),
    };
    for (const file of Object.values(runtimes)) expect(existsSync(file), file).toBe(true);
    const matrix = ['logos/resources/prd/1-product-requirements/team-01-requirements.md', 'team/app.ts', 'logos/resources/api/S44-seats.yaml',
      'src/main.ts', 'scripts/release.sh'];
    for (const file of matrix) {
      const claude = guard(root, ...W(file)).exit;
      for (const [host, entry] of Object.entries(runtimes)) {
        const isCursor = host === 'cursor';
        const event = isCursor
          ? { hook_event_name: 'afterFileEdit', file_path: file, cwd: root, conversation_id: 'c' }
          : { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, cwd: root };
        const out = spawnSync(process.execPath, [entry, isCursor ? 'edit' : 'guard'], { input: JSON.stringify(event), cwd: root, encoding: 'utf-8', env: cleanEnv() });
        const got = isCursor ? (out.stdout.includes('outside allowed scope') ? 2 : 0) : out.status;
        expect(got, `${host} ${file}`).toBe(claude);
      }
    }
  }, TIMEOUT);
});

function writeLaunchEvidence(root: string) {
  const verify = join(root, 'logos', 'resources', 'verify');
  mkdirSync(verify, { recursive: true });
  writeFileSync(join(verify, 'acceptance-report.md'), '# 验收\nPASS\n');
  writeFileSync(join(verify, 'deployment-report.md'), '# 部署\n');
  writeFileSync(join(verify, 'smoke-report.md'), '# Smoke\nPASS\n');
  // module-scoped-phase-reports：多模块项目的 initial 模块 launch 只认本模块报告（功能规格 §2.99.8）
  for (const id of ['core', 'team']) {
    const summary = (gate: string) => `## Summary\n\n| Metric | Value |\n|--------|-------|\n| Module | ${id} |\n| **${gate}** | **PASS** |\n`;
    writeFileSync(join(verify, `${id}-acceptance-report.md`), `# Acceptance Report\n\n${summary('Gate 3.5')}`);
    writeFileSync(join(verify, `${id}-deployment-report.md`), '# Deployment Report\n\n- deploy_id: d1\n');
    writeFileSync(join(verify, `${id}-smoke-report.md`), `# Smoke Report\n\n${summary('Gate 3.8')}`);
  }
}
