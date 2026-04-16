import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
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
function scanCandidateFiles(root: string): string[] {
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
  scanDir(join(root, 'logos/resources/verify'));

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
    pattern: /logos\/resources\/prd\/3-technical-plan\/2-scenario-implementation\/00-scenario-overview\.md$/,
    zh: () => '场景实现概览索引。涉及全量场景分类、参与方、实现文档映射关系时必读。',
    en: () => 'Scenario overview index. Required when referencing scenario classification, participants, or document mapping.',
  },
  // 2. 场景时序图：S01-cli-init.md → S01 场景时序图
  {
    pattern: /logos\/resources\/prd\/3-technical-plan\/2-scenario-implementation\/(S\d+)-(.+)\.md$/,
    zh: (m) => `${m[1]} 场景时序图。涉及 ${m[1]} 实现细节、API 设计、异常分支时必读。`,
    en: (m) => `${m[1]} sequence diagram. Required when working on ${m[1]} implementation, API design, or exception branches.`,
  },
  // 3. 测试用例：S01-test-cases.md → S01 测试用例
  {
    pattern: /logos\/resources\/test\/(S\d+)-test-cases\.md$/,
    zh: (m) => `${m[1]} 测试用例。涉及 ${m[1]} 单元测试与场景测试的实现与验收时必读。`,
    en: (m) => `${m[1]} test cases. Required when implementing or verifying ${m[1]} unit and scenario tests.`,
  },
  // 4. 技术架构
  {
    pattern: /logos\/resources\/prd\/3-technical-plan\/1-architecture\/.+\.md$/,
    zh: () => '系统架构概要。涉及技术栈选型、系统组件划分、非功能性约束时必读。',
    en: () => 'System architecture overview. Required when referencing tech stack, system components, or non-functional constraints.',
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
    zh: () => '测试验收报告。涉及验收结果、覆盖度分析、Gate 判定时必读。',
    en: () => 'Test acceptance report. Required when referencing test results, coverage analysis, or Gate decisions.',
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

function parseExistingPaths(yamlContent: string): Set<string> {
  const paths = new Set<string>();
  // 匹配 "  - path: some/path" 格式（允许前导空格）
  for (const m of yamlContent.matchAll(/^\s*-\s+path:\s*(.+)$/gm)) {
    paths.add(m[1].trim());
  }
  return paths;
}

// ---------------------------------------------------------------------------
// 将新条目追加到 resource_index 末尾
// ---------------------------------------------------------------------------

interface NewEntry {
  path: string;
  desc: string;
}

function appendToResourceIndex(yamlContent: string, entries: NewEntry[]): string {
  if (entries.length === 0) return yamlContent;

  const block = entries
    .map(e => `  - path: ${e.path}\n    desc: ${e.desc}`)
    .join('\n');

  // 尝试在 "conventions:" 行之前插入（保持文件结构）
  if (/^conventions:/m.test(yamlContent)) {
    return yamlContent.replace(/^(conventions:)/m, `${block}\n\n$1`);
  }

  // 无 conventions 块时追加到文件末尾
  const trimmed = yamlContent.trimEnd();
  return `${trimmed}\n${block}\n`;
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

export interface SyncResourceIndexResult {
  added: number;
  skipped: number;
}

/** 扫描项目文档，将尚未收录的文件补录到 logos-project.yaml 的 resource_index */
export function syncResourceIndex(root: string, locale: Locale): SyncResourceIndexResult {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) {
    return { added: 0, skipped: 0 };
  }

  const content = readFileSync(yamlPath, 'utf-8');
  const existingPaths = parseExistingPaths(content);

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
    const updated = appendToResourceIndex(content, newEntries);
    writeFileSync(yamlPath, updated);
  }

  return { added: newEntries.length, skipped };
}
