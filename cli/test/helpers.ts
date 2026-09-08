import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi, type MockInstance } from 'vitest';

/**
 * 为关注点不在 plan scaffold 的历史测试夹具补齐 canonical Plan Package。
 *
 * 生产代码必须把缺少该区块的 writing/legacy 提案判为待回填；旧测试若关注的并非
 * 决策澄清本身，应显式调用本 helper，避免无关用例被新 plan 出口门抢占。
 */
export function withCompleteClarification(content: string): string {
  let normalized = content.trimEnd();
  const additions: string[] = [];
  const canonicalHints = ['变更原因', '变更类型', '变更范围', '部署影响', '变更概述']
    .filter(title => new RegExp(`^##\\s+${title}\\s*$`, 'm').test(normalized)).length;
  if (canonicalHints >= 2) {
    if (!/^##\s+变更原因\s*$/m.test(normalized)) additions.push('## 变更原因\n测试夹具需要覆盖既有行为。');
    if (!/^##\s+变更类型\s*$/m.test(normalized)) additions.push('## 变更类型\n代码级');
    if (!/^##\s+变更范围\s*$/m.test(normalized)) additions.push('## 变更范围\n- 测试夹具');
    if (!/^##\s+部署影响\s*$/m.test(normalized)) additions.push([
      '## 部署影响',
      '- 是否需要部署：否',
      '- 部署原因：测试夹具不产生部署影响',
      '- 影响环境：无',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：否',
      '- 是否需要 smoke：否',
    ].join('\n'));
    if (!/^##\s+变更概述\s*$/m.test(normalized)) additions.push('## 变更概述\n测试夹具保持既有行为。');
  }
  if (additions.length > 0) normalized += `\n\n${additions.join('\n\n')}`;
  if (/^##\s+(?:决策澄清|Decision Clarification)\s*$/m.test(normalized)) return normalized;
  return `${normalized}\n\n## 决策澄清\n\n\`\`\`yaml\n` + [
    'schema: openlogos/clarification@1',
    'mode: adaptive',
    'status: complete',
    'impacts:',
    '  data:',
    '    status: none',
    '    reason: 测试夹具不涉及数据影响',
    '  compatibility:',
    '    status: none',
    '    reason: 测试夹具不涉及兼容性影响',
    '  security_privacy:',
    '    status: none',
    '    reason: 测试夹具不涉及安全或隐私影响',
    '  public_release:',
    '    status: none',
    '    reason: 测试夹具不涉及公开发布',
    '  external_commitment:',
    '    status: none',
    '    reason: 测试夹具不涉及外部承诺',
    'decisions:',
    '  - id: C99',
    '    category: deployment',
    '    question: 测试夹具是否需要部署？',
    '    answer: 沿用夹具中的部署声明',
    '    rationale: 该决定仅用于隔离非澄清用例',
    '    source: user',
    '    affects:',
    '      - proposal',
    '    rejected_options: []',
    'unresolved: []',
    'defaults: []',
  ].join('\n') + '\n```\n';
}

/**
 * Create an isolated temp directory that mimics an OpenLogos project root.
 * Returns { root, cleanup }.
 */
export function makeTempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-test-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Scaffold a minimal OpenLogos project structure inside `root`.
 */
export function scaffoldProject(
  root: string,
  opts: { name?: string; locale?: 'en' | 'zh' } = {},
) {
  const name = opts.name ?? 'test-project';
  const locale = opts.locale ?? 'en';

  const config = {
    name,
    locale,
    description: '',
    documents: {},
    verify: {
      result_path: 'logos/resources/verify/test-results.jsonl',
      sandbox_mode: 'auto',
      sandbox_root: '/private/tmp',
      sandbox_deny_workspace_write: true,
    },
    smoke: {
      result_path: 'logos/resources/verify/smoke-results.jsonl',
      report_path: 'logos/resources/verify/smoke-report.md',
      sandbox_mode: 'auto',
      sandbox_root: '/private/tmp',
      sandbox_deny_workspace_write: true,
    },
  };

  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify(config, null, 2));

  // fixture 必须与 `openlogos init` 真实模板同形（含 `resource_index: []` 空 flow sequence 与
  // `conventions:` 块）。历史 fixture 二者皆无，导致补录走 EOF 分支、恰好产出合法 YAML，
  // 把「`[]` 形态上写出非法 YAML」这条真实路径长期挡在回归之外。
  const yaml = `project:\n  name: "${name}"\n  description: ""\n  methodology: "OpenLogos"\n\n`
    + `resource_index: []\n\n`
    + `conventions:\n  - "遵循 OpenLogos 三层推进模型（Why → What → How）"\n`;
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), yaml);

  const dirs = [
    'logos/resources/prd/1-product-requirements',
    'logos/resources/prd/2-product-design',
    'logos/resources/prd/3-technical-plan/1-architecture',
    'logos/resources/prd/3-technical-plan/2-scenario-implementation',
    'logos/resources/api',
    'logos/resources/database',
    'logos/resources/test',
    'logos/resources/scenario',
    'logos/resources/verify',
    'logos/changes',
    'logos/changes/archive',
  ];
  for (const d of dirs) {
    mkdirSync(join(root, d), { recursive: true });
  }
}

/**
 * Capture console.log / console.error / console.warn output as string arrays.
 * Returns { logs, errors, warns, restore }.
 */
export function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
    logs.push(args.map(String).join(' ')); // also mirror to logs for backward compat
  });

  return {
    logs,
    errors,
    warns,
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
}

/**
 * Mock process.cwd to return a specific path.
 * Returns a restore function.
 */
export function mockCwd(dir: string): () => void {
  const original = process.cwd;
  process.cwd = () => dir;
  return () => { process.cwd = original; };
}

/**
 * Mock process.exit to throw instead of killing the process.
 * Returns the spy.
 */
export function mockProcessExit(): MockInstance {
  return vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    throw new Error(`process.exit(${code})`);
  });
}

/**
 * change-flow-redesign：builtin launched 的 implement 子流程默认激活切片循环
 * （until: code_slices_green, max_iters: 30）。任何处于 verify-pass 之后的 launched 提案
 * 在真实流程中由 `openlogos verify` 同时写一行 pass 的 LOOP_ITERS 账本（loop 收敛）。
 * 合成测试 fixture 写 VERIFY_PASS marker 时须补写这行账本，否则 loop 未收敛会把
 * proposal_step 回拉到 ready-to-verify（converged 裁决出环，见 spec/flow-spec.md §6/§12.4）。
 * @param proposalDir 提案目录（VERIFY_PASS 同目录）
 * @param module 归属模块（默认 core，须与 guard.module 一致）
 */
export function writeLoopPass(proposalDir: string, module = 'core'): void {
  writeFileSync(
    join(proposalDir, 'LOOP_ITERS'),
    JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module, timestamp: '2026-06-20T00:00:00.000Z' }) + '\n',
  );
}

/**
 * 把桩提案补成 **merge 可受理**的合规提案。
 *
 * 0.14.9 起 merge 的准入判定等于 change-lint 的完整结论（架构 §四十一.6.1），因此关注点不在
 * 提案结构的历史 merge 夹具需要显式补齐真实提案必备的要素：`> module:` 头、canonical 章节、
 * 决策澄清与 Authority Impact。这与 `withCompleteClarification` 是同一类补齐，只是覆盖 merge 准入
 * 所要求的全集；桩提案（`# Title` 之类）在真实流程中本就不可能通过 plan 门。
 */
export function mergeAdmissibleProposal(title = '夹具提案', moduleId = 'core'): string {
  return withCompleteClarification([
    `# ${title}`,
    '',
    `> module: ${moduleId}`,
    '',
    '## 变更原因',
    '测试夹具需要覆盖既有 merge 行为。',
    '',
    '## 变更类型',
    '需求级变更。',
    '',
    '## 变更范围',
    '- 测试夹具。',
    '',
    '## 部署影响',
    '- 是否需要部署：否',
    '- 部署原因：测试夹具不产生部署影响',
    '- 影响环境：无',
    '- 是否涉及数据迁移：否',
    '- 是否需要回滚预案：否',
    '- 是否需要 smoke：否',
    '',
    '## 变更概述',
    '测试夹具保持既有行为。',
    '',
  ].join('\n'));
}

/** 与 `mergeAdmissibleProposal` 配套的最小合规 tasks.md（无 scaffold 占位）。 */
export function mergeAdmissibleTasks(deltaTasks: string[] = []): string {
  const items = deltaTasks.length > 0 ? deltaTasks : ['- [ ] 夹具不产出 delta。'];
  // 不写 [code] 段——夹具不产出代码，避免触发 code_change_requires_real_test_ids。
  return ['# 实现任务', '', '## [delta] 规格变更', '', ...items, ''].join('\n');
}

/**
 * 为夹具项目注册 `core` 模块（与 `openlogos init` 真实模板同形）。
 *
 * `scaffoldProject` 刻意不写 `modules:`——部分用例正是要覆盖「yaml 无 modules[]」这一状态
 * （如 ST-JSON-15、UT-S17-01 与 golden baseline）。但任何 module-aware 判据（L7 UI 门、
 * 0.14.9 起 merge 准入的模块解析）在无注册表时判 module_unresolved，而真实 init 一定写它。
 * 因此需要模块的夹具显式调用本函数，不改变其它用例的既有状态。
 */
export function registerCoreModule(root: string, lifecycle = 'initial'): void {
  const path = join(root, 'logos', 'logos-project.yaml');
  const yaml = readFileSync(path, 'utf8');
  if (/^modules:/m.test(yaml)) return;
  writeFileSync(path, `modules:\n  - id: core\n    name: 核心功能\n    lifecycle: ${lifecycle}\n\n${yaml}`);
}
