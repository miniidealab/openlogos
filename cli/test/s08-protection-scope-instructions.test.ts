/**
 * verify-self-sufficient-cases 切片 2：生成指令的保护范围条款与 guard 同口径。
 * 用例 ID 与 logos/resources/test/core-S08-test-cases.md「生成指令保护范围条款与 guard 同口径测试用例」
 * 严格对齐（UT-S08-90～92）；口径权威见 spec/agents-md.md「变更管理例外文件清单与保护范围配置」第 2、3、5 条。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAgentsMd, generatePolicyMdc } from '../src/commands/init.js';
import { readLifecycleView } from '../src/lib/lifecycle-view.js';
import { buildMlgProject } from './s09-module-lifecycle-fixtures.js';

const CLI = resolve(import.meta.dirname, '../dist/index.js');
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'openlogos-psi-'));
  roots.push(d);
  return d;
}
function run(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `${args.join(' ')}\n${r.stderr}`).toBe(0);
  return r;
}

const NEW_ZH = '`.gitignore`、`.git/info/exclude` 与 `logos/logos.config.json` 的 `guard` 字段决定 guard 的保护范围，不得直接修改；需要忽略或豁免路径时，直接执行 `openlogos ignore add|remove …` 或 `openlogos exempt add|remove …`（`list` 不受限），由宿主对这次命令弹出原生审批、用户批准后执行；若 guard 提示当前权限模式下宿主不会弹出审批，请用户在终端用 `! <命令原文>` 自行执行，或切换到默认权限模式后重试，不得以对话中的口头同意替代审批。`logos/logos.config.json` 的其他字段（如 `verify.requirements`）只在已立案且属于当前提案范围时，由实现任务直接修改。';
const NEW_EN = '`.gitignore`, `.git/info/exclude` and the `guard` field of `logos/logos.config.json` define the guard\'s protection scope and must not be edited directly. To ignore or exempt a path, run `openlogos ignore add|remove …` or `openlogos exempt add|remove …` directly (`list` is unrestricted); the host will show its native approval prompt for that command and it runs only after the user approves. If the guard reports that the current permission mode will not show an approval prompt, ask the user to run `! <command>` in the terminal or switch to the default permission mode and retry; a verbal "yes" in the conversation never replaces the approval. Other fields of `logos/logos.config.json` (such as `verify.requirements`) may be edited directly by the implementation task only when a change proposal is active and the edit is within its scope.';
/** 旧口径：对整份 logos.config.json 的禁改文案（不得再出现）。 */
const OLD_ZH_FRAGMENT = '与 `logos/logos.config.json` 决定 guard 的保护范围';
const OLD_EN_FRAGMENT = 'and `logos/logos.config.json` define the guard\'s protection scope';

/** init 一个项目，改为 launched 后 sync，返回生成的 AGENTS.md / CLAUDE.md。 */
function initLaunchedAndSync(locale: 'zh' | 'en') {
  const root = tmp();
  run(['init', 'demo', '--locale', locale, '--ai-tool', 'claude-code'], root);
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace('lifecycle: initial', 'lifecycle: launched'));
  run(['sync'], root);
  return {
    root,
    agents: readFileSync(join(root, 'AGENTS.md'), 'utf8'),
    claude: readFileSync(join(root, 'CLAUDE.md'), 'utf8'),
  };
}

const protectionLine = (text: string, label: string) =>
  text.split('\n').find(l => l.startsWith(`- **${label}**`) || l.startsWith(`- ${label}`));

describe('生成指令保护范围条款与 guard 同口径', () => {
  it('UT-S08-90: zh locale 下 init / sync 生成的保护范围条款为新口径', () => {
    // init 写入的托管段与 sync 重渲染同出 createAgentsMd：直接断言生成函数，再用真实 sync 落盘核对
    for (const target of ['agents', 'claude'] as const) {
      const text = createAgentsMd('zh', 'claude-code', target, true);
      expect(text).toContain(`- **保护范围配置**：${NEW_ZH}`);
      expect(text).not.toContain(OLD_ZH_FRAGMENT);
    }
    const { agents, claude } = initLaunchedAndSync('zh');
    for (const file of [agents, claude]) {
      expect(file).toContain(`- **保护范围配置**：${NEW_ZH}`);
      expect(file).not.toContain(OLD_ZH_FRAGMENT);
      // 保护范围字段仍指向受限命令；其余字段限已立案的提案范围
      expect(file).toContain('`logos/logos.config.json` 的 `guard` 字段决定 guard 的保护范围，不得直接修改');
      expect(file).toContain('只在已立案且属于当前提案范围时，由实现任务直接修改');
    }
    expect(generatePolicyMdc('zh', true)).toContain(`- 保护范围配置：${NEW_ZH}`);
  });

  it('UT-S08-91: en locale 下同一条款为新口径', () => {
    for (const target of ['agents', 'claude'] as const) {
      const text = createAgentsMd('en', 'claude-code', target, true);
      expect(text).toContain(`- **Protection scope**: ${NEW_EN}`);
      expect(text).not.toContain(OLD_EN_FRAGMENT);
    }
    const { agents, claude } = initLaunchedAndSync('en');
    for (const file of [agents, claude]) {
      expect(file).toContain(`- **Protection scope**: ${NEW_EN}`);
      expect(file).not.toContain(OLD_EN_FRAGMENT);
    }
    expect(generatePolicyMdc('en', true)).toContain(`- Protection scope: ${NEW_EN}`);
  });

  it('UT-S08-92: 存量项目 sync 只更新托管段；mixed 视图同口径', () => {
    const { root, claude } = initLaunchedAndSync('zh');
    const claudePath = join(root, 'CLAUDE.md');
    // 构造存量：托管段换回旧文案，托管段外前后各有用户内容
    const legacyLine = `- **保护范围配置**：${NEW_ZH
      .replace('与 `logos/logos.config.json` 的 `guard` 字段决定', '与 `logos/logos.config.json` 决定')
      .replace('`logos/logos.config.json` 的其他字段（如 `verify.requirements`）只在已立案且属于当前提案范围时，由实现任务直接修改。', '')}`;
    const managed = claude.replace(`- **保护范围配置**：${NEW_ZH}`, legacyLine);
    expect(managed).toContain(OLD_ZH_FRAGMENT);
    const userHead = '# 我的项目说明\n\n用户自己写的开头段落。\n\n';
    const userTail = '\n\n## 用户自定义尾部\n\n这里的内容不得被 sync 改动。\n';
    writeFileSync(claudePath, `${userHead}${managed}${userTail}`);

    run(['sync'], root);
    const after = readFileSync(claudePath, 'utf8');
    expect(after).toContain(`- **保护范围配置**：${NEW_ZH}`);
    expect(after).not.toContain(OLD_ZH_FRAGMENT);
    expect(after.startsWith(userHead)).toBe(true);
    expect(after.endsWith(userTail)).toBe(true);

    // 混合生命周期视图（mixed）下生成的同一条款与 launched 视图逐字一致
    const mixed = readLifecycleView(buildMlgProject(tmp(), 'M-repo'));
    expect(mixed.kind).toBe('mixed');
    for (const locale of ['zh', 'en'] as const) {
      const label = locale === 'zh' ? '保护范围配置' : 'Protection scope';
      for (const target of ['agents', 'claude'] as const) {
        const launchedLine = protectionLine(createAgentsMd(locale, 'claude-code', target, true), label);
        const mixedLine = protectionLine(createAgentsMd(locale, 'claude-code', target, mixed), label);
        expect(launchedLine, `${locale} ${target}`).toBeDefined();
        expect(mixedLine, `${locale} ${target}`).toBe(launchedLine);
      }
    }
  });
});
