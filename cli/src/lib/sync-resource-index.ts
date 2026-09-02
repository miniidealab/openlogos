import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Document, YAMLSeq, isMap, isSeq, parse as parseYaml, parseDocument } from 'yaml';
import type { Locale } from '../i18n.js';

// ---------------------------------------------------------------------------
// 文件扫描
// ---------------------------------------------------------------------------

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { recursive: true })
      .map(f => String(f))
      .filter(f => {
        const full = join(dir, f);
        return statSync(full).isFile() && !f.endsWith('.gitkeep');
      });
  } catch {
    return [];
  }
}

/** 扫描项目中所有应纳入 resource_index 的文件，返回相对于项目根目录的路径列表 */
export function scanCandidateFiles(root: string): string[] {
  const results: string[] = [];

  const scanDir = (absDir: string) => {
    for (const rel of listFilesRecursive(absDir)) {
      results.push(relative(root, join(absDir, rel)).replace(/\\/g, '/'));
    }
  };

  // logos/resources/ 各子目录
  scanDir(join(root, 'logos/resources/prd'));
  scanDir(join(root, 'logos/resources/api'));
  scanDir(join(root, 'logos/resources/database'));
  scanDir(join(root, 'logos/resources/test'));
  scanDir(join(root, 'logos/resources/scenario'));
  scanDir(join(root, 'logos/resources/decisions'));
  scanDir(join(root, 'logos/resources/verify'));
  scanDir(join(root, 'logos/resources/implementation'));

  // spec/
  scanDir(join(root, 'spec'));

  // skills/*/SKILL.md（只要一级子目录下的 SKILL.md）
  const skillsDir = join(root, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      const skillMd = join(skillsDir, entry, 'SKILL.md');
      if (existsSync(skillMd) && statSync(skillMd).isFile()) {
        results.push(`skills/${entry}/SKILL.md`);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// desc 自动推断规则
// ---------------------------------------------------------------------------

interface DescRule {
  pattern: RegExp;
  zh: (m: RegExpMatchArray) => string;
  en: (m: RegExpMatchArray) => string;
}

const RULES: DescRule[] = [
  // 1. 场景总览（放在场景文件之前，更具体）
  {
    pattern: /logos\/resources\/prd\/3-technical-plan\/2-scenario-implementation\/(?:[a-z][a-z0-9-]*-)?00-scenario-overview\.md$/,
    zh: () => '场景实现概览索引。涉及全量场景分类、参与方、实现文档映射关系时必读。',
    en: () => 'Scenario overview index. Required when referencing scenario classification, participants, or document mapping.',
  },
  // 2. 场景时序图：core-S01-cli-init.md → S01 场景时序图
  {
    pattern: /logos\/resources\/prd\/3-technical-plan\/2-scenario-implementation\/(?:[a-z][a-z0-9-]*-)?(S\d+)-(.+)\.md$/,
    zh: (m) => `${m[1]} 场景时序图。涉及 ${m[1]} 实现细节、API 设计、异常分支时必读。`,
    en: (m) => `${m[1]} sequence diagram. Required when working on ${m[1]} implementation, API design, or exception branches.`,
  },
  // 3. 测试用例：core-S01-test-cases.md → S01 测试用例
  {
    pattern: /logos\/resources\/test\/(?:[a-z][a-z0-9-]*-)?(S\d+)-test-cases\.md$/,
    zh: (m) => `${m[1]} 测试用例。涉及 ${m[1]} 单元测试与场景测试的实现与验收时必读。`,
    en: (m) => `${m[1]} test cases. Required when implementing or verifying ${m[1]} unit and scenario tests.`,
  },
  // 3b. 部署后冒烟测试用例
  {
    pattern: /logos\/resources\/test\/smoke\/(?:[a-z][a-z0-9-]*-)?([a-z][a-z0-9-]*)-smoke-test-cases\.md$/,
    zh: (m) => `${m[1]} 模块部署后冒烟测试用例。涉及 openlogos smoke 或 launch 前门禁时必读。`,
    en: (m) => `${m[1]} deployment smoke test cases. Required when running openlogos smoke or checking launch gates.`,
  },
  // 3c. 决策记录（S38 decision-record-capability）：core-D01-<slug>.md → D01 决策记录
  {
    pattern: /logos\/resources\/decisions\/(?:[a-z][a-z0-9-]*-)?(D\d+)-(.+)\.md$/,
    zh: (m) => `${m[1]} 决策记录（ADR 变体）。涉及该设计决策的背景 / 理由 / 备选方案 / 影响面 / 来源、或复盘为什么这样设计时必读。`,
    en: (m) => `${m[1]} decision record (ADR variant). Required when reviewing the design decision's context, rationale, alternatives, impact, or provenance.`,
  },
  // 4. 技术架构
  {
    pattern: /logos\/resources\/prd\/3-technical-plan\/1-architecture\/.+\.md$/,
    zh: () => '系统架构概要。涉及技术栈选型、系统组件划分、非功能性约束时必读。',
    en: () => 'System architecture overview. Required when referencing tech stack, system components, or non-functional constraints.',
  },
  // 4b. 部署方案
  {
    pattern: /logos\/resources\/prd\/3-technical-plan\/3-deployment\/.+\.md$/,
    zh: () => '部署方案。涉及部署拓扑、环境配置、发布命令、回滚策略和 smoke 验证时必读。',
    en: () => 'Deployment plan. Required when referencing deployment topology, environment config, release commands, rollback strategy, or smoke checks.',
  },
  // 5. 功能规格
  {
    pattern: /logos\/resources\/prd\/2-product-design\/1-feature-specs\/.+\.md$/,
    zh: () => '产品功能规格。涉及交互设计、功能边界、Skill 行为定义时必读。',
    en: () => 'Product feature spec. Required when referencing interaction design, feature scope, or Skill behavior.',
  },
  // 6. 页面/对话设计
  {
    pattern: /logos\/resources\/prd\/2-product-design\/2-page-design\/.+\.md$/,
    zh: () => '产品交互原型。涉及 CLI 终端输出样式或 AI Skill 对话脚本时必读。',
    en: () => 'Product interaction prototype. Required when referencing CLI output styles or AI Skill dialogue scripts.',
  },
  // 7. 需求文档
  {
    pattern: /logos\/resources\/prd\/1-product-requirements\/.+\.md$/,
    zh: () => '产品需求文档。涉及产品定位、核心场景、验收条件时必读。',
    en: () => 'Product requirements document. Required when referencing product positioning, scenarios, or acceptance criteria.',
  },
  // 8. API 规格（YAML）
  {
    pattern: /logos\/resources\/api\/.+\.ya?ml$/,
    zh: () => 'OpenAPI 接口规格。涉及 API 端点设计、请求/响应结构、状态码时必读。',
    en: () => 'OpenAPI specification. Required when designing API endpoints, request/response schemas, or status codes.',
  },
  // 9. 数据库 DDL
  {
    pattern: /logos\/resources\/database\/.+\.sql$/,
    zh: () => '数据库 Schema（DDL）。涉及表结构、字段定义、索引策略时必读。',
    en: () => 'Database schema (DDL). Required when referencing table structure, field definitions, or index strategies.',
  },
  // 10. 编排测试（JSON）
  {
    pattern: /logos\/resources\/scenario\/.+\.json$/,
    zh: () => 'API 编排测试用例。涉及端到端 API 测试流程、测试数据准备时必读。',
    en: () => 'API orchestration test case. Required when working on end-to-end API testing or test data setup.',
  },
  // 11. 验收报告
  {
    pattern: /logos\/resources\/verify\/.+\.md$/,
    zh: () => '验收报告。涉及 verify、部署或 smoke 结果、覆盖度分析、Gate 判定时必读。',
    en: () => 'Verification report. Required when referencing verify, deployment, or smoke results, coverage analysis, or Gate decisions.',
  },
  // 11b. 实现清单
  {
    pattern: /logos\/resources\/implementation\/.+\.md$/,
    zh: () => '实现清单。涉及已实现范围、代码路径、测试覆盖和交付摘要时必读。',
    en: () => 'Implementation manifest. Required when referencing implemented scope, code paths, test coverage, or delivery summary.',
  },
  // 12. Skills（只匹配 SKILL.md）
  {
    pattern: /skills\/([^/]+)\/SKILL\.md$/,
    zh: (m) => `${m[1]} Skill。使用 ${m[1]} 功能时必读。`,
    en: (m) => `${m[1]} Skill. Required when using the ${m[1]} capability.`,
  },
  // 13. spec 规范文档（md / json）
  {
    pattern: /spec\/.+\.(md|json)$/,
    zh: () => '方法论规范文档。涉及对应规范定义、格式约定时必读。',
    en: () => 'Methodology spec document. Required when referencing the corresponding spec or format convention.',
  },
];

/** 根据文件路径推断 desc；无匹配规则返回 null */
export function inferResourceDesc(relPath: string, locale: Locale): string | null {
  for (const rule of RULES) {
    const m = relPath.match(rule.pattern);
    if (m) {
      return locale === 'zh' ? rule.zh(m) : rule.en(m);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 解析现有 resource_index 中已有的 path 集合
// ---------------------------------------------------------------------------

/**
 * 从 YAML 文档树读出已收录 path 集合（不用正则猜形态）。
 * 结构不符（非序列、条目非映射、path 非串）的项直接忽略，不参与幂等判定。
 */
function parseExistingPaths(doc: Document): Set<string> {
  const paths = new Set<string>();
  const node = doc.get('resource_index', true);
  if (!isSeq(node)) return paths;
  for (const item of node.items) {
    const path = isMap(item) ? item.get('path', false) : undefined;
    if (typeof path === 'string' && path.trim()) paths.add(path.trim());
  }
  return paths;
}

// ---------------------------------------------------------------------------
// 将新条目追加到 resource_index
// ---------------------------------------------------------------------------

interface NewEntry {
  path: string;
  desc: string;
}

/**
 * 结构化追加：`parseDocument` → 操作 `resource_index` 节点 → `toString()`。
 *
 * 三种既有形态归一到同一承载条目的 block sequence（架构 §三十八.1）：
 *   - `resource_index: []`（空 flow sequence，`openlogos init` 模板产出）→ 转 block sequence；
 *   - `resource_index:`（空 block，值为 null）→ 新建序列挂在该键下；
 *   - 键缺失 → 创建该键（若存在 `conventions` 则插在其前，保持既有文档形状）。
 *
 * 禁止再出现按 `conventions:` 之类行锚做文本拼接的分支：那会在 `[]` 形态上产出
 * 「空 flow sequence 后跟 block sequence」的非法 YAML，且写入时不自我暴露。
 */
function appendToResourceIndex(doc: Document, entries: NewEntry[]): void {
  if (entries.length === 0) return;

  let seq = doc.get('resource_index', true);
  if (!isSeq(seq)) {
    seq = new YAMLSeq();
    const contents = doc.contents;
    const idx = isMap(contents)
      ? contents.items.findIndex(pair => String(pair.key) === 'resource_index')
      : -1;
    if (idx >= 0 && isMap(contents)) {
      // 键已存在但值不是序列（空 block / 显式 null）：就地换值，保留键位置与其上注释
      contents.items[idx].value = seq;
    } else if (isMap(contents)) {
      const before = contents.items.findIndex(pair => String(pair.key) === 'conventions');
      const pair = doc.createPair('resource_index', seq);
      if (before >= 0) contents.items.splice(before, 0, pair);
      else contents.items.push(pair);
    } else {
      doc.set('resource_index', seq);
    }
  }
  // `[]` 是 flow sequence，其后不能跟 block 条目——统一落成 block 形态
  (seq as YAMLSeq).flow = false;

  for (const entry of entries) {
    (seq as YAMLSeq).add(doc.createNode({ path: entry.path, desc: entry.desc }));
  }
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

export interface SyncResourceIndexResult {
  added: number;
  skipped: number;
  /** true 表示 logos-project.yaml 当前不可解析，本次跳过补录且未写盘（EX-S08-IDX-1） */
  degraded?: boolean;
}

/** 扫描项目文档，将尚未收录的文件补录到 logos-project.yaml 的 resource_index */
export function syncResourceIndex(root: string, locale: Locale): SyncResourceIndexResult {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) {
    return { added: 0, skipped: 0 };
  }

  const content = readFileSync(yamlPath, 'utf-8');
  // EX-S08-IDX-1：目标已不可解析时不进入补录，交由降级告警路径处理，绝不代用户改写
  const doc = parseDocument(content);
  if (doc.errors.length > 0) {
    return { added: 0, skipped: 0, degraded: true };
  }
  const existingPaths = parseExistingPaths(doc);

  const candidates = scanCandidateFiles(root);

  const newEntries: NewEntry[] = [];
  let skipped = 0;

  for (const relPath of candidates) {
    if (existingPaths.has(relPath)) continue; // 已收录，跳过

    const desc = inferResourceDesc(relPath, locale);
    if (!desc) {
      skipped++;
      continue; // 无匹配规则，跳过
    }

    newEntries.push({ path: relPath, desc });
  }

  if (newEntries.length > 0) {
    appendToResourceIndex(doc, newEntries);
    const updated = doc.toString({ lineWidth: 0 });
    // 后置判据＝可解析性（架构 §三十八.1）：自检不过一律不写盘，目标字节保持原样
    try {
      parseYaml(updated);
    } catch (error) {
      throw new Error(
        `resource_index 补录后自检失败，已放弃写入 ${relative(root, yamlPath)}：${(error as Error).message}`,
      );
    }
    writeFileSync(yamlPath, updated);
  }

  return { added: newEntries.length, skipped };
}
