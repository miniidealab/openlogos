/**
 * slice-01-orchestration-full-file-channel 实现验收（S39 侧）。
 *
 * 覆盖 UT-S39-70～UT-S39-75 与 ST-S39-31，对应场景 S39「编排 JSON 的整文件协议适用与校验入口」。
 * 结果由全局 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 *
 * 断言纪律（三条，均针对本次事故的成因）：
 * ① 全部合法性判定经**公开入口** `validateAndStripNonMarkdownDelta` 求值——`duplicateAwareObject`
 *    是内部函数、编排路径此前根本走不到它，只测内部函数会让入口缺口继续隐形。
 * ② UT-S39-72 断言错误**发生在 change-lint 阶段**（读 violations 与退出码两个真实输出），
 *    而不只断言「最终失败」——事故形态正是 lint 全绿、merge 才炸。
 * ③ 夹具一律在一次性隔离项目内构造；本仓 `logos/resources/scenario/` 为空，本次修复的是
 *    **下游项目**该目录的可合并性。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  NON_MARKDOWN_CATEGORIES, classifyCanonicalTargetCategory, isNonMarkdownCategory,
} from '../src/lib/canonical-target.js';
import { validateAndStripNonMarkdownDelta } from '../src/lib/non-markdown-delta.js';
import { planDirectTargets } from '../src/lib/merge-direct.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import BASELINE from './fixtures/s39-orchestration-baseline.json' with { type: 'json' };
import { invoke } from './frontier-fixture.js';

const roots: string[] = [];
afterAll(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

const SLUG = 'orch-fixture';
const ORCH_TARGET = 'logos/resources/scenario/core-auth.json';

type EntryCase = { ok: boolean; message: string | null; tier: string | null;
  degradation: { dialect: string; reason: string } | null; payloadEqualsBody: boolean | null };
type LintScenario = { files: Record<string, string>; result: {
  ok: boolean; checkIds: number[]; total: number; passed: number; pass: boolean;
  violationCodes: string[]; checkViolations: Record<string, number> } };

const entryCase = (key: string): EntryCase =>
  (BASELINE.entryCases as unknown as Record<string, EntryCase>)[key];
const lintScenario = (key: string): LintScenario =>
  (BASELINE.lintScenarios as unknown as Record<string, LintScenario>)[key];

/** 把基线里内联的夹具文件原样物化——构造点即基线本身，不可能与捕获时漂移。 */
function materialize(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-orch-'));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

function lintOf(root: string) {
  const result = runChangeLint(root, join(root, 'logos/changes', SLUG), SLUG);
  return {
    ok: result.ok,
    checkIds: result.checks.map(c => c.id),
    total: result.checks.length,
    passed: result.checks.filter(c => c.violations === 0).length,
    pass: result.violations.length === 0,
    violationCodes: [...new Set(result.violations.map(v => v.code))].sort(),
    checkViolations: Object.fromEntries(result.checks.map(c => [String(c.id), c.violations])),
    violations: result.violations,
  };
}

/** 一份**合法 JSON 对象**，但既不是 OpenAPI 文档、也不符合受控根 JSON Schema 形态。 */
const NON_OPENAPI_BODY = JSON.stringify({ name: '登录', steps: [{ id: 'S1', call: 'POST /login' }] }, null, 2) + '\n';
const marker = (mode: 'CREATE' | 'MODIFY', target: string) =>
  mode === 'CREATE' ? `## ADDED — ${target}（新文件，整文件）\n` : `## MODIFIED — ${target}（整文件替换）\n`;

/** 只为求「入口是否受理 / 落哪条分支」而准备的最小项目根（SQL 分支需要它解析方言）。 */
function minimalRoot(dialect = 'sqlite'): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-orch-min-'));
  roots.push(root);
  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 'orch', locale: 'zh' }));
  writeFileSync(join(root, 'logos/logos-project.yaml'), [
    'project:', '  name: orch', 'tech_stack:', `  database: ${dialect}`,
    'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', '',
  ].join('\n'));
  return root;
}

describe('S39 单元测试——编排 JSON 整文件协议与类别集合单点', () => {
  it('UT-S39-70: MODIFY 整文件替换成功，落盘字节等于剥离后正文', () => {
    const root = materialize(lintScenario('orch-legal').files);
    const body = readFileSync(
      join(root, 'logos/changes', SLUG, 'deltas/scenario/core-auth.json'), 'utf8',
    ).split('\n').slice(1).join('\n');

    // ① 公开入口受理并原样返回 payload（不重排、不重新序列化）
    const checked = validateAndStripNonMarkdownDelta(
      readFileSync(join(root, 'logos/changes', SLUG, 'deltas/scenario/core-auth.json'), 'utf8'),
      'MODIFY', ORCH_TARGET, { root },
    );
    expect(checked.ok, checked.message).toBe(true);
    expect(checked.payload).toBe(body);

    // ② 模式由磁盘事实判为 MODIFY，且 merge 不读 proposal 的任何 YAML 声明
    const targets = planDirectTargets(root, join(root, 'logos/changes', SLUG));
    const orchestration = targets.find(t => t.targetPath === ORCH_TARGET)!;
    expect(orchestration.mode).toBe('MODIFY');
    expect(orchestration.category).toBe('orchestration');
    const proposalPath = join(root, 'logos/changes', SLUG, 'proposal.md');
    const original = readFileSync(proposalPath, 'utf8');
    writeFileSync(proposalPath, `${original}\n\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure: [unclosed\n : : :\n\`\`\`\n`);
    expect(planDirectTargets(root, join(root, 'logos/changes', SLUG))).toEqual(targets);
    writeFileSync(proposalPath, original);

    // ③ 真实合并后目标字节逐字节等于 delta 剥离后正文
    expect(invoke(['merge', SLUG], root).status).toBe(0);
    expect(readFileSync(join(root, ORCH_TARGET), 'utf8')).toBe(body);
  });

  it('UT-S39-71: CREATE 整文件新建并登记 resource_index；op 与 mode 不一致即拒绝', () => {
    const files = { ...lintScenario('orch-legal').files };
    delete files[ORCH_TARGET];                                    // 目标不存在 → CREATE
    files[`logos/changes/${SLUG}/deltas/scenario/core-auth.json`] =
      marker('CREATE', ORCH_TARGET) + NON_OPENAPI_BODY;
    const root = materialize(files);

    expect(planDirectTargets(root, join(root, 'logos/changes', SLUG))
      .find(t => t.targetPath === ORCH_TARGET)!.mode).toBe('CREATE');

    const merged = invoke(['merge', SLUG], root);
    expect(merged.status, merged.stderr).toBe(0);
    expect(readFileSync(join(root, ORCH_TARGET), 'utf8')).toBe(NON_OPENAPI_BODY);
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')).toContain(ORCH_TARGET);

    // op 与 mode 不一致：CREATE 配 MODIFIED 首行 → 拒绝并点名 mode 不一致
    const mismatched = validateAndStripNonMarkdownDelta(
      marker('MODIFY', ORCH_TARGET) + NON_OPENAPI_BODY, 'CREATE', ORCH_TARGET, { root });
    expect(mismatched.ok).toBe(false);
    expect(mismatched.message).toContain('mode 与 CREATE 不一致');
  });

  it('UT-S39-72: 裸 JSON 无 marker 在 change-lint 阶段即判违规（前移承诺）', () => {
    const root = materialize(lintScenario('orch-bare').files);
    const lint = lintOf(root);

    // ① 本体断言：错误出现在**准入阶段**，读 violations 与退出码两个真实输出
    const offending = lint.violations.filter(v => v.code === 'non_markdown_delta_invalid');
    expect(offending.length).toBeGreaterThan(0);
    expect(offending[0].path).toContain('deltas/scenario/core-auth.json');
    expect(lint.checkViolations['4']).toBeGreaterThan(0);
    expect(lint.pass).toBe(false);

    const json = invoke(['change-lint', '--slug', SLUG, '--format', 'json'], root);
    expect(json.status).toBe(2);
    const envelope = JSON.parse(json.stdout.trim().split('\n').pop()!);
    expect(envelope.data.pass).toBe(false);
    expect(envelope.data.violations.map((v: { code: string }) => v.code)).toContain('non_markdown_delta_invalid');

    // ② 回归对照：修复前同夹具实测为 PASS 9/9、L4 零违规——本用例即该漏检的锁
    const before = lintScenario('orch-bare').result;
    expect(before.pass).toBe(true);
    expect(before.checkViolations['4']).toBe(0);

    // ③ merge 不是该形态的首次暴露信号：lint 已先报，merge 亦非零且不写 SPEC_MERGED
    const bytesBefore = readFileSync(join(root, ORCH_TARGET), 'utf8');
    const merged = invoke(['merge', SLUG], root);
    expect(merged.status).not.toBe(0);
    expect(existsSync(join(root, 'logos/changes', SLUG, 'SPEC_MERGED'))).toBe(false);
    expect(readFileSync(join(root, ORCH_TARGET), 'utf8')).toBe(bytesBefore);
  });

  it('UT-S39-73: 路径漂移 / JSON 语法错 / 重复键三形态逐一拒绝并点名', () => {
    const root = minimalRoot();

    // ① marker 声明 target 与 canonical target 不一致 → 点名声明值
    const drift = validateAndStripNonMarkdownDelta(
      marker('MODIFY', 'logos/resources/scenario/other.json') + NON_OPENAPI_BODY,
      'MODIFY', ORCH_TARGET, { root });
    expect(drift.ok).toBe(false);
    expect(drift.message).toContain('logos/resources/scenario/other.json');
    expect(drift.message).toContain('canonical target 不一致');

    // ② JSON 语法错误 → 拒绝并给出解析器位置信息
    const broken = validateAndStripNonMarkdownDelta(
      `${marker('MODIFY', ORCH_TARGET)}{"name": "登录", steps: }\n`, 'MODIFY', ORCH_TARGET, { root });
    expect(broken.ok).toBe(false);
    expect(broken.message).toContain('编排 JSON 不合法');

    // ③ 重复键必须由 duplicate-aware 预检拦下——`JSON.parse` 接受重复 key 且 last-wins，
    //    若实现去掉预检只留 JSON.parse，本臂必然变红。
    const duplicated = `${marker('MODIFY', ORCH_TARGET)}{\n  "name": "登录",\n  "name": "注册"\n}\n`;
    expect(JSON.parse(duplicated.split('\n').slice(1).join('\n')).name).toBe('注册');  // last-wins 事实
    const dup = validateAndStripNonMarkdownDelta(duplicated, 'MODIFY', ORCH_TARGET, { root });
    expect(dup.ok).toBe(false);
    expect(dup.message).toMatch(/unique/i);

    // ④ 根不是对象 → 拒绝，与既有 non-Markdown 判据同口径
    const array = validateAndStripNonMarkdownDelta(
      `${marker('MODIFY', ORCH_TARGET)}[1, 2]\n`, 'MODIFY', ORCH_TARGET, { root });
    expect(array.ok).toBe(false);
    expect(array.message).toContain('根必须是对象');
  });

  it('UT-S39-74: 编排 JSON 不触发 OpenAPI / 受控根 Schema 校验（同 payload 正反对照）', () => {
    const root = minimalRoot();
    // 哨兵形式说明：两个校验器都是 payload 的纯函数且对本 payload **确定拒绝**（下方正对照证明）。
    // 因此「同一 payload 在 scenario/** 下通过」只可能是二者均未被调用——这比调用图 spy 更强：
    // 它锁的是行为而非实现形状，且不依赖对 node_modules 的 ESM mock。
    const body = NON_OPENAPI_BODY;

    // ① 正对照：同一 payload 走 api/** 被 OpenAPI 校验器拒绝
    const asApi = 'logos/resources/api/core-api.json';
    const apiResult = validateAndStripNonMarkdownDelta(marker('CREATE', asApi) + body, 'CREATE', asApi, { root });
    expect(apiResult.ok, '该 payload 必须被 OpenAPI 校验器拒绝，否则本哨兵无鉴别力').toBe(false);

    // ② 正对照：同一 payload 走受控根 spec/schema/*.json 被根 Schema 校验器拒绝
    const asSchema = 'spec/schema/demo.json';
    const schemaResult = validateAndStripNonMarkdownDelta(
      marker('CREATE', asSchema) + body, 'CREATE', asSchema, { root });
    expect(schemaResult.ok, '该 payload 必须被根 Schema 校验器拒绝，否则本哨兵无鉴别力').toBe(false);

    // ③ 同一 payload 走 scenario/**：通过，且不带任何一方的拒绝消息
    for (const mode of ['CREATE', 'MODIFY'] as const) {
      const orchestration = validateAndStripNonMarkdownDelta(
        marker(mode, ORCH_TARGET) + body, mode, ORCH_TARGET, { root });
      expect(orchestration.ok, orchestration.message).toBe(true);
      expect(orchestration.message).toBeUndefined();
      expect(orchestration.payload).toBe(body);
    }
  });

  it('UT-S39-75: 零回归锚——既有类别逐字不变、Markdown 类别仍走章节合成', () => {
    const root = minimalRoot();
    const openApi = [
      'openapi: 3.1.0', 'info:', '  title: Touch API', '  version: 1.0.0',
      'paths:', '  /touch:', '    get:', '      operationId: getTouch', '      security:', '        - bearerAuth: []',
      '      responses:', "        '200':", '          description: ok', "        '400':", '          description: error response',
      'components:', '  securitySchemes:', '    bearerAuth:', '      type: http', '      scheme: bearer',
      '  schemas:', '    Touch:', '      type: object', '      deprecated: false # compatibility contract',
    ].join('\n') + '\n';
    const sqlite = [
      '-- migration: create touch table', '-- rollback: DROP TABLE touch;',
      'CREATE TABLE touch (', '  id INTEGER PRIMARY KEY,', '  name TEXT NOT NULL UNIQUE,',
      '  parent_id INTEGER,', '  CONSTRAINT fk_parent FOREIGN KEY(parent_id) REFERENCES touch(id)', ');',
      'CREATE INDEX idx_touch_name ON touch(name);',
    ].join('\n') + '\n';
    const rootSchema = JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'x', type: 'object',
      properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false,
    }, null, 2) + '\n';
    const apiPath = 'logos/resources/api/touch.yaml';
    const dbPath = 'logos/resources/database/touch.sql';

    const normalize = (r: ReturnType<typeof validateAndStripNonMarkdownDelta>, body?: string): EntryCase => ({
      ok: r.ok, message: r.message ?? null, tier: r.tier ?? null,
      degradation: r.degradation ? { dialect: r.degradation.dialect, reason: r.degradation.reason } : null,
      payloadEqualsBody: r.payload === undefined ? null : (body === undefined ? true : r.payload === body),
    });

    // ① API：合法 / 漂移 / 重复键 / schema 非法四形态与上线前逐字相同
    expect(normalize(validateAndStripNonMarkdownDelta(marker('CREATE', apiPath) + openApi, 'CREATE', apiPath, { root }), openApi))
      .toEqual(entryCase('api-yaml-create-ok'));
    expect(normalize(validateAndStripNonMarkdownDelta(marker('MODIFY', apiPath) + openApi, 'MODIFY', apiPath, { root }), openApi))
      .toEqual(entryCase('api-yaml-modify-ok'));
    expect(normalize(validateAndStripNonMarkdownDelta(
      marker('CREATE', 'logos/resources/api/other.yaml') + openApi, 'CREATE', apiPath, { root })))
      .toEqual(entryCase('api-yaml-target-drift'));
    expect(normalize(validateAndStripNonMarkdownDelta(
      marker('CREATE', apiPath) + openApi.replace('openapi: 3.1.0', 'openapi: 3.1.0\nopenapi: 3.0.0'), 'CREATE', apiPath, { root })))
      .toEqual(entryCase('api-yaml-duplicate-key'));
    expect(normalize(validateAndStripNonMarkdownDelta(
      marker('CREATE', apiPath) + openApi.replace('      type: http', '      type: invalid'), 'CREATE', apiPath, { root })))
      .toEqual(entryCase('api-yaml-schema-invalid'));

    // ② database SQL：含方言分层（execution / syntax）与适配器不可用的降级留痕
    expect(normalize(validateAndStripNonMarkdownDelta(marker('CREATE', dbPath) + sqlite, 'CREATE', dbPath, { root }), sqlite))
      .toEqual(entryCase('db-sql-create-ok'));
    expect(normalize(validateAndStripNonMarkdownDelta(
      marker('CREATE', dbPath) + sqlite.replace('CREATE TABLE', 'CREATE TABL'), 'CREATE', dbPath, { root })))
      .toEqual(entryCase('db-sql-syntax-bad'));
    for (const dialect of ['postgresql', 'mysql'] as const) {
      expect(normalize(validateAndStripNonMarkdownDelta(
        marker('CREATE', dbPath) + sqlite, 'CREATE', dbPath, { root: minimalRoot(dialect) }), sqlite))
        .toEqual(entryCase(`db-sql-${dialect}`));
    }

    // ③ 受控根 spec/schema JSON
    const schemaPath = 'spec/schema/demo.json';
    expect(normalize(validateAndStripNonMarkdownDelta(
      marker('CREATE', schemaPath) + rootSchema, 'CREATE', schemaPath, { root }), rootSchema))
      .toEqual(entryCase('root-schema-create-ok'));

    // ④ 类别集合**本身**恰为三个成员（集合被意外扩充同样是回归），
    //    且 prd / test / spec / skills 四类 Markdown 目标均不走整文件通道
    expect([...NON_MARKDOWN_CATEGORIES].sort()).toEqual(['api', 'database', 'orchestration']);
    for (const [path, category] of Object.entries(BASELINE.categories)) {
      expect(classifyCanonicalTargetCategory(path), path).toBe(category);
    }
    for (const markdownTarget of [
      'logos/resources/prd/1-product-requirements/core-01-requirements.md',
      'logos/resources/test/core-S01-test-cases.md',
      'spec/change-management.md',
      'skills/change-writer/SKILL.md',
    ]) {
      expect(isNonMarkdownCategory(classifyCanonicalTargetCategory(markdownTarget)), markdownTarget).toBe(false);
    }
    expect(isNonMarkdownCategory(null)).toBe(false);
    expect(isNonMarkdownCategory('unknown')).toBe(false);
  });
});

describe('S39 场景测试——真实 CLI 下复现 toolstop 事故形态', () => {
  it('ST-S39-31: 事故形态现已可合并，既有类别与事务边界零漂移', () => {
    // ① 裸 JSON（事故现场原形态）：exit 2，点名该 delta
    const bare = materialize(lintScenario('orch-bare').files);
    const bareLint = invoke(['change-lint', '--slug', SLUG, '--format', 'json'], bare);
    expect(bareLint.status).toBe(2);
    const bareEnvelope = JSON.parse(bareLint.stdout.trim().split('\n').pop()!);
    expect(bareEnvelope.data.pass).toBe(false);
    const bareCodes = bareEnvelope.data.violations.map((v: { code: string }) => v.code);
    expect(bareCodes).toContain('non_markdown_delta_invalid');
    expect(bareEnvelope.data.violations.find((v: { code: string; path: string }) =>
      v.code === 'non_markdown_delta_invalid')!.path).toContain('deltas/scenario/core-auth.json');
    // 预期新增拒绝的输入：通过数恰少于总数（**不得**要求与上线前全绿时相等）
    const bareLive = lintOf(bare);
    expect(bareLive.passed).toBeLessThan(bareLive.total);
    expect(bareLive.checkIds).toEqual(lintScenario('orch-bare').result.checkIds);
    expect(bareLive.total).toBe(lintScenario('orch-bare').result.total);

    // ② 合法 marker：全部检查项通过、通过数等于总数、exit 0
    const legal = materialize(lintScenario('orch-legal').files);
    const legalLint = invoke(['change-lint', '--slug', SLUG], legal);
    expect(legalLint.status, legalLint.stderr).toBe(0);
    const legalLive = lintOf(legal);
    expect(legalLive.pass).toBe(true);
    expect(legalLive.passed).toBe(legalLive.total);
    expect(legalLive.checkIds).toEqual(lintScenario('orch-legal').result.checkIds);
    expect(legalLive.total).toBe(lintScenario('orch-legal').result.total);
    expect(legalLive.passed).toBe(lintScenario('orch-legal').result.passed);

    // ③ 真实 merge 进程 exit 0 且写出 SPEC_MERGED（不得以库内函数调用替代）
    const merged = invoke(['merge', SLUG], legal);
    expect(merged.status, merged.stderr).toBe(0);
    expect(existsSync(join(legal, 'logos/changes', SLUG, 'SPEC_MERGED'))).toBe(true);

    // ④ 目标字节等于 delta 剥离后正文，逐字节比对
    const deltaBody = lintScenario('orch-legal').files[`logos/changes/${SLUG}/deltas/scenario/core-auth.json`]
      .split('\n').slice(1).join('\n');
    expect(readFileSync(join(legal, ORCH_TARGET), 'utf8')).toBe(deltaBody);

    // ⑤ 行为不受影响的两组夹具：结论与上线前同夹具逐字相同
    for (const key of ['unrelated-violation', 'nodelta'] as const) {
      const scenarioRoot = materialize(lintScenario(key).files);
      const live = lintOf(scenarioRoot);
      const expected = lintScenario(key).result;
      expect(live.checkIds, key).toEqual(expected.checkIds);
      expect(live.total, key).toBe(expected.total);
      expect(live.passed, key).toBe(expected.passed);
      expect(live.pass, key).toBe(expected.pass);
      expect(live.violationCodes, key).toEqual(expected.violationCodes);
      expect(live.checkViolations, key).toEqual(expected.checkViolations);
    }

    // ⑥ 失败分支的事务边界：起始无 SPEC_MERGED → 非零退出 → 仍无该标记 → 目标保持合并前字节
    const failing = materialize(lintScenario('orch-bare').files);
    expect(existsSync(join(failing, 'logos/changes', SLUG, 'SPEC_MERGED'))).toBe(false);
    const before = readFileSync(join(failing, ORCH_TARGET), 'utf8');
    const failed = invoke(['merge', SLUG], failing);
    expect(failed.status).not.toBe(0);
    expect(existsSync(join(failing, 'logos/changes', SLUG, 'SPEC_MERGED'))).toBe(false);
    expect(readFileSync(join(failing, ORCH_TARGET), 'utf8')).toBe(before);
  });
});
