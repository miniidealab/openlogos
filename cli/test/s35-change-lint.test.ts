/**
 * S35 — change-lint 提案计划产物左移硬检查（change-lint-shift-left）。
 * 用例 ID 与 logos/resources/test/core-S35-test-cases.md 严格对齐（UT-S35-01..25 / ST-S35-01..06）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, statSync, symlinkSync, chmodSync,
  lstatSync, readlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  parseTestCaseIds, extractStructuredTestIds, classifyTestEvidenceStage, evaluateTestIdEvidence,
  hasRealTestIdsForProposal, parseReuseDeclaration, detectProposalStep,
} from '../src/lib/proposal-lifecycle.js';
import {
  validateMarkdownDelta, classifyProposalDeltas, resolveProposalModuleContext, readProposalModuleHeader,
  isDangerousSlug, CHANGE_LINT_VIOLATION_CODES,
} from '../src/lib/change-lint.js';
import { evaluateUiPrototype, writeUiPrototypeHashes } from '../src/commands/check-ui-prototype.js';
import { changeLint } from '../src/commands/change-lint.js';
import { merge, scanDeltas } from '../src/commands/merge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CLI_ROOT = join(REPO_ROOT, 'cli');

// ── F12（r4）：真实 CLI 入口（argv 解析 → 命令分派 → 进程流与退出码）——dist 由 Vitest
// globalSetup（test/global-setup.ts）在任何 worker 启动前串行构建一次，此处只读既有 dist；
// 严禁在 worker 内再跑 tsc：多测试文件并发编译同一 outDir 会加载到半成品模块 ──
function realCliEntry(): string {
  return join(CLI_ROOT, 'dist', 'index.js');
}
function spawnCli(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [realCliEntry(), ...args], { cwd, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

// ── fixture 构造 ──

interface ProposalOpts {
  module?: string | null;
  codeRequired?: boolean;
  deploy?: '是' | '否';
  reuseLines?: string[];
  uiDeclYaml?: string | null; // null = 无声明段；string = fenced YAML 原文
  extra?: string;
}

function proposalMd(o: ProposalOpts = {}): string {
  const lines = ['# 变更提案：feat', ''];
  if (o.module !== null) lines.push(`> module: ${o.module ?? 'core'}`, '');
  lines.push(
    '## 变更原因', '需要新能力。', '',
    '## 变更类型', o.codeRequired === false ? '设计级' : '代码级修复', '',
    '## 变更范围', '- 影响的功能规格：core-01', '',
    '## 部署影响',
    `- 是否需要部署：${o.deploy ?? '否'}`, '- 部署原因：说明', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', `- 是否需要 smoke：${o.deploy ?? '否'}`, '',
    '## 变更概述', o.codeRequired === false ? '纯文档更新，无需代码。' : '需要 CLI 代码、测试和 reporter 实现。',
  );
  if (o.reuseLines) lines.push('', '## 复用测试 ID', '', ...o.reuseLines);
  if (o.uiDeclYaml !== undefined && o.uiDeclYaml !== null) {
    lines.push('', '## UI/UX 变更声明', '', '```yaml', o.uiDeclYaml, '```');
  }
  if (o.extra) lines.push('', o.extra);
  return lines.join('\n');
}

interface SetupOpts {
  proposal?: string;
  tasks?: string;
  markers?: string[];
  productType?: string;
  slug?: string;
  guard?: boolean | { activeChange: string; module: string };
  mergedTestIds?: string[];
}

function setup(o: SetupOpts = {}): { root: string; dir: string; slug: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  const slug = o.slug ?? 'feat';
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', product_type: o.productType ?? 'cli' }],
  }, { lineWidth: 0 }));
  if (o.guard !== false) {
    const g = typeof o.guard === 'object' ? o.guard : { activeChange: slug, module: 'core' };
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ ...g, createdAt: '2026-07-01T00:00:00.000Z' }));
  }
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), o.proposal ?? proposalMd());
  writeFileSync(join(dir, 'tasks.md'), o.tasks ?? '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/test/` — 新增用例\n\n## [code] 代码实现\n');
  for (const mk of o.markers ?? []) writeFileSync(join(dir, mk), '');
  if (o.mergedTestIds) {
    writeFileSync(join(root, 'logos', 'resources', 'test', 'core-S99-test-cases.md'),
      ['| ID | 用例 |', '|---|---|', ...o.mergedTestIds.map(id => `| ${id} | 回归 |`)].join('\n'));
  }
  return { root, dir, slug };
}

function runLint(root: string, slugArg?: string, format: 'text' | 'json' = 'text'): { code: number; logs: string[]; errors: string[] } {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  let code = -1;
  try {
    changeLint(slugArg, format);
  } catch (e) {
    const m = /process\.exit\((\d+)\)/.exec(String(e));
    code = m ? Number(m[1]) : -1;
  } finally {
    cap.restore(); ex.mockRestore(); restore();
  }
  return { code, logs: cap.logs, errors: cap.errors };
}

function lintViolations(root: string, slugArg?: string): { code: number; violations: any[] } {
  const r = runLint(root, slugArg, 'json');
  const envelope = JSON.parse(r.logs[r.logs.length - 1]);
  return { code: r.code, violations: envelope.data.violations };
}

function codesOf(vs: any[]): string[] { return vs.map(v => v.code); }

/** code-r2 F17：lstat 全类型快照——目录自身（覆盖空目录）、symlink（记 link target、不跟随）、普通文件记 hash。 */
function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = full.slice(root.length);
      const lst = lstatSync(full);
      if (lst.isSymbolicLink()) { out.set(rel, `symlink:${readlinkSync(full)}`); continue; }
      if (lst.isDirectory()) { out.set(rel, 'dir'); walk(full); continue; }
      if (lst.isFile()) { out.set(rel, createHash('sha256').update(readFileSync(full)).digest('hex')); continue; }
      out.set(rel, 'other');
    }
  };
  walk(root);
  return out;
}

const VALID_UI_DECL = ['ui_impact: false', 'design_system_mode: generated', 'design_system_fallback_reason: ""', 'pages: []'].join('\n');

/* ========== UT — L1/L2 ========== */

describe('S35 — L1/L2 结构检查', () => {
  it('UT-S35-01: L1 正例——tasks.md 含 ## [delta] 标题无 L1 违规', () => {
    const { root } = setup({ proposal: proposalMd({ codeRequired: false }) });
    const { violations } = lintViolations(root);
    expect(codesOf(violations)).not.toContain('tasks_sections_unparsable');
  });

  it('UT-S35-02: L1 反例——tasks.md 无任何 ## [tag] 标题 → tasks_sections_unparsable', () => {
    const { root } = setup({ proposal: proposalMd({ codeRequired: false }), tasks: '# 任务\n- [ ] 旧格式任务' });
    const { code, violations } = lintViolations(root);
    expect(codesOf(violations)).toContain('tasks_sections_unparsable');
    expect(code).toBe(2);
  });

  it('UT-S35-03: L2 正例——code_required 提案含空 ## [code] 标题（占位说明）合法', () => {
    const { root } = setup({ tasks: '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/test/`\n\n## [code] 代码实现\n（占位说明）' });
    const { violations } = lintViolations(root);
    expect(codesOf(violations)).not.toContain('tasks_code_header_missing');
  });

  it('UT-S35-04: L2 反例——code_required 缺 ## [code] 标题 → tasks_code_header_missing + flow_reason string', () => {
    const { root } = setup({ tasks: '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/test/`' });
    const { violations } = lintViolations(root);
    const v = violations.find(x => x.code === 'tasks_code_header_missing');
    expect(v).toBeDefined();
    expect(typeof v.flow_reason).toBe('string');
    expect(v.flow_reason).toBe('tasks-code-section-missing');
  });
});

/* ========== UT — L3 分阶段测试证据 ========== */

describe('S35 — L3 分阶段测试证据模型', () => {
  it('UT-S35-05: plan 级证据 a——[delta] 未全勾且规划 deltas/test/ 目标 → 无 L3 违规', () => {
    const { root } = setup(); // 默认 tasks：[delta] 未勾、目标含 deltas/test/
    const { violations } = lintViolations(root);
    expect(codesOf(violations)).not.toContain('code_change_requires_real_test_ids');
  });

  it('UT-S35-06: 复用声明正例——固定语法且 ID 均存在于已合并规格 → 无 L3 违规', () => {
    const reuseLines = ['- UT-S09-02 — 覆盖 unknown 目录忽略回归', '- ST-S30-04 — 覆盖 cmd-gate 端到端路径', '- SMOKE-core-12 — 覆盖部署后命令可见性'];
    const { root } = setup({
      proposal: proposalMd({ reuseLines }),
      tasks: '# 任务\n\n## [code] 代码实现\n',
      mergedTestIds: ['UT-S09-02', 'ST-S30-04', 'SMOKE-core-12'],
    });
    const { violations } = lintViolations(root);
    expect(codesOf(violations)).not.toContain('code_change_requires_real_test_ids');
    // parseReuseDeclaration 固定语法解析细粒度（F16：并入本用例保持 ID 一对一）
    const merged = new Set(['UT-S09-02', 'ST-S30-04', 'SMOKE-core-12']);
    const r = parseReuseDeclaration(proposalMd({ reuseLines }), merged);
    expect(r.present).toBe(true);
    expect(r.allValid).toBe(true);
    expect(r.validIds).toEqual(['UT-S09-02', 'ST-S30-04', 'SMOKE-core-12']);
    // code-r1 F11：围栏内的复用声明示例不构成权威声明
    const fenced = '# 提案\n\n```markdown\n## 复用测试 ID\n\n- UT-S09-02 — 示例\n```\n\n## 变更概述\n需要代码。';
    expect(parseReuseDeclaration(fenced, merged).present).toBe(false);
    // code-r2 F11：HTML 注释中的复用声明（含注释内后续标题）同样不构成权威声明
    const commented = '# 提案\n\n<!--\n## 复用测试 ID\n\n- UT-S09-02 — 注释示例\n\n## 注释内下一标题\n-->\n\n## 变更概述\n需要代码。';
    expect(parseReuseDeclaration(commented, merged).present).toBe(false);
    // F11：声明段内非列表正文行 → syntax 诊断（不静默跳过）
    const prose = '## 复用测试 ID\n\n- UT-S09-02 — 合法\n这是一行散文说明。\n';
    const pr = parseReuseDeclaration(prose, merged);
    expect(pr.entries.some(e => e.problem === 'syntax' && e.line === '这是一行散文说明。')).toBe(true);
    expect(pr.allValid).toBe(false);
  });

  it('UT-S35-07: 占位尾段反例——UT-S99-xx / ST-S99-TBD / SMOKE-core-TODO（含尾随点号变体）不计入真实 ID', { timeout: 120_000 }, () => {
    expect(parseTestCaseIds('UT-S99-xx ST-S99-TBD SMOKE-core-TODO UT-S99-XX UT-S99-NN')).toEqual([]);
    const { root } = setup({
      proposal: proposalMd({ extra: '计划：UT-S99-xx、ST-S99-TBD、SMOKE-core-TODO' }),
      tasks: '# 任务\n\n## [code] 代码实现\n',
    });
    const { violations, code } = lintViolations(root);
    expect(codesOf(violations)).toContain('code_change_requires_real_test_ids');
    expect(code).toBe(2);
    // r4 F20：尾随点号不得绕过占位黑名单——parser 剥除句末点号后照常拒绝，前缀不采信
    expect(parseTestCaseIds('UT-S99-xx. ST-S99-TBD. SMOKE-core-NN.')).toEqual([]);
    // 首尾点号是边界标点：合法 ID 不因句末点号丢失；内部点号（段内分隔）照常合法；空 dot 段拒绝
    expect(parseTestCaseIds('见 UT-S09-02.')).toEqual(['UT-S09-02']);
    expect(parseTestCaseIds('UT-S09-02.1 含合法内部点号')).toEqual(['UT-S09-02.1']);
    expect(parseTestCaseIds('UT-S09-02..3 空 dot 段')).toEqual([]);
    // 结构化表格首列同判：尾随点号候选不构成结构化 ID（extractStructuredTestIds 同源拒绝）
    const dottedTable = '| ID | 用例 |\n|---|---|\n| UT-S99-xx. | 占位 |\n| ST-S99-TBD. | 占位 |\n| SMOKE-core-NN. | 占位 |';
    expect(extractStructuredTestIds(dottedTable)).toEqual([]);
    // spec-complete 真实 CLI：[delta] 全勾且唯一测试 delta 的结构化 ID 行为 `UT-S99-xx.` → 必须红
    const sc = setup({
      tasks: '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta 到 `deltas/test/core-S99-test-cases.md` — 新增用例\n\n## [code] 代码实现\n',
    });
    mkdirSync(join(sc.dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(sc.dir, 'deltas', 'test', 'core-S99-test-cases.md'),
      '## ADDED — 用例\n\n| ID | 用例 |\n|---|---|\n| UT-S99-xx. | 占位 |');
    const rsc = spawnCli(sc.root, ['change-lint', '--format', 'json']);
    expect(rsc.status).toBe(2);
    const esc = JSON.parse(rsc.stdout.trim());
    expect(esc.data.pass).toBe(false);
    expect(esc.data.violations.map((v: { code: string }) => v.code)).toContain('code_change_requires_real_test_ids');
  });

  it('UT-S35-08: 通配族名反例——UT-S35-* / ST-S35-? / SMOKE-core-[case] 整串候选拒绝、前缀不采信', () => {
    expect(parseTestCaseIds('UT-S35-*')).toEqual([]);
    expect(parseTestCaseIds('ST-S35-?')).toEqual([]);
    expect(parseTestCaseIds('SMOKE-core-[case]')).toEqual([]);
    expect(parseTestCaseIds('合法 UT-S09-02 与通配 UT-S35-* 并存')).toEqual(['UT-S09-02']);
  });

  it('UT-S35-09: 复用声明反例——逐项各报一条 violation（message 含该行原文），小节整体不判过', () => {
    const reuseLines = [
      '- UT-S09-02 — 合法且存在（此行判过）',
      '- UT-S99-99 — 语法合法但规格中不存在（violation：ID 不存在）',
      '- UT-S09-02 — 与首行重复（violation：重复项）',
      '- 请复用登录相关的那几个用例 — 无 ID 的散文行（violation：语法非法）',
      '- UT-S35-* — 通配族名（violation：文法拒绝）',
    ];
    const { root } = setup({
      proposal: proposalMd({ reuseLines }),
      tasks: '# 任务\n\n## [code] 代码实现\n',
      mergedTestIds: ['UT-S09-02'],
    });
    const { violations } = lintViolations(root);
    const l3OnProposal = violations.filter(v => v.code === 'code_change_requires_real_test_ids' && v.path.endsWith('proposal.md'));
    expect(l3OnProposal.length).toBe(4); // 不存在 / 重复 / 散文 / 通配 各一条
    expect(l3OnProposal.map(v => v.message).join('\n')).toContain('UT-S99-99');
    expect(l3OnProposal.map(v => v.message).join('\n')).toContain('请复用登录相关的那几个用例');
    // 小节整体不判过 → 合法项不构成证据 → 还有一条 no-evidence violation（tasks.md）
    expect(violations.some(v => v.code === 'code_change_requires_real_test_ids' && v.path.endsWith('tasks.md'))).toBe(true);
  });

  it('UT-S35-09a: 阶段边界五夹具——plan / plan / spec-complete 违规 / 非 delta checkbox 不降级 / slice 同 flow-derive', () => {
    // ① 刚写完 tasks（[delta] 规划 deltas/test/，未勾）→ plan 级过
    const f1 = setup();
    expect(classifyTestEvidenceStage(f1.dir)).toBe('plan');
    expect(evaluateTestIdEvidence(f1.dir).evidenceOk).toBe(true);
    // ② 部分 delta 勾选 → plan 级仍适用
    const f2 = setup({ tasks: '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta 到 `deltas/prd/`\n- [ ] 产出 delta 到 `deltas/test/`\n\n## [code] 代码实现\n' });
    expect(classifyTestEvidenceStage(f2.dir)).toBe('plan');
    expect(evaluateTestIdEvidence(f2.dir).evidenceOk).toBe(true);
    // ③ 全部勾选但 deltas/test/ 文件缺失 → spec-complete 级违规（plan 证据不得沿用）
    const f3 = setup({ tasks: '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta 到 `deltas/test/`\n\n## [code] 代码实现\n' });
    expect(classifyTestEvidenceStage(f3.dir)).toBe('spec-complete');
    expect(evaluateTestIdEvidence(f3.dir).evidenceOk).toBe(false);
    // ④ 全部 delta 产出条目勾选 + 一条未勾非 delta 元数据 checkbox → 仍 spec-complete 并真实读取测试 delta
    const f4 = setup({ tasks: '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta 到 `deltas/test/`\n- [ ] merge 时同步更新 logos-project.yaml 元数据\n\n## [code] 代码实现\n' });
    mkdirSync(join(f4.dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(f4.dir, 'deltas', 'test', 'core-S99-test-cases.md'), '| ID | 用例 |\n|---|---|\n| UT-S99-01 | 新增 |');
    expect(classifyTestEvidenceStage(f4.dir)).toBe('spec-complete');
    expect(evaluateTestIdEvidence(f4.dir).evidenceOk).toBe(true);
    // ⑤ SPEC_MERGED 在场 → slice 级，与 flow-derive 同结论
    const f5 = setup({ markers: ['SPEC_MERGED'], tasks: '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta 到 `deltas/test/`\n\n## [code] 代码实现\n' });
    mkdirSync(join(f5.dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(f5.dir, 'deltas', 'test', 'core-S99-test-cases.md'), '| ID | 用例 |\n|---|---|\n| UT-S99-01 | 新增 |');
    writeFileSync(join(f5.root, 'logos', 'resources', 'test', 'core-S99-test-cases.md'), '| ID | 用例 |\n|---|---|\n| UT-S99-01 | 新增 |');
    expect(classifyTestEvidenceStage(f5.dir)).toBe('slice');
    expect(evaluateTestIdEvidence(f5.dir).evidenceOk).toBe(true);
    expect(hasRealTestIdsForProposal(f5.dir)).toBe(true);
  });

  it('UT-S35-09b: slice 级 proposal-scoped 负例——全局无关 ID 不构成本提案证据（lint 与 flow-derive 同断言）', () => {
    const { root, dir } = setup({
      markers: ['SPEC_MERGED'],
      tasks: '# 任务\n\n## [code] 代码实现\n',
      mergedTestIds: ['UT-S01-01', 'UT-S09-02', 'ST-S30-04', 'SMOKE-core-12'], // 全局大量真实 ID
    });
    expect(evaluateTestIdEvidence(dir).evidenceOk).toBe(false);
    expect(hasRealTestIdsForProposal(dir)).toBe(false);
    const { violations } = lintViolations(root);
    expect(codesOf(violations)).toContain('code_change_requires_real_test_ids');
    // code-r1 F6：被 L6 明确忽略的隐藏测试 delta（含合法表格）不得贡献证据
    const hidden = setup({ markers: ['SPEC_MERGED'], tasks: '# 任务\n\n## [code] 代码实现\n' });
    mkdirSync(join(hidden.dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(hidden.dir, 'deltas', 'test', '.hidden.md'), '| ID | 用例 |\n|---|---|\n| UT-S99-77 | 隐藏 |');
    writeFileSync(join(hidden.root, 'logos', 'resources', 'test', '.hidden.md'), '| ID | 用例 |\n|---|---|\n| UT-S99-77 | 隐藏 |');
    expect(evaluateTestIdEvidence(hidden.dir).evidenceOk).toBe(false);
    expect(codesOf(lintViolations(hidden.root).violations)).toContain('code_change_requires_real_test_ids');
    // .gitkeep 同理不贡献证据
    const keep = setup({ markers: ['SPEC_MERGED'], tasks: '# 任务\n\n## [code] 代码实现\n' });
    mkdirSync(join(keep.dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(keep.dir, 'deltas', 'test', '.gitkeep'), '');
    expect(evaluateTestIdEvidence(keep.dir).evidenceOk).toBe(false);
  });

  it('UT-S35-09c: 存在性 = 结构化 ID 列——散文/围栏示例/孤立 pipe 行均不构成存在性', () => {
    const { root, dir } = setup({
      proposal: proposalMd({ reuseLines: ['- UT-S88-05 — 覆盖既有回归'] }),
      tasks: '# 任务\n\n## [code] 代码实现\n',
    });
    writeFileSync(join(root, 'logos', 'resources', 'test', 'core-S88-test-cases.md'),
      '# 说明\n\n覆盖清单提及 UT-S88-05 但没有任何表格结构化 ID 列。');
    const reuse = evaluateTestIdEvidence(dir).reuse;
    expect(reuse.entries[0].problem).toBe('not-found');
    const { violations } = lintViolations(root);
    expect(violations.some(v => v.code === 'code_change_requires_real_test_ids' && v.message.includes('UT-S88-05'))).toBe(true);
    // extractStructuredTestIds 细粒度（含 code-r1 F5 反例）：
    // 真实表格块（表头+delimiter+数据行）才计入
    expect(extractStructuredTestIds('| ID | 用例 |\n|---|---|\n| UT-S01-02 | 表格 |')).toEqual(['UT-S01-02']);
    // 散文 token 不计
    expect(extractStructuredTestIds('散文提及 UT-S01-01。')).toEqual([]);
    // 孤立 pipe 行（无表头/delimiter）不计
    expect(extractStructuredTestIds('| UT-FAKE-02 | 不是表格 |')).toEqual([]);
    // 代码围栏内的表格示例（~~~ 与 ``` 两种围栏）不计
    expect(extractStructuredTestIds('~~~markdown\n| ID | 用例 |\n|---|---|\n| UT-FAKE-01 | 仅示例 |\n~~~')).toEqual([]);
    expect(extractStructuredTestIds('```\n| ID | 用例 |\n|---|---|\n| UT-FAKE-03 | 仅示例 |\n```')).toEqual([]);
    // 围栏外真实表格 + 围栏内示例并存 → 只计围栏外
    expect(extractStructuredTestIds('| ID | 用例 |\n|---|---|\n| UT-S01-03 | 真实 |\n\n```\n| UT-FAKE-04 | 示例 |\n```')).toEqual(['UT-S01-03']);
    // code-r2 F5：HTML 注释中的完整表格不构成存在性
    expect(extractStructuredTestIds('<!--\n| ID | 用例 |\n|---|---|\n| UT-FAKE-HTML | 注释 |\n-->')).toEqual([]);
    // code-r2 F5：四空格缩进代码块中的表格不构成存在性
    expect(extractStructuredTestIds('    | ID | 用例 |\n    |---|---|\n    | UT-FAKE-INDENT | 缩进 |')).toEqual([]);
    // code-r2 F5：首列表头非 ID 的普通表格不构成 ID 列
    expect(extractStructuredTestIds('| 示例值 | 说明 |\n|---|---|\n| UT-FAKE-03 | 普通表格 |')).toEqual([]);
    // 约定表头「用例 ID」同样合法；无首尾 pipe 的合法 Markdown 表格兼容
    expect(extractStructuredTestIds('| 用例 ID | 说明 |\n|---|---|\n| UT-S01-04 | 真实 |')).toEqual(['UT-S01-04']);
    expect(extractStructuredTestIds('ID | 说明\n--- | ---\nUT-S01-05 | 真实')).toEqual(['UT-S01-05']);
  });

  it('UT-S35-09d: corpus 兼容回归——现行全部已定义 ID 经生产链路（extractStructuredTestIds）零收窄', { timeout: 120_000 }, () => {
    for (const id of ['ST-S01-EX-adopt', 'UT-S05-bootstrap-01', 'UT-S05-B01', 'UT-JSON-09', 'ST-JSON-21', 'UT-S09-110a-neg', 'SMOKE-my-mod-07']) {
      expect(parseTestCaseIds(id), id).toEqual([id]);
    }
    // r3 F19：转义管道（\|）与 code span 内管道不是单元格分隔符——首列 ID 稳定提取
    expect(extractStructuredTestIds('| ID | 期望 |\n|---|---|\n| UT-S11-52 | 值域 pre\\|impl\\|post 三态 |')).toEqual(['UT-S11-52']);
    expect(extractStructuredTestIds('| ID | 期望 |\n|---|---|\n| UT-S27-32 | 断言 `a|b` 形态 |')).toEqual(['UT-S27-32']);
    // 描述列缺/多 cell 不否定首列 ID
    expect(extractStructuredTestIds('| ID | 期望 |\n|---|---|\n| ST-S31-10 | 多出 | 一列 |')).toEqual(['ST-S31-10']);
    const testDir = join(REPO_ROOT, 'logos', 'resources', 'test');
    if (existsSync(testDir)) {
      // r3 F19：corpus 走**生产链路** extractStructuredTestIds——现有规格首列 ID 集合必须是其输出子集
      const anchorRe = /^\|\s*((?:UT|ST|SMOKE)-[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*)(?:\s*\[manual\])?\s*\|/;
      const delimiterLike = /^\|[\s:|-]+\|?$/;
      let corpus = 0;
      const union = new Set<string>();
      for (const f of readdirSync(testDir, { recursive: true }).map(String).filter(f => f.endsWith('.md'))) {
        const content = readFileSync(join(testDir, f), 'utf-8');
        const extracted = new Set(extractStructuredTestIds(content));
        for (const id of extracted) union.add(id);
        for (const line of content.split('\n')) {
          const m = anchorRe.exec(line.trim());
          if (!m || delimiterLike.test(line.trim())) continue;
          corpus++;
          expect(extracted.has(m[1]), `corpus 生产链路收窄：${m[1]}（${f}）`).toBe(true);
        }
      }
      expect(corpus).toBeGreaterThan(500); // 语料非空防呆
      // 评审列出的八个既有 ID 逐一在生产链路输出中
      for (const id of ['UT-S09-20', 'UT-S09-110a-neg', 'UT-S09-116', 'UT-S11-52', 'UT-S27-32', 'ST-S28-EX-4', 'UT-S28-36', 'ST-S31-10']) {
        expect(union.has(id), `既有 ID 被收窄：${id}`).toBe(true);
      }
    }
    // r3 F19：转义管道行内 ID 的真实复用 CLI 用例——合法复用声明必须 exit 0
    const cli = setup({
      proposal: proposalMd({ reuseLines: ['- UT-S91-52 — 复用已合并用例'] }),
      tasks: '# 任务\n\n## [code] 代码实现\n',
    });
    writeFileSync(join(cli.root, 'logos', 'resources', 'test', 'core-S91-test-cases.md'),
      '| ID | 期望 |\n|---|---|\n| UT-S91-52 | 值域 pre-implement\\|implement\\|post-implement |');
    const rCli = spawnCli(cli.root, ['change-lint', '--format', 'json']);
    expect(rCli.status).toBe(0);
    expect(JSON.parse(rCli.stdout.trim()).data.pass).toBe(true);
  });
});

/* ========== UT — L4 delta 段标记与脱模板 ========== */

describe('S35 — L4 validateMarkdownDelta', () => {
  it('UT-S35-10: 缺段标记 → delta_missing_section_marker', () => {
    expect(validateMarkdownDelta('# 无标记内容\n正文').missingSectionMarker).toBe(true);
    const { root, dir } = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'prd', 'x.md'), '# 无标记');
    const { violations } = lintViolations(root);
    expect(codesOf(violations)).toContain('delta_missing_section_marker');
  });

  it('UT-S35-11: 模板骨架全变体 + 混合残留占位行 → delta_template_skeleton', () => {
    const titles = ['[新增内容标题]', '[修改内容标题]', '[删除内容标题]', '[新增章节标题]', '[修改章节标题]', '[删除章节标题]'];
    const markers = ['ADDED', 'MODIFIED', 'REMOVED'];
    for (const marker of markers) {
      for (const title of titles) {
        expect(validateMarkdownDelta(`## ${marker} — ${title}\n真实内容`).templateSkeleton, `${marker} ${title}`).toBe(true);
      }
    }
    const bodies = [
      '[新增的完整内容]',
      '[修改后的完整内容，替换主文档中同名章节]',
      '[说明删除原因]',
      '[修改后的完整内容，merge 时替换主文档中同名章节]',
      '[说明删除原因，merge 时删除主文档中同名章节]',
    ];
    for (const body of bodies) {
      expect(validateMarkdownDelta(`## ADDED — 真实标题\n${body}`).templateSkeleton, body).toBe(true);
    }
    // 混合负例：真实 marker 标题 + 残留独占占位行 + 真实说明行 → 同样命中（不因存在真实内容而放过）
    const mixed = '## ADDED — 真实标题\n[新增的完整内容]\n这里还有一行真实说明。';
    expect(validateMarkdownDelta(mixed).templateSkeleton).toBe(true);
    // code-r1 F4：唯一 marker 在代码围栏内（``` 与 ~~~ 两种）→ 不构成权威段标记，missingSectionMarker=true
    expect(validateMarkdownDelta('~~~markdown\n## ADDED — 仅示例\n示例正文\n~~~').missingSectionMarker).toBe(true);
    expect(validateMarkdownDelta('```markdown\n## MODIFIED — 仅示例\n示例正文\n```').missingSectionMarker).toBe(true);
    // 围栏外真实 marker + 围栏内引用 → 正常通过
    const real = '## ADDED — 真实\n内容\n```\n## ADDED — [新增章节标题]\n[新增的完整内容]\n```';
    expect(validateMarkdownDelta(real).missingSectionMarker).toBe(false);
    expect(validateMarkdownDelta(real).templateSkeleton).toBe(false);
  });

  it('UT-S35-11a: 合法引用不误报——行内代码/代码围栏引用占位字面量 + 本提案 delta 全量过 L4', () => {
    expect(validateMarkdownDelta('## ADDED — 规则\n占位字面量如 `[新增章节标题]`、`[新增的完整内容]` 会被拒绝。').templateSkeleton).toBe(false);
    // code-r2 F4：等长多反引号 code span 的引用同样不得命中（`` 与 ``` 定界）
    expect(validateMarkdownDelta('## ADDED — 真实规则\n``[新增的完整内容]``').templateSkeleton).toBe(false);
    expect(validateMarkdownDelta('## ADDED — 真实规则\n```[新增的完整内容]``` 之说明').templateSkeleton).toBe(false);
    // code-r2 F4：4 空格缩进的反引号行是缩进代码、不是围栏定界——其后的真实 marker 不得被遮蔽
    const indented = '    ```\n## ADDED — 真实标题\n真实内容';
    expect(validateMarkdownDelta(indented).missingSectionMarker).toBe(false);
    expect(validateMarkdownDelta(indented).templateSkeleton).toBe(false);
    // HTML 注释中的 marker/占位不构成权威结构
    expect(validateMarkdownDelta('<!--\n## ADDED — 仅注释\n[新增的完整内容]\n-->').missingSectionMarker).toBe(true);
    expect(validateMarkdownDelta('## ADDED — 真实\n内容\n<!-- [新增的完整内容] -->').templateSkeleton).toBe(false);
    // code-r3 F4：行内代码中的未闭合 HTML 注释起始符（单/双/三反引号）是普通 code span——
    // 不得开启注释状态、不得遮蔽后续真实 marker
    for (const quoted of ['`<!--`', '``<!--``', '```<!--``` 的引用']) {
      const doc = `说明中引用 ${quoted}\n## ADDED — 真实标题\n真实正文`;
      expect(validateMarkdownDelta(doc).missingSectionMarker, quoted).toBe(false);
      expect(validateMarkdownDelta(doc).templateSkeleton, quoted).toBe(false);
    }
    expect(validateMarkdownDelta('## ADDED — 模板示例\n```markdown\n## ADDED — [新增章节标题]\n[新增的完整内容]\n```\n真实说明。').templateSkeleton).toBe(false);
    expect(validateMarkdownDelta('## MODIFIED — 三、场景总览\n真实的替换内容。').templateSkeleton).toBe(false);
    // 本提案 13 份 delta 全量过 L4（dogfood 自检；deltas 目录在场时断言）
    const deltasDir = join(REPO_ROOT, 'logos', 'changes', 'change-lint-shift-left', 'deltas');
    if (existsSync(deltasDir)) {
      const mdFiles = readdirSync(deltasDir, { recursive: true }).map(String)
        .filter(f => f.endsWith('.md') && statSync(join(deltasDir, f)).isFile());
      expect(mdFiles.length).toBeGreaterThanOrEqual(13);
      for (const f of mdFiles) {
        const v = validateMarkdownDelta(readFileSync(join(deltasDir, f), 'utf-8'));
        expect(v.missingSectionMarker, `${f} 缺段标记`).toBe(false);
        expect(v.templateSkeleton, `${f} 命中模板骨架：${v.skeletonHits[0] ?? ''}`).toBe(false);
      }
    }
  });
});

/* ========== UT — L5/L6 ========== */

describe('S35 — L5/L6', () => {
  it('UT-S35-12: L5 正反例——需要部署×[deploy] 互证；反例 flow_reason 为精确字符串', () => {
    const ok = setup({
      proposal: proposalMd({ codeRequired: false, deploy: '是' }),
      tasks: '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/prd/`\n\n## [deploy] 部署任务\n- [ ] 部署',
    });
    expect(codesOf(lintViolations(ok.root).violations)).not.toContain('deployment_decision_conflict');

    const bad = setup({ proposal: proposalMd({ codeRequired: false, deploy: '是' }) });
    const v = lintViolations(bad.root).violations.find(x => x.code === 'deployment_decision_conflict');
    expect(v).toBeDefined();
    expect(v.flow_reason).toBe('deployment_decision_conflict');
    expect(typeof v.flow_reason).toBe('string');
  });

  it('UT-S35-13: L6 正例——已知类别下 delta lintValidity=valid、无违规', () => {
    const { root, dir } = setup({ proposal: proposalMd({ codeRequired: false }) });
    for (const cat of ['prd', 'test', 'spec', 'skills']) {
      mkdirSync(join(dir, 'deltas', cat), { recursive: true });
      writeFileSync(join(dir, 'deltas', cat, 'x.md'), '## ADDED — 真实\n内容');
    }
    const entries = classifyProposalDeltas(dir);
    expect(entries.every(e => e.lintValidity === 'valid' && e.mergeDisposition === 'mergeable')).toBe(true);
    expect(codesOf(lintViolations(root).violations)).not.toContain('delta_path_invalid');
  });

  it('UT-S35-14: L6 分流——unknown → delta_path_invalid；reference → explicitly_ignored 不报', () => {
    const { root, dir } = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(dir, 'deltas', 'unknown'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'unknown', 'x.md'), '## ADDED — 真实\n内容');
    mkdirSync(join(dir, 'deltas', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'reference', 'r.md'), '参考资料');
    const entries = classifyProposalDeltas(dir);
    expect(entries.find(e => e.relativePath === 'deltas/unknown/x.md')!.lintValidity).toBe('invalid');
    expect(entries.find(e => e.relativePath === 'deltas/reference/r.md')!.lintValidity).toBe('explicitly_ignored');
    const { violations } = lintViolations(root);
    const invalid = violations.filter(v => v.code === 'delta_path_invalid');
    expect(invalid.length).toBe(1);
    expect(invalid[0].path).toContain('deltas/unknown/x.md');
    // code-r1 F3：deltas 根下直接放文件 → 有分类结果且 invalid（不再静默跳过）
    const rootFile = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(rootFile.dir, 'deltas'), { recursive: true });
    writeFileSync(join(rootFile.dir, 'deltas', 'root.md'), '## ADDED — a\nb');
    const rf = classifyProposalDeltas(rootFile.dir).find(e => e.relativePath === 'deltas/root.md');
    expect(rf).toBeDefined();
    expect(rf!.lintValidity).toBe('invalid');
    expect(rf!.mergeDisposition).toBe('ignored');
    expect(codesOf(lintViolations(rootFile.root).violations)).toContain('delta_path_invalid');
  });

  it('UT-S35-15: L6 symlink——逃逸/断链/根级/非常规目标 symlink 全分流 → delta_path_invalid', { timeout: 120_000 }, () => {
    const { root, dir } = setup({ proposal: proposalMd({ codeRequired: false }) });
    writeFileSync(join(root, 'outside.md'), '## ADDED — 外部\n内容');
    mkdirSync(join(dir, 'deltas', 'prd'), { recursive: true });
    symlinkSync(join(root, 'outside.md'), join(dir, 'deltas', 'prd', 'escape.md'));
    const entries = classifyProposalDeltas(dir);
    expect(entries.find(e => e.relativePath === 'deltas/prd/escape.md')!.lintValidity).toBe('invalid');
    expect(codesOf(lintViolations(root).violations)).toContain('delta_path_invalid');
    // code-r1 F3：目录 symlink 逃逸（顶层类别目录直接链到提案外）→ invalid、不递归、不判 mergeable
    const dirLink = setup({ proposal: proposalMd({ codeRequired: false }) });
    const outsideDir = join(dirLink.root, 'outside-dir');
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'x.md'), '## ADDED — 外部\n内容');
    mkdirSync(join(dirLink.dir, 'deltas'), { recursive: true });
    symlinkSync(outsideDir, join(dirLink.dir, 'deltas', 'prd'));
    const linkEntries = classifyProposalDeltas(dirLink.dir);
    const linkEntry = linkEntries.find(e => e.relativePath === 'deltas/prd');
    expect(linkEntry).toBeDefined();
    expect(linkEntry!.lintValidity).toBe('invalid');
    expect(linkEntry!.mergeDisposition).toBe('ignored');
    expect(linkEntries.some(e => e.relativePath === 'deltas/prd/x.md')).toBe(false); // 不递归进外部目录
    // merge 投影同源：scanDeltas 也不消费该目录链接下的外部文件
    expect(scanDeltas(join(dirLink.dir, 'deltas')).map(d => d.relativePath)).toEqual([]);
    // 嵌套祖先 symlink：类别目录内的子目录链到提案外 → 同样 invalid、不递归
    const nested = setup({ proposal: proposalMd({ codeRequired: false }) });
    const outside2 = join(nested.root, 'outside2');
    mkdirSync(outside2, { recursive: true });
    writeFileSync(join(outside2, 'y.md'), '## ADDED — 外部\n内容');
    mkdirSync(join(nested.dir, 'deltas', 'prd'), { recursive: true });
    symlinkSync(outside2, join(nested.dir, 'deltas', 'prd', 'sub'));
    const nestedEntries = classifyProposalDeltas(nested.dir);
    expect(nestedEntries.find(e => e.relativePath === 'deltas/prd/sub')!.lintValidity).toBe('invalid');
    expect(nestedEntries.some(e => e.relativePath === 'deltas/prd/sub/y.md')).toBe(false);
    // 断链 symlink → invalid
    const broken = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(broken.dir, 'deltas', 'prd'), { recursive: true });
    symlinkSync(join(broken.root, 'not-exists.md'), join(broken.dir, 'deltas', 'prd', 'dangling.md'));
    expect(classifyProposalDeltas(broken.dir).find(e => e.relativePath === 'deltas/prd/dangling.md')!.lintValidity).toBe('invalid');
    // code-r2 F3：deltas **根自身**是 symlink 且逃逸提案目录 → 单条 invalid、不递归（外部文件绝不判 mergeable/valid）
    const rootLink = setup({ proposal: proposalMd({ codeRequired: false }) });
    const outsideTree = join(rootLink.root, 'outside-tree');
    mkdirSync(join(outsideTree, 'prd'), { recursive: true });
    writeFileSync(join(outsideTree, 'prd', 'x.md'), '## ADDED — 外部\n内容');
    // 提案目录由 setup 创建但无 deltas/——直接把 deltas 链到外部
    symlinkSync(outsideTree, join(rootLink.dir, 'deltas'));
    const rootEntries = classifyProposalDeltas(rootLink.dir);
    expect(rootEntries.length).toBe(1);
    expect(rootEntries[0].relativePath).toBe('deltas');
    expect(rootEntries[0].lintValidity).toBe('invalid');
    expect(rootEntries[0].mergeDisposition).toBe('ignored');
    expect(scanDeltas(join(rootLink.dir, 'deltas')).length).toBe(0); // merge 投影同步不消费
    expect(codesOf(lintViolations(rootLink.root).violations)).toContain('delta_path_invalid');
    // deltas 根断链 → 同样单条 invalid
    const rootBroken = setup({ proposal: proposalMd({ codeRequired: false }) });
    symlinkSync(join(rootBroken.root, 'no-such-dir'), join(rootBroken.dir, 'deltas'));
    const rb = classifyProposalDeltas(rootBroken.dir);
    expect(rb.length).toBe(1);
    expect(rb[0].lintValidity).toBe('invalid');
    // code-r2 F3：非法文件 symlink（逃逸）不触发内容读取——目标不可读也不得 artifact_unreadable，只报 L6
    const noDeref = setup({ proposal: proposalMd({ codeRequired: false }) });
    writeFileSync(join(noDeref.root, 'secret.md'), '## ADDED — 外部\n内容');
    chmodSync(join(noDeref.root, 'secret.md'), 0o000);
    mkdirSync(join(noDeref.dir, 'deltas', 'prd'), { recursive: true });
    symlinkSync(join(noDeref.root, 'secret.md'), join(noDeref.dir, 'deltas', 'prd', 'leak.md'));
    const rNoDeref = lintViolations(noDeref.root);
    expect(rNoDeref.code).toBe(2); // 检查完成（非 artifact_unreadable 的 exit 1）——未解引用读取
    expect(codesOf(rNoDeref.violations)).toContain('delta_path_invalid');
    chmodSync(join(noDeref.root, 'secret.md'), 0o644);
    // r6 F21(a)：根级（边界内）文件 symlink → 与根级普通文件同判 L6 invalid，真实 CLI 绝不崩溃
    const rootSym = setup({ proposal: proposalMd({ codeRequired: false }) });
    writeFileSync(join(rootSym.dir, 'local.md'), '## ADDED — 本地\n内容');
    mkdirSync(join(rootSym.dir, 'deltas'), { recursive: true });
    symlinkSync(join('..', 'local.md'), join(rootSym.dir, 'deltas', 'root-link.md'));
    const rsEntry = classifyProposalDeltas(rootSym.dir).find(e => e.relativePath === 'deltas/root-link.md');
    expect(rsEntry).toBeDefined();
    expect(rsEntry!.lintValidity).toBe('invalid');
    expect(rsEntry!.mergeDisposition).toBe('ignored');
    const rRootSym = spawnCli(rootSym.root, ['change-lint', '--format', 'json']);
    expect(rRootSym.status).toBe(2); // 稳定 L6 违规（exit 2），而非未捕获 TypeError 崩溃（exit 1 + stack）
    expect(rRootSym.stderr).not.toContain('TypeError');
    expect(JSON.parse(rRootSym.stdout.trim()).data.violations.map((v: { code: string }) => v.code)).toContain('delta_path_invalid');
    // r6 F21(b)：边界内指向 FIFO 的 symlink → invalid、绝不判 mergeable/valid、不预读、不进 merge 消费清单
    // （零漂移：变更前 scanDeltas 经 statSync().isFile() 过滤即不消费非常规目标）
    const fifo = setup({ proposal: proposalMd({ codeRequired: false }) });
    const mk = spawnSync('mkfifo', [join(fifo.dir, 'pipe')]);
    expect(mk.status).toBe(0);
    mkdirSync(join(fifo.dir, 'deltas', 'api'), { recursive: true });
    symlinkSync(join('..', '..', 'pipe'), join(fifo.dir, 'deltas', 'api', 'pipe.yaml'));
    const fifoEntry = classifyProposalDeltas(fifo.dir).find(e => e.relativePath === 'deltas/api/pipe.yaml');
    expect(fifoEntry).toBeDefined();
    expect(fifoEntry!.mergeDisposition).toBe('ignored');
    expect(fifoEntry!.lintValidity).toBe('invalid');
    expect(fifoEntry!.invalidReason).toContain('非常规 symlink 目标');
    expect(fifoEntry!.contentProbeEligible).toBeFalsy(); // 恒不解引用预读 FIFO（否则 readFileSync 阻塞）
    expect(scanDeltas(join(fifo.dir, 'deltas')).map(d => d.relativePath)).toEqual([]); // merge 投影不消费
    const rFifo = spawnCli(fifo.root, ['change-lint', '--format', 'json']);
    expect(rFifo.status).toBe(2);
    expect(JSON.parse(rFifo.stdout.trim()).data.violations.map((v: { code: string }) => v.code)).toContain('delta_path_invalid');
    const rFifoMerge = spawnCli(fifo.root, ['merge', 'feat']);
    expect(rFifoMerge.status).toBe(0); // 无可消费 delta → no-delta 早退（与变更前 isFile 过滤后的行为一致）
    expect(existsSync(join(fifo.dir, 'MERGE_PROMPT.md'))).toBe(false); // pipe.yaml 绝不进入消费清单
    // 既有边界内普通文件 symlink 零漂移对照：仍 mergeable + valid（防修复过度收紧）
    const okSym = setup({ proposal: proposalMd({ codeRequired: false }) });
    writeFileSync(join(okSym.dir, 'real.md'), '## ADDED — 真\n内容');
    mkdirSync(join(okSym.dir, 'deltas', 'prd'), { recursive: true });
    symlinkSync(join('..', '..', 'real.md'), join(okSym.dir, 'deltas', 'prd', 'link.md'));
    const okEntry = classifyProposalDeltas(okSym.dir).find(e => e.relativePath === 'deltas/prd/link.md');
    expect(okEntry!.mergeDisposition).toBe('mergeable');
    expect(okEntry!.lintValidity).toBe('valid');
  });
});

/* ========== UT — L7 与模块解析 ========== */

function guiSetup(uiDeclYaml: string | null, opts: Partial<SetupOpts> = {}): { root: string; dir: string } {
  return setup({
    productType: 'desktop',
    proposal: proposalMd({ codeRequired: false, uiDeclYaml }),
    ...opts,
  });
}

/** 构造 evaluateUiPrototype 全过夹具（generated + 1 页 + 令牌）。 */
function validUiFixture(): { root: string; dir: string } {
  const decl = ['ui_impact: true', 'design_system_mode: generated', 'design_system_fallback_reason: ""', 'pages:', '  - id: home', '    prototype: core-01-home.html', '    description: 首页'].join('\n');
  const f = guiSetup(decl);
  const protoDir = join(f.dir, 'deltas', 'prd', '2-product-design', '2-page-design');
  mkdirSync(protoDir, { recursive: true });
  writeFileSync(join(protoDir, 'core-01-home.html'), '<html>home</html>');
  writeFileSync(join(f.dir, 'design-system.json'), JSON.stringify({ palette: 'x' }));
  return f;
}

describe('S35 — L7 与模块解析', () => {
  it('UT-S35-16: L7 只读——纯 evaluator 零写入；wrapper 在 ui_impact:false 不产生空哈希文件', () => {
    const { dir } = validUiFixture();
    const before = snapshotTree(dir);
    const outcome = evaluateUiPrototype(dir);
    expect(outcome.code).toBe(0);
    expect(existsSync(join(dir, 'UI_PROTOTYPE_HASHES.json'))).toBe(false);
    expect(snapshotTree(dir)).toEqual(before);
    // code-r1 F9：wrapper 层——ui_impact:false（when 不满足、无对账数据）不得新增空哈希文件（既有行为保持）
    const off = guiSetup(VALID_UI_DECL);
    const offBefore = snapshotTree(off.dir);
    const offOutcome = evaluateUiPrototype(off.dir);
    expect(offOutcome.code).toBe(0);
    writeUiPrototypeHashes(off.dir, offOutcome);
    expect(existsSync(join(off.dir, 'UI_PROTOTYPE_HASHES.json'))).toBe(false);
    expect(snapshotTree(off.dir)).toEqual(offBefore);
    // wrapper 在真实对账通过（携带 hashes）时才写文件
    writeUiPrototypeHashes(dir, outcome);
    expect(existsSync(join(dir, 'UI_PROTOTYPE_HASHES.json'))).toBe(true);
  });

  it('UT-S35-17: 坏声明三新码——缺失 / YAML 损坏 / ui_impact 非布尔 / 围栏示例不构成权威声明', { timeout: 120_000 }, () => {
    const missing = guiSetup(null);
    expect(codesOf(lintViolations(missing.root).violations)).toContain('ui_declaration_missing');
    const broken = guiSetup('ui_impact: [unclosed');
    expect(codesOf(lintViolations(broken.root).violations)).toContain('ui_declaration_unparsable');
    const notBool = guiSetup('ui_impact: "yes"\ndesign_system_mode: generated');
    expect(codesOf(lintViolations(notBool.root).violations)).toContain('ui_impact_not_boolean');
    // code-r1 F11：~~~markdown 围栏示例内的声明段（含内层 ``` YAML）不得伪装成权威 ui_impact:false
    const fencedOnly = guiSetup(null, {
      proposal: proposalMd({ codeRequired: false, extra: [
        '~~~markdown',
        '## UI/UX 变更声明',
        '',
        '```yaml',
        'ui_impact: false',
        '```',
        '~~~',
      ].join('\n') }),
    });
    expect(codesOf(lintViolations(fencedOnly.root).violations)).toContain('ui_declaration_missing');
    // code-r2 F11：普通正文**提及**标题（非真实 heading 行）+ 后随 YAML 示例，不得被解析为权威声明
    const proseMention = guiSetup(null, {
      proposal: proposalMd({ codeRequired: false, extra: [
        '说明：请添加 ## UI/UX 变更声明 段。',
        '',
        '```yaml',
        'ui_impact: false',
        '```',
      ].join('\n') }),
    });
    expect(codesOf(lintViolations(proseMention.root).violations)).toContain('ui_declaration_missing');
    // HTML 注释中的完整声明段同样不构成权威声明
    const commentDecl = guiSetup(null, {
      proposal: proposalMd({ codeRequired: false, extra: [
        '<!--',
        '## UI/UX 变更声明',
        '',
        '```yaml',
        'ui_impact: false',
        '```',
        '-->',
      ].join('\n') }),
    });
    expect(codesOf(lintViolations(commentDecl.root).violations)).toContain('ui_declaration_missing');
    // code-r3 F11①：真实标题 + fenced YAML 全在 HTML 注释内 → 注释 fence 不采信 → unparsable（真实 CLI）
    const commentYaml = guiSetup(null, {
      proposal: proposalMd({ codeRequired: false, extra: [
        '## UI/UX 变更声明',
        '',
        '<!--',
        '```yaml',
        'ui_impact: false',
        '```',
        '-->',
      ].join('\n') }),
    });
    const rCommentYaml = spawnCli(commentYaml.root, ['change-lint', '--format', 'json']);
    expect(rCommentYaml.status).toBe(2);
    expect(JSON.parse(rCommentYaml.stdout.trim()).data.violations.map((v: any) => v.code)).toContain('ui_declaration_unparsable');
    // code-r3 F11②：真实标题 + YAML fence 整体缩进四空格（缩进代码）→ 不采信 → unparsable
    const indentYaml = guiSetup(null, {
      proposal: proposalMd({ codeRequired: false, extra: [
        '## UI/UX 变更声明',
        '',
        '    ```yaml',
        '    ui_impact: false',
        '    ```',
      ].join('\n') }),
    });
    expect(codesOf(lintViolations(indentYaml.root).violations)).toContain('ui_declaration_unparsable');
    // code-r3 F11③：`### 示例 UI/UX 变更声明` 非精确二级标题 → 不构成声明 → missing
    const looseHeading = guiSetup(null, {
      proposal: proposalMd({ codeRequired: false, extra: [
        '### 示例 UI/UX 变更声明',
        '',
        '```yaml',
        'ui_impact: false',
        '```',
      ].join('\n') }),
    });
    expect(codesOf(lintViolations(looseHeading.root).violations)).toContain('ui_declaration_missing');
  });

  it('UT-S35-18: L7 跳过——product_type: cli 模块零输出', () => {
    const { root } = setup({ proposal: proposalMd({ codeRequired: false }) }); // productType cli，无声明段
    const r = runLint(root, undefined, 'json');
    const envelope = JSON.parse(r.logs[r.logs.length - 1]);
    const l7codes = ['ui_declaration_missing', 'ui_declaration_unparsable', 'ui_impact_not_boolean'];
    expect(envelope.data.violations.filter((v: any) => l7codes.includes(v.code))).toEqual([]);
    const text = runLint(root);
    expect(text.logs.join('\n')).not.toContain('L7');
  });

  it('UT-S35-18a: 模块解析四档——头优先 / 同 slug guard 回退 / 异 slug 不回退 / 模块不在 yaml fail-closed', () => {
    // ① 头与 guard 冲突 → 以头为准
    const a = setup({ proposal: proposalMd({ module: 'core', codeRequired: false }), guard: { activeChange: 'feat', module: 'other' } });
    const ra = resolveProposalModuleContext(a.root, a.dir, 'feat');
    expect(ra.ok && ra.moduleId).toBe('core');
    // ② 头缺失且 guard.activeChange==slug → 回退 guard.module
    const b = setup({ proposal: proposalMd({ module: null, codeRequired: false }) });
    const rb = resolveProposalModuleContext(b.root, b.dir, 'feat');
    expect(rb.ok && rb.moduleId).toBe('core');
    // ③ 头缺失且 guard 指向别的 slug → 不回退
    const c = setup({ proposal: proposalMd({ module: null, codeRequired: false }), guard: { activeChange: 'other-slug', module: 'core' } });
    expect(resolveProposalModuleContext(c.root, c.dir, 'feat').ok).toBe(false);
    // ④ 模块不在 yaml → fail-closed（命令级 module_unresolved，exit 1）
    const d = setup({ proposal: proposalMd({ module: 'ghost', codeRequired: false }) });
    expect(resolveProposalModuleContext(d.root, d.dir, 'feat').ok).toBe(false);
    const r = runLint(d.root, undefined, 'json');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.errors[r.errors.length - 1]).error.code).toBe('module_unresolved');
    // code-r1 F11：仅围栏示例里的 `> module:` 头不构成权威声明（不被解析为模块）
    const fenced = setup({
      proposal: '# 变更提案：feat\n\n```markdown\n> module: cli-mod\n```\n\n## 变更原因\nx\n\n## 变更概述\n纯文档更新，无需代码。',
      guard: { activeChange: 'other', module: 'core' }, // guard 不指向本 slug → 不回退
    });
    expect(readProposalModuleHeader(fenced.dir)).toBeUndefined();
    expect(resolveProposalModuleContext(fenced.root, fenced.dir, 'feat').ok).toBe(false);
    // code-r2 F11：HTML 注释中的 `> module:` 头同样不构成权威声明
    const commented = setup({
      proposal: '# 变更提案：feat\n\n<!--\n> module: cli-mod\n-->\n\n## 变更原因\nx\n\n## 变更概述\n纯文档更新，无需代码。',
      guard: { activeChange: 'other', module: 'core' },
    });
    expect(readProposalModuleHeader(commented.dir)).toBeUndefined();
  });
});

/* ========== UT — 同源锚 / 契约 / 收紧回归 ========== */

describe('S35 — 同源锚与契约', () => {
  it('UT-S35-19: 同源锚 L3——同一夹具 lint 与 flow-derive 两侧 pass/fail 一致', () => {
    const fail = setup({ markers: ['SPEC_MERGED'], tasks: '# 任务\n\n## [code] 代码实现\n' });
    const lintFail = lintViolations(fail.root).violations.some(v => v.code === 'code_change_requires_real_test_ids');
    expect(lintFail).toBe(true);
    expect(hasRealTestIdsForProposal(fail.dir)).toBe(false);

    const ok = setup({
      markers: ['SPEC_MERGED'],
      proposal: proposalMd({ reuseLines: ['- UT-S09-02 — 回归覆盖'] }),
      tasks: '# 任务\n\n## [code] 代码实现\n',
      mergedTestIds: ['UT-S09-02'],
    });
    const lintOk = lintViolations(ok.root).violations.every(v => v.code !== 'code_change_requires_real_test_ids');
    expect(lintOk).toBe(true);
    expect(hasRealTestIdsForProposal(ok.dir)).toBe(true);
    // code-r1 F10 交叉①：有效测试 delta 证据 + 非法复用项 → lint 红 且 flow 同判红（唯一总判定）
    const cross = setup({
      markers: ['SPEC_MERGED'],
      proposal: proposalMd({ reuseLines: ['- UT-S99-99 — 不存在的 ID'] }),
      tasks: '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta 到 `deltas/test/`\n\n## [code] 代码实现\n',
    });
    mkdirSync(join(cross.dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(cross.dir, 'deltas', 'test', 'core-S99-test-cases.md'), '| ID | 用例 |\n|---|---|\n| UT-S99-01 | 新增 |');
    writeFileSync(join(cross.root, 'logos', 'resources', 'test', 'core-S99-test-cases.md'), '| ID | 用例 |\n|---|---|\n| UT-S99-01 | 新增 |');
    const crossEval = evaluateTestIdEvidence(cross.dir);
    expect(crossEval.evidenceOk).toBe(true); // 替代证据有效
    expect(crossEval.pass).toBe(false); // 但非法复用项使总判定为红
    expect(hasRealTestIdsForProposal(cross.dir)).toBe(false); // flow-derive 消费同一总判定
    expect(codesOf(lintViolations(cross.root).violations)).toContain('code_change_requires_real_test_ids'); // lint 同判红
    // code-r1 F10 交叉②：有效复用项 + 其它合法证据 → 双侧同判绿
    const both = setup({
      markers: ['SPEC_MERGED'],
      proposal: proposalMd({ reuseLines: ['- UT-S09-02 — 回归覆盖'] }),
      tasks: '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta 到 `deltas/test/`\n\n## [code] 代码实现\n',
      mergedTestIds: ['UT-S09-02'],
    });
    mkdirSync(join(both.dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(both.dir, 'deltas', 'test', 'core-S98-test-cases.md'), '| ID | 用例 |\n|---|---|\n| UT-S98-01 | 新增 |');
    writeFileSync(join(both.root, 'logos', 'resources', 'test', 'core-S98-test-cases.md'), '| ID | 用例 |\n|---|---|\n| UT-S98-01 | 新增 |');
    expect(evaluateTestIdEvidence(both.dir).pass).toBe(true);
    expect(hasRealTestIdsForProposal(both.dir)).toBe(true);
    expect(lintViolations(both.root).violations.every(v => v.code !== 'code_change_requires_real_test_ids')).toBe(true);
  });

  it('UT-S35-20: 同源锚 L4/L6——validateMarkdownDelta / 分类器在 lint 与 merge 两侧结论一致', { timeout: 120_000 }, () => {
    // 模板骨架：lint 报 delta_template_skeleton，merge 同判据拒绝
    const { root, dir } = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'prd', 'skeleton.md'), '## ADDED — [新增章节标题]\n[新增的完整内容]');
    expect(codesOf(lintViolations(root).violations)).toContain('delta_template_skeleton');
    const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
    try { merge('feat'); } catch { /* exit(1) */ } finally { cap.restore(); ex.mockRestore(); restore(); }
    expect(cap.errors.join('\n')).toContain('模板占位字面量未替换');
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(false);
    // 分类器 mergeDisposition 与 scanDeltas 消费集合一致（unknown 不消费）——F2：scanDeltas 即分类器投影
    mkdirSync(join(dir, 'deltas', 'unknown'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'unknown', 'x.md'), '## ADDED — a\nb');
    const consumed = new Set(scanDeltas(join(dir, 'deltas')).map(d => d.relativePath));
    for (const e of classifyProposalDeltas(dir)) {
      expect(consumed.has(e.relativePath), e.relativePath).toBe(e.mergeDisposition === 'mergeable');
    }
    // code-r1 F1：未知模块 + ui_impact:true 的 UI-first 外观提案 → merge fail-closed（不再被降成非 GUI 静默绕过）
    const ghost = setup({
      productType: 'desktop',
      proposal: proposalMd({ module: 'ghost', codeRequired: false, uiDeclYaml: 'ui_impact: true\ndesign_system_mode: generated\npages: []' }),
    });
    mkdirSync(join(ghost.dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(ghost.dir, 'deltas', 'prd', 'g.md'), '## ADDED — 真实\n内容');
    {
      const restore = mockCwd(ghost.root); const cap = captureConsole(); const ex = mockProcessExit();
      let exited = false;
      try { merge('feat'); } catch { exited = true; } finally { cap.restore(); ex.mockRestore(); restore(); }
      expect(exited).toBe(true);
      expect(cap.errors.join('\n')).toContain('模块归属无法解析');
      expect(existsSync(join(ghost.dir, 'MERGE_PROMPT.md'))).toBe(false);
      expect(existsSync(join(ghost.dir, 'SPEC_MERGED'))).toBe(false);
    }
    // guard 指向另一 slug 时 merge 早已拒绝（既有 F2 检查），此处锚定 guard.module 不被误用：
    // 头缺失 + guard 指向本 slug 但 module 未注册 + UI-first 外观 → 同样 fail-closed
    const ghostGuard = setup({
      productType: 'desktop',
      proposal: proposalMd({ module: null, codeRequired: false, uiDeclYaml: 'ui_impact: true\ndesign_system_mode: generated\npages: []' }),
      guard: { activeChange: 'feat', module: 'ghost' },
    });
    mkdirSync(join(ghostGuard.dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(ghostGuard.dir, 'deltas', 'prd', 'g.md'), '## ADDED — 真实\n内容');
    {
      const restore = mockCwd(ghostGuard.root); const cap = captureConsole(); const ex = mockProcessExit();
      let exited = false;
      try { merge('feat'); } catch { exited = true; } finally { cap.restore(); ex.mockRestore(); restore(); }
      expect(exited).toBe(true);
      expect(existsSync(join(ghostGuard.dir, 'SPEC_MERGED'))).toBe(false);
    }
    // code-r2 F1：**no-delta** 提案（无任何 delta）+ ghost 头模块 + ui_impact:true → resolver/UI 门先于
    // no-delta 早退执行，fail-closed 不写 SPEC_MERGED（头与 guard 两个 ghost 来源各一组）
    const noDeltaGhostHeader = setup({
      productType: 'desktop',
      proposal: proposalMd({ module: 'ghost', codeRequired: false, uiDeclYaml: 'ui_impact: true\ndesign_system_mode: generated\npages: []' }),
    });
    {
      const restore = mockCwd(noDeltaGhostHeader.root); const cap = captureConsole(); const ex = mockProcessExit();
      let exited = false;
      try { merge('feat'); } catch { exited = true; } finally { cap.restore(); ex.mockRestore(); restore(); }
      expect(exited).toBe(true);
      expect(cap.errors.join('\n')).toContain('模块归属无法解析');
      expect(existsSync(join(noDeltaGhostHeader.dir, 'SPEC_MERGED'))).toBe(false);
    }
    const noDeltaGhostGuard = setup({
      productType: 'desktop',
      proposal: proposalMd({ module: null, codeRequired: false, uiDeclYaml: 'ui_impact: true\ndesign_system_mode: generated\npages: []' }),
      guard: { activeChange: 'feat', module: 'ghost' },
    });
    {
      const restore = mockCwd(noDeltaGhostGuard.root); const cap = captureConsole(); const ex = mockProcessExit();
      let exited = false;
      try { merge('feat'); } catch { exited = true; } finally { cap.restore(); ex.mockRestore(); restore(); }
      expect(exited).toBe(true);
      expect(existsSync(join(noDeltaGhostGuard.dir, 'SPEC_MERGED'))).toBe(false);
    }
    // r4 F7：分类器 ioError 的两侧消费同源锚——lint 侧映射 artifact_unreadable（exit 1）、
    // merge 侧（真实 CLI）非零退出且不写 MERGE_PROMPT/SPEC_MERGED；ioError 条目绝不被投影成空 delta 假成功
    const ioBroken = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(ioBroken.dir, 'deltas', 'api'), { recursive: true });
    chmodSync(join(ioBroken.dir, 'deltas', 'api'), 0o000);
    try {
      const rLintIo = spawnCli(ioBroken.root, ['change-lint', '--format', 'json']);
      expect(rLintIo.status).toBe(1);
      expect(JSON.parse(rLintIo.stderr.trim()).error.code).toBe('artifact_unreadable');
      const rMergeIo = spawnCli(ioBroken.root, ['merge', 'feat']);
      expect(rMergeIo.status).toBe(1);
      expect(rMergeIo.stderr).toContain('artifact_unreadable');
      expect(existsSync(join(ioBroken.dir, 'MERGE_PROMPT.md'))).toBe(false);
      expect(existsSync(join(ioBroken.dir, 'SPEC_MERGED'))).toBe(false);
    } finally {
      chmodSync(join(ioBroken.dir, 'deltas', 'api'), 0o755);
    }
  });

  it('UT-S35-21: 违规集契约——四字段必填、26 码闭合（S37 扩册 L8 三码）、flow_reason 仅 L2/L3/L5 且恒 string、L1→L7 再 path 排序', () => {
    const { root, dir } = setup({
      proposal: proposalMd({ deploy: '是', reuseLines: ['- UT-S99-99 — 不存在'] }),
      tasks: '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/prd/`', // 缺 [code]、无测试规划 → L2+L3；deploy 是无 [deploy] → L5
    });
    mkdirSync(join(dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'prd', 'x.md'), '# 无标记');
    const { violations } = lintViolations(root);
    expect(violations.length).toBeGreaterThanOrEqual(4);
    const registry = new Set<string>(CHANGE_LINT_VIOLATION_CODES);
    expect(registry.size).toBe(26); // S37 merge-conservation-archive-audit 扩册 L8 三码（§3.15 契约 26 码）
    const flowReasonCodes = new Set(['tasks_code_header_missing', 'code_change_requires_real_test_ids', 'deployment_decision_conflict']);
    for (const v of violations) {
      expect(typeof v.code).toBe('string');
      expect(registry.has(v.code), v.code).toBe(true);
      expect(typeof v.path).toBe('string');
      expect(v.path.length).toBeGreaterThan(0);
      expect(typeof v.message).toBe('string');
      expect(typeof v.fix_hint).toBe('string');
      if ('flow_reason' in v) {
        expect(flowReasonCodes.has(v.code)).toBe(true);
        expect(typeof v.flow_reason).toBe('string');
      }
    }
    // 排序：L1→L7（此夹具 L2 → L3 → L4 → L5）
    const order = ['tasks_code_header_missing', 'code_change_requires_real_test_ids', 'delta_missing_section_marker', 'deployment_decision_conflict'];
    const seen = violations.map(v => v.code).filter(c => order.includes(c));
    expect([...new Set(seen)]).toEqual(order);
  });

  it('UT-S35-22: 收紧回归（test-id）——占位串提案不再绕过 test-id-required（消费点同步收紧）', () => {
    const { dir } = setup({
      markers: ['SPEC_MERGED'],
      proposal: proposalMd({ extra: '计划补 UT-S99-xx 与 ST-S99-TBD。' }),
      tasks: '# 任务\n\n## [code] 代码实现\n',
    });
    expect(hasRealTestIdsForProposal(dir)).toBe(false);
    expect(detectProposalStep(dir)).toBe('test-id-required');
    // r4 F20：flow-derive 同源回归——spec-complete 级唯一结构化 ID 为尾随点号占位 `UT-S99-xx.` 的提案，
    // 消费点（hasRealTestIdsForProposal）与 lint 同判据同结论拒绝
    const dotted = setup({
      tasks: '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta 到 `deltas/test/core-S99-test-cases.md` — 新增用例\n\n## [code] 代码实现\n',
    });
    mkdirSync(join(dotted.dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(dotted.dir, 'deltas', 'test', 'core-S99-test-cases.md'),
      '## ADDED — 用例\n\n| ID | 用例 |\n|---|---|\n| UT-S99-xx. | 占位 |');
    expect(evaluateTestIdEvidence(dotted.dir).stage).toBe('spec-complete');
    expect(hasRealTestIdsForProposal(dotted.dir)).toBe(false);
  });

  it('UT-S35-23: 收紧回归（模板骨架）——骨架 delta 被 merge 拒绝；真实内容 delta 照常合并', () => {
    const bad = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(bad.dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(bad.dir, 'deltas', 'prd', 's.md'), '## MODIFIED — [修改章节标题]\n[修改后的完整内容，merge 时替换主文档中同名章节]');
    {
      const restore = mockCwd(bad.root); const cap = captureConsole(); const ex = mockProcessExit();
      try { merge('feat'); } catch { /* exit(1) */ } finally { cap.restore(); ex.mockRestore(); restore(); }
      expect(existsSync(join(bad.dir, 'MERGE_PROMPT.md'))).toBe(false);
    }
    const good = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(good.dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(good.dir, 'deltas', 'prd', 'g.md'), '## MODIFIED — 三、场景总览\n真实替换内容。');
    {
      const restore = mockCwd(good.root); const cap = captureConsole(); const ex = mockProcessExit();
      try { merge('feat'); } catch { /* 不应 exit */ } finally { cap.restore(); ex.mockRestore(); restore(); }
      expect(existsSync(join(good.dir, 'MERGE_PROMPT.md'))).toBe(true);
    }
  });

  it('UT-S35-24: 零漂移回归——unknown/reference 忽略、已知类别任意扩展名与文件 symlink 消费行为不变', () => {
    const { root, dir } = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(dir, 'deltas', 'unknown'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'unknown', 'u.md'), 'x');
    mkdirSync(join(dir, 'deltas', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'reference', 'r.md'), 'x');
    mkdirSync(join(dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'prd', 'any.weird-ext'), 'x'); // 任意扩展名照旧消费
    writeFileSync(join(root, 'inside-target.md'), '## ADDED — a\nb');
    symlinkSync(join(root, 'inside-target.md'), join(dir, 'deltas', 'prd', 'link.md')); // 文件 symlink 照旧跟随
    const consumed = scanDeltas(join(dir, 'deltas')).map(d => d.relativePath);
    expect(consumed).toContain('deltas/prd/any.weird-ext');
    expect(consumed).toContain('deltas/prd/link.md');
    expect(consumed).not.toContain('deltas/unknown/u.md');
    expect(consumed).not.toContain('deltas/reference/r.md');
    // 分类器 mergeDisposition 与消费行为逐字节一致
    for (const e of classifyProposalDeltas(dir)) {
      expect(consumed.includes(e.relativePath), e.relativePath).toBe(e.mergeDisposition === 'mergeable');
    }
  });

  it('UT-S35-25: slug 边界——非法字符/./../绝对路径/分隔符全拒；合法历史目录只读兼容', () => {
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', '/abs', '../up', 'C:evil']) {
      expect(isDangerousSlug(bad), JSON.stringify(bad)).toBe(true);
    }
    expect(isDangerousSlug('change-lint-shift-left')).toBe(false);
    // 历史不合词法但存在的目录：只读兼容可 lint（仍过 containment）
    const { root } = setup({ slug: 'Legacy_Slug99', proposal: proposalMd({ codeRequired: false }) });
    expect(isDangerousSlug('Legacy_Slug99')).toBe(false);
    const r = runLint(root, 'Legacy_Slug99', 'json');
    expect([0, 2]).toContain(r.code);
  });
});

/* ========== ST — 真实 CLI 入口 ========== */

describe('S35 — ST 场景测试', () => {
  it('ST-S35-01: 命令注册与可发现——真实 CLI 入口 --help 收录 change-lint 与 --format json 支持列表', { timeout: 120_000 }, () => {
    const { cleanup, root } = makeTempRoot();
    cleanups.push(cleanup);
    const help = spawnCli(root, ['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/change-lint \[--slug <slug>\]/);
    expect(help.stdout).toMatch(/--format <json>.*change-lint/);
  });

  it('ST-S35-02: 默认人读输出组（真实 CLI）——全过/违规/操作错误三路径，stdout 无 JSON，exit 0/2/1', { timeout: 120_000 }, () => {
    const pass = setup({ proposal: proposalMd({ codeRequired: false }) });
    const rp = spawnCli(pass.root, ['change-lint']);
    expect(rp.status).toBe(0);
    expect(rp.stdout).toContain('✓ L1');
    expect(rp.stdout).toMatch(/PASS（\d+\/\d+）/);
    expect(rp.stdout.trim().startsWith('{')).toBe(false);

    const fail = setup({ tasks: '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/prd/`' });
    const rf = spawnCli(fail.root, ['change-lint']);
    expect(rf.status).toBe(2);
    expect(rf.stdout).toContain('✗');
    // code-r1 F13：每个 ✗ 固定三段「缺什么 / 在哪补 / 补成什么样」
    expect(rf.stdout).toMatch(/✗ L\d \[[a-z_]+\]\n\s+缺什么：.+\n\s+在哪补：.+\n\s+补成什么样：.+/);
    expect(rf.stdout).toMatch(/FAIL（\d+\/\d+，\d+ 项违规）/);
    expect(rf.stdout.trim().startsWith('{')).toBe(false);

    const { root } = setup({ guard: false, proposal: proposalMd({ codeRequired: false }) });
    const re = spawnCli(root, ['change-lint']);
    expect(re.status).toBe(1);
    expect(re.stderr).toContain('Error [no_active_proposal]:');
    expect(re.stdout).toBe('');
  });

  it('ST-S35-02a: JSON envelope 输出组（真实 CLI）——success/error envelope 与 exit 0/2/1、§3.15 字段契约', { timeout: 120_000 }, () => {
    const pass = setup({ proposal: proposalMd({ codeRequired: false }) });
    const rp = spawnCli(pass.root, ['change-lint', '--format', 'json']);
    const ep = JSON.parse(rp.stdout.trim());
    expect(ep.command).toBe('change-lint');
    expect(ep.version).toBeDefined();
    expect(ep.timestamp).toBeDefined();
    expect(ep.data.slug).toBe('feat');
    expect(ep.data.pass).toBe(true);
    expect(ep.data.violations).toEqual([]); // 空数组必在
    expect(rp.status).toBe(0);

    const fail = setup({ tasks: '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/prd/`' });
    const rf = spawnCli(fail.root, ['change-lint', '--format', 'json']);
    const ef = JSON.parse(rf.stdout.trim());
    expect(ef.data.pass).toBe(false);
    expect(ef.data.violations.length).toBeGreaterThan(0);
    expect(rf.status).toBe(2);

    const { root } = setup({ guard: false, proposal: proposalMd({ codeRequired: false }) });
    const re = spawnCli(root, ['change-lint', '--format', 'json']);
    expect(re.status).toBe(1);
    const ee = JSON.parse(re.stderr.trim());
    expect(ee.command).toBe('change-lint');
    expect(ee.error.code).toBe('no_active_proposal');
    expect(re.stdout).toBe(''); // stdout 无第二份输出
  });

  it('ST-S35-03: slug 解析四路径 + F8 argv 边界（真实 CLI）——显式 flag 缺值绝不回退 guard', { timeout: 120_000 }, () => {
    const a = setup({ proposal: proposalMd({ codeRequired: false }) });
    expect(spawnCli(a.root, ['change-lint']).status).toBe(0); // guard 默认活跃提案

    const b = setup({ proposal: proposalMd({ codeRequired: false }), guard: false });
    expect(spawnCli(b.root, ['change-lint', '--slug', 'feat']).status).toBe(0); // --slug 显式（proposal 头解析模块）

    const c = setup({ guard: false });
    const rc = spawnCli(c.root, ['change-lint', '--format', 'json']);
    expect(rc.status).toBe(1);
    expect(JSON.parse(rc.stderr.trim()).error.code).toBe('no_active_proposal');

    const d = setup({ proposal: proposalMd({ codeRequired: false }) });
    const rd = spawnCli(d.root, ['change-lint', '--slug', 'not-exists', '--format', 'json']);
    expect(rd.status).toBe(1);
    expect(JSON.parse(rd.stderr.trim()).error.code).toBe('slug_not_found');
    // code-r1 F8：尾随 --slug（flag 在场缺值）→ slug_invalid，不回退 guard 对错误目标返回成功
    const t1 = spawnCli(d.root, ['change-lint', '--slug']);
    expect(t1.status).toBe(1);
    expect(t1.stderr).toContain('Error [slug_invalid]:');
    // --slug --format json：下一 token 是 option → 同样 slug_invalid（--format 不被当作 slug）
    const t2 = spawnCli(d.root, ['change-lint', '--slug', '--format', 'json']);
    expect(t2.status).toBe(1);
    expect(t2.stderr).toContain('slug_invalid');
    // 重复 flag：取首个 --slug 的值（确定性），合法值照常检查
    const t3 = spawnCli(d.root, ['change-lint', '--slug', 'feat', '--slug', 'ignored']);
    expect(t3.status).toBe(0);
    // 路径穿越显式值 → slug_invalid
    const t4 = spawnCli(d.root, ['change-lint', '--slug', '../../etc', '--format', 'json']);
    expect(t4.status).toBe(1);
    expect(JSON.parse(t4.stderr.trim()).error.code).toBe('slug_invalid');
    // code-r2 F18：严格词法真正生效——非法且**不存在**的 slug 在词法阶段拒（slug_invalid，而非 slug_not_found）
    for (const bad of ['Bad_Slug', '-leading', 'bad slug', '...']) {
      const r = spawnCli(d.root, ['change-lint', '--slug', bad, '--format', 'json']);
      expect(r.status, bad).toBe(1);
      expect(JSON.parse(r.stderr.trim()).error.code, bad).toBe('slug_invalid');
    }
    // 严格合法但不存在 → slug_not_found（词法过、目录缺）
    const rNotFound = spawnCli(d.root, ['change-lint', '--slug', 'strictly-legal-but-missing', '--format', 'json']);
    expect(JSON.parse(rNotFound.stderr.trim()).error.code).toBe('slug_not_found');
    // 历史不合词法但实际存在的目录 → 只读兼容照常检查（真实 CLI）
    const legacy = setup({ slug: 'Legacy_Slug99', proposal: proposalMd({ codeRequired: false }) });
    const rLegacy = spawnCli(legacy.root, ['change-lint', '--slug', 'Legacy_Slug99', '--format', 'json']);
    expect([0, 2]).toContain(rLegacy.status);
  });

  it('ST-S35-03b: not_initialized 前置（真实 CLI）——未初始化目录两档运行均得 not_initialized', { timeout: 120_000 }, () => {
    const { root, cleanup } = makeTempRoot(); // 未初始化：无 logos/
    cleanups.push(cleanup);
    for (const args of [['change-lint', '--format', 'json'], ['change-lint', '--slug', 'whatever', '--format', 'json']]) {
      const r = spawnCli(root, args);
      expect(r.status).toBe(1);
      const e = JSON.parse(r.stderr.trim());
      expect(e.error.code).toBe('not_initialized');
      expect(r.stdout).toBe(''); // 无任何检查输出（L1–L7 未被调用）
    }
  });

  it('ST-S35-03a: 操作错误即终止（真实 CLI）——各错误码单份 stderr 输出、stdout 零输出', { timeout: 120_000 }, () => {
    const errOf = (root: string, args: string[]) => {
      const r = spawnCli(root, [...args, '--format', 'json']);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe(''); // 错误一旦确定即终止：无第二份结果输出
      return JSON.parse(r.stderr.trim()).error;
    };
    const base = setup({ proposal: proposalMd({ codeRequired: false }) });
    expect(errOf(base.root, ['change-lint', '--slug', '../../etc']).code).toBe('slug_invalid');
    expect(errOf(base.root, ['change-lint', '--slug', 'ghost']).code).toBe('slug_not_found');
    // module_unresolved（头缺失 + guard 指向别 slug）
    const m = setup({ proposal: proposalMd({ module: null, codeRequired: false }), guard: { activeChange: 'other', module: 'core' } });
    expect(errOf(m.root, ['change-lint', '--slug', 'feat']).code).toBe('module_unresolved');
    // artifact_unreadable 五档：proposal.md / tasks.md / .md delta / 非 Markdown delta / category 目录
    const p1 = setup({ proposal: proposalMd({ codeRequired: false }) });
    chmodSync(join(p1.dir, 'proposal.md'), 0o000);
    const e1 = errOf(p1.root, ['change-lint']);
    expect(e1.code).toBe('artifact_unreadable');
    expect(e1.message).toContain('proposal.md');
    chmodSync(join(p1.dir, 'proposal.md'), 0o644);

    const p2 = setup({ proposal: proposalMd({ codeRequired: false }) });
    chmodSync(join(p2.dir, 'tasks.md'), 0o000);
    const e2 = errOf(p2.root, ['change-lint']);
    expect(e2.code).toBe('artifact_unreadable');
    expect(e2.message).toContain('tasks.md');
    chmodSync(join(p2.dir, 'tasks.md'), 0o644);

    const p3 = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(p3.dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(p3.dir, 'deltas', 'prd', 'x.md'), '## ADDED — a\nb');
    chmodSync(join(p3.dir, 'deltas', 'prd', 'x.md'), 0o000);
    const e3 = errOf(p3.root, ['change-lint']);
    expect(e3.code).toBe('artifact_unreadable');
    expect(e3.message).toContain('x.md');
    chmodSync(join(p3.dir, 'deltas', 'prd', 'x.md'), 0o644);

    const p4 = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(p4.dir, 'deltas', 'api'), { recursive: true });
    writeFileSync(join(p4.dir, 'deltas', 'api', 'schema.yaml'), 'openapi: 3.0.0');
    chmodSync(join(p4.dir, 'deltas', 'api', 'schema.yaml'), 0o000);
    const e4 = errOf(p4.root, ['change-lint']);
    expect(e4.code).toBe('artifact_unreadable');
    expect(e4.message).toContain('schema.yaml');
    chmodSync(join(p4.dir, 'deltas', 'api', 'schema.yaml'), 0o644);

    const p5 = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(p5.dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(p5.dir, 'deltas', 'prd', 'ok.md'), '## ADDED — a\nb');
    chmodSync(join(p5.dir, 'deltas', 'prd'), 0o000);
    expect(errOf(p5.root, ['change-lint']).code).toBe('artifact_unreadable');
    chmodSync(join(p5.dir, 'deltas', 'prd'), 0o755);
    // code-r3 F7：错误确定即终止——字典序前置目录 EACCES 后，后序目录不再被枚举
    // （分类结果仅含该 ioError 条目，字典序更晚的 deltas/prd/later.md 不出现在清单中）
    const p6 = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(p6.dir, 'deltas', 'api'), { recursive: true });
    mkdirSync(join(p6.dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(p6.dir, 'deltas', 'prd', 'later.md'), '## ADDED — a\nb');
    chmodSync(join(p6.dir, 'deltas', 'api'), 0o000);
    const failFast = classifyProposalDeltas(p6.dir);
    expect(failFast.length).toBe(1);
    expect(failFast[0].ioError).toBeDefined();
    expect(failFast[0].relativePath).toBe('deltas/api');
    expect(failFast.some(e => e.relativePath === 'deltas/prd/later.md')).toBe(false); // 后序产物未被读取
    expect(errOf(p6.root, ['change-lint']).code).toBe('artifact_unreadable');
    chmodSync(join(p6.dir, 'deltas', 'api'), 0o755);
    // r4 F7：边界内 symlink 目标 EACCES ≠ 断链——真实读取失败必须 fail-fast 为 artifact_unreadable，
    // 且错误确定后不读后序探针（字典序更晚的 z-later.md 不出现在分类结果中）
    const p7 = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(p7.dir, 'locked'), { recursive: true });
    writeFileSync(join(p7.dir, 'locked', 'target.md'), '## ADDED — a\nb');
    mkdirSync(join(p7.dir, 'deltas', 'prd'), { recursive: true });
    symlinkSync(join('..', '..', 'locked', 'target.md'), join(p7.dir, 'deltas', 'prd', 'a-link.md'));
    writeFileSync(join(p7.dir, 'deltas', 'prd', 'z-later.md'), '## ADDED — a\nb');
    chmodSync(join(p7.dir, 'locked'), 0o000);
    try {
      const symlinkFailFast = classifyProposalDeltas(p7.dir);
      expect(symlinkFailFast.length).toBe(1);
      expect(symlinkFailFast[0].ioError).toBeDefined();
      expect(symlinkFailFast[0].relativePath).toBe('deltas/prd/a-link.md');
      expect(symlinkFailFast.some(e => e.relativePath === 'deltas/prd/z-later.md')).toBe(false); // 后序探针未被读取
      const e7 = errOf(p7.root, ['change-lint']);
      expect(e7.code).toBe('artifact_unreadable');
      expect(e7.message).toContain('a-link.md');
    } finally {
      chmodSync(join(p7.dir, 'locked'), 0o755);
    }
    // 错误码分流不误伤断链分支：真正断链仍是 L6 delta_path_invalid（exit 2，非 artifact_unreadable）
    const p8 = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(p8.dir, 'deltas', 'prd'), { recursive: true });
    symlinkSync(join('..', '..', 'missing.md'), join(p8.dir, 'deltas', 'prd', 'broken.md'));
    const rBroken = spawnCli(p8.root, ['change-lint', '--format', 'json']);
    expect(rBroken.status).toBe(2);
    const brokenCodes = JSON.parse(rBroken.stdout.trim()).data.violations.map((v: { code: string }) => v.code);
    expect(brokenCodes).toContain('delta_path_invalid');
    // r5 F7：本地 ignored delta（L6 忽略但仍属 deltas/**）不可读同样是操作级红线——
    // reference 类别普通文件 chmod 000 → artifact_unreadable（exit 1、无 success envelope、message 含路径）
    const p9 = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(p9.dir, 'deltas', 'reference'), { recursive: true });
    writeFileSync(join(p9.dir, 'deltas', 'reference', 'r.md'), '参考材料');
    chmodSync(join(p9.dir, 'deltas', 'reference', 'r.md'), 0o000);
    try {
      const e9 = errOf(p9.root, ['change-lint']);
      expect(e9.code).toBe('artifact_unreadable');
      expect(e9.message).toContain('deltas/reference/r.md');
    } finally {
      chmodSync(join(p9.dir, 'deltas', 'reference', 'r.md'), 0o644);
    }
    // 隐藏普通文件 chmod 000 → 同判 artifact_unreadable（explicitly_ignored 不豁免可读性探测）
    const p10 = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(p10.dir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(p10.dir, 'deltas', 'prd', '.hidden.md'), '隐藏');
    chmodSync(join(p10.dir, 'deltas', 'prd', '.hidden.md'), 0o000);
    try {
      const e10 = errOf(p10.root, ['change-lint']);
      expect(e10.code).toBe('artifact_unreadable');
      expect(e10.message).toContain('deltas/prd/.hidden.md');
    } finally {
      chmodSync(join(p10.dir, 'deltas', 'prd', '.hidden.md'), 0o644);
    }
    // 后序探针锁定 fail-fast：两个不可读条目并存时，错误恒为稳定路径序的**首个**
    // （deltas/prd/.hidden.md < deltas/reference/r.md），单份 stderr、不出现后序路径
    const p11 = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(p11.dir, 'deltas', 'prd'), { recursive: true });
    mkdirSync(join(p11.dir, 'deltas', 'reference'), { recursive: true });
    writeFileSync(join(p11.dir, 'deltas', 'prd', '.hidden.md'), '隐藏');
    writeFileSync(join(p11.dir, 'deltas', 'reference', 'r.md'), '参考材料');
    chmodSync(join(p11.dir, 'deltas', 'prd', '.hidden.md'), 0o000);
    chmodSync(join(p11.dir, 'deltas', 'reference', 'r.md'), 0o000);
    try {
      const e11 = errOf(p11.root, ['change-lint']);
      expect(e11.code).toBe('artifact_unreadable');
      expect(e11.message).toContain('deltas/prd/.hidden.md');
      expect(e11.message).not.toContain('deltas/reference/r.md'); // 错误确定后不再读取/报告后序产物
    } finally {
      chmodSync(join(p11.dir, 'deltas', 'prd', '.hidden.md'), 0o644);
      chmodSync(join(p11.dir, 'deltas', 'reference', 'r.md'), 0o644);
    }
  });

  it('ST-S35-04: 命令兼容三路径（真实 CLI）——`change lint` 字节序列仍创建提案（S09 零改动）/ change-lint 执行检查 / --slug lint 可检查', { timeout: 120_000 }, () => {
    const { root, cleanup } = makeTempRoot();
    cleanups.push(cleanup);
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', product_type: 'cli' }],
    }, { lineWidth: 0 }));
    // (a) 真实字节序列 `openlogos change lint` 的既有含义：创建 slug 为 lint 的提案（S09 零改动）
    const ra = spawnCli(root, ['change', 'lint']);
    expect(ra.status).toBe(0);
    expect(existsSync(join(root, 'logos', 'changes', 'lint'))).toBe(true);
    // (b)(c) `change-lint` 对该提案执行检查（覆盖真实内容后 --slug lint 可 lint）
    writeFileSync(join(root, 'logos', 'changes', 'lint', 'proposal.md'), proposalMd({ codeRequired: false }));
    writeFileSync(join(root, 'logos', 'changes', 'lint', 'tasks.md'), '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/prd/`\n');
    const rb = spawnCli(root, ['change-lint', '--format', 'json']); // guard 由 change 写入 activeChange=lint
    expect([0, 2]).toContain(rb.status);
    const rc = spawnCli(root, ['change-lint', '--slug', 'lint', '--format', 'json']);
    expect([0, 2]).toContain(rc.status);
    expect(JSON.parse(rc.stdout.trim()).data.slug).toBe('lint');
  });

  it('ST-S35-04a: 双模块 L7 归属（真实 CLI）——--slug 指向的提案按其自身模块判 L7、与 guard 指向无关', { timeout: 120_000 }, () => {
    const build = (headerModule: string, guardOn: 'a' | 'b') => {
      const { root, cleanup } = makeTempRoot();
      cleanups.push(cleanup);
      scaffoldProject(root, { locale: 'zh' });
      writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
        modules: [
          { id: 'cli-mod', name: 'A', lifecycle: 'launched', product_type: 'cli' },
          { id: 'gui-mod', name: 'B', lifecycle: 'launched', product_type: 'desktop' },
        ],
      }, { lineWidth: 0 }));
      const slugA = 'prop-a';
      writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({
        activeChange: guardOn === 'a' ? slugA : 'prop-b',
        module: guardOn === 'a' ? 'cli-mod' : 'gui-mod',
      }));
      const dir = join(root, 'logos', 'changes', slugA);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'proposal.md'), proposalMd({ module: headerModule, codeRequired: false })); // 无 UI 声明段
      writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/prd/`\n');
      return { root, slugA };
    };
    // 真实 CLI（F12）：guard 指向 GUI 模块提案，但 --slug 指向 CLI 模块提案 → L7 不激活（无坏声明违规）
    const violationsVia = (root: string, slug: string) => {
      const r = spawnCli(root, ['change-lint', '--slug', slug, '--format', 'json']);
      expect([0, 2]).toContain(r.status);
      return JSON.parse(r.stdout.trim()).data.violations.map((v: any) => v.code);
    };
    const a = build('cli-mod', 'b');
    expect(violationsVia(a.root, a.slugA)).not.toContain('ui_declaration_missing');
    // 反向：--slug 指向 GUI 模块提案（头 gui-mod）→ L7 激活（缺声明段 → ui_declaration_missing）
    const b = build('gui-mod', 'a');
    expect(violationsVia(b.root, b.slugA)).toContain('ui_declaration_missing');
    // 无 guard、显式 slug → 按 proposal 头解析
    const c = build('gui-mod', 'a');
    const { root: rootC, slugA: slugC } = c;
    writeFileSync(join(rootC, 'logos', '.openlogos-guard'), ''); // 损坏 guard 等价缺失
    expect(violationsVia(rootC, slugC)).toContain('ui_declaration_missing');
  });

  it('ST-S35-05: 聚合排序端到端（真实 CLI）——含同 check/code/path ≥3 条逐行违规的精确全序、两次运行同序', { timeout: 120_000 }, () => {
    const build = () => setup({
      proposal: proposalMd({
        deploy: '是',
        reuseLines: ['- UT-S99-91 — 不存在一', '- UT-S99-92 — 不存在二', '- UT-S99-93 — 不存在三'],
      }),
      tasks: '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/prd/`', // L2 缺 [code] + L5 冲突
    });
    // 真实 CLI（F12）：violations 取自 spawn 的 stdout envelope
    const violationsVia = (root: string): any[] => {
      const r = spawnCli(root, ['change-lint', '--format', 'json']);
      expect(r.status).toBe(2);
      return JSON.parse(r.stdout.trim()).data.violations;
    };
    const seqOf = (root: string) => violationsVia(root).map((v: any) => `${v.code}@${v.path}#${v.message.slice(0, 24)}`);
    const f1 = build();
    const s1 = seqOf(f1.root);
    const s2 = seqOf(f1.root); // 同一夹具重复运行
    expect(s2).toEqual(s1);
    const f2 = build();
    expect(seqOf(f2.root)).toEqual(s1); // 同输入必得同序列
    // 全序：L2（tasks.md）→ L3 proposal.md 三条按源位置出现序 → L3 tasks.md 无证据 → L5 proposal.md
    const violations = violationsVia(f1.root);
    expect(violations.map((v: any) => v.code)).toEqual([
      'tasks_code_header_missing',
      'code_change_requires_real_test_ids', 'code_change_requires_real_test_ids', 'code_change_requires_real_test_ids',
      'code_change_requires_real_test_ids',
      'deployment_decision_conflict',
    ]);
    const l3 = violations.filter((v: any) => v.code === 'code_change_requires_real_test_ids' && v.path.endsWith('proposal.md'));
    expect(l3.map((v: any) => v.message.includes('UT-S99-91') ? 1 : v.message.includes('UT-S99-92') ? 2 : 3)).toEqual([1, 2, 3]);
  });

  it('ST-S35-06: 只读性（项目级，真实 CLI）——五条路径运行前后全量条目（含 symlink/空目录）与哈希完全不变', { timeout: 120_000 }, () => {
    // ① exit 0（非 GUI 全过）——夹具含空目录与 symlink，验证 F17 快照覆盖非普通文件
    const p0 = setup({ proposal: proposalMd({ codeRequired: false }) });
    mkdirSync(join(p0.root, 'empty-dir'), { recursive: true });
    symlinkSync(join(p0.root, 'logos'), join(p0.root, 'link-to-logos'));
    const s0 = snapshotTree(p0.root);
    expect(s0.get('/empty-dir')).toBe('dir');
    expect(String(s0.get('/link-to-logos'))).toContain('symlink:');
    expect(spawnCli(p0.root, ['change-lint']).status).toBe(0);
    expect(snapshotTree(p0.root)).toEqual(s0);
    // ② exit 2（检查红）
    const p2 = setup({ tasks: '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/prd/`' });
    const s2 = snapshotTree(p2.root);
    expect(spawnCli(p2.root, ['change-lint']).status).toBe(2);
    expect(spawnCli(p2.root, ['change-lint', '--format', 'json']).status).toBe(2);
    expect(snapshotTree(p2.root)).toEqual(s2);
    // ③ exit 1（操作错误）
    const s2b = snapshotTree(p2.root);
    expect(spawnCli(p2.root, ['change-lint', '--slug', 'ghost']).status).toBe(1);
    expect(snapshotTree(p2.root)).toEqual(s2b);
    // ④ GUI ui_impact:false
    const g0 = guiSetup(VALID_UI_DECL);
    const sg0 = snapshotTree(g0.root);
    expect(spawnCli(g0.root, ['change-lint']).status).toBe(0);
    expect(snapshotTree(g0.root)).toEqual(sg0);
    // ⑤ GUI ui_impact:true（全过夹具——含 evaluateUiPrototype 通过路径，仍零写入，无 UI_PROTOTYPE_HASHES.json）
    const g1 = validUiFixture();
    const sg1 = snapshotTree(g1.root);
    expect(spawnCli(g1.root, ['change-lint']).status).toBe(0);
    expect(snapshotTree(g1.root)).toEqual(sg1);
    expect(existsSync(join(g1.dir, 'UI_PROTOTYPE_HASHES.json'))).toBe(false);
  });
});

