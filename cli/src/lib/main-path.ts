/**
 * layered-verification：测试用例文档「主链路用例」小节的唯一读取入口（功能规格 §2.109.3）。
 *
 * verify 的门禁（分层开启时）与 change-lint 的警告消费同一个读取结果——集合与结构错误只在这里算一次。
 * 主链路标记不写在用例表首格：首格语法（test-id.ts）不变，本模块只消费它给出的「本文档已定义的用例及其是否人工」。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_ID_ANCHORED_RE, matchTableTestIdRow } from './test-id.js';

export const MAIN_PATH_SECTION_TITLES = ['主链路用例', 'Main Path Cases'] as const;
export const DEFAULT_MAIN_PATH_MAX = 50;

export type MainPathProblemCode =
  | 'undefined_id'
  | 'manual_case'
  | 'not_ut_st'
  | 'duplicate_id'
  | 'duplicate_section'
  | 'item_without_id';

export interface MainPathProblem {
  /** 项目根相对的测试用例文档路径。 */
  file: string;
  /** 涉及的用例 ID；无法确定时为 null。 */
  id: string | null;
  code: MainPathProblemCode;
  /** 文档内 1 基行号。 */
  line: number;
}

export interface MainPathDocument {
  /** 文档中是否有主链路小节。 */
  present: boolean;
  /** 该文档合法列出的主链路用例（出现序、去重）。 */
  ids: string[];
  problems: MainPathProblem[];
}

export interface MainPathSet {
  /** 全部文档主链路用例的并集，字典序。 */
  ids: string[];
  problems: MainPathProblem[];
  /** 含主链路小节的文档（项目根相对路径）。 */
  files: string[];
}

const TEST_CASES_DIR = 'logos/resources/test';
const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM_RE = /^\s*[-*]\s+(.*)$/;
const UT_ST_RE = /^(UT|ST)-/;

/** 列表项开头的候选 ID：取第一个空白分隔的词，去掉反引号与结尾标点。 */
function leadingToken(text: string): string {
  const first = text.trim().split(/\s+/)[0] ?? '';
  return first.replace(/^`+|`+$/g, '').replace(/[,，。:：;；、]+$/u, '');
}

/** 解析单个测试用例文档的主链路小节。`file` 只用于问题定位。 */
export function parseMainPathDocument(content: string, file: string): MainPathDocument {
  const lines = content.split(/\r?\n/);
  // 本文档用例表中已定义的用例：裸 ID → 是否带 [manual]
  const defined = new Map<string, boolean>();
  let inFence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const row = matchTableTestIdRow(line);
    if (row && !defined.has(row.id)) defined.set(row.id, row.manual);
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  const problems: MainPathProblem[] = [];
  let sectionLevel = 0; // >0 表示正在某个主链路小节内
  let sections = 0;
  let countingSection = false; // 只有第一个小节的列表项计入集合
  inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (sectionLevel > 0 && level <= sectionLevel) sectionLevel = 0;
      if ((level === 2 || level === 3) && (MAIN_PATH_SECTION_TITLES as readonly string[]).includes(heading[2].trim())) {
        sections += 1;
        sectionLevel = level;
        countingSection = sections === 1;
        if (sections > 1) problems.push({ file, id: null, code: 'duplicate_section', line: i + 1 });
      }
      continue;
    }
    if (sectionLevel === 0 || !countingSection) continue;
    const item = LIST_ITEM_RE.exec(line);
    if (!item) continue;
    const token = leadingToken(item[1]);
    if (!TEST_ID_ANCHORED_RE.test(token)) {
      problems.push({ file, id: null, code: 'item_without_id', line: i + 1 });
      continue;
    }
    if (!UT_ST_RE.test(token)) { problems.push({ file, id: token, code: 'not_ut_st', line: i + 1 }); continue; }
    if (!defined.has(token)) { problems.push({ file, id: token, code: 'undefined_id', line: i + 1 }); continue; }
    if (defined.get(token)) { problems.push({ file, id: token, code: 'manual_case', line: i + 1 }); continue; }
    if (seen.has(token)) { problems.push({ file, id: token, code: 'duplicate_id', line: i + 1 }); continue; }
    seen.add(token);
    ids.push(token);
  }
  return { present: sections > 0, ids, problems };
}

/** 列出全部测试用例文档（项目根相对路径，字典序）。 */
export function listTestCaseDocuments(root: string): string[] {
  const dir = join(root, TEST_CASES_DIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { recursive: true })
      .map(f => String(f).split('\\').join('/'))
      .filter(f => f.endsWith('-test-cases.md'))
      .map(f => `${TEST_CASES_DIR}/${f}`)
      .sort();
  } catch {
    return [];
  }
}

/**
 * 读取主链路集合 MP = 全部测试用例文档主链路小节所列用例的并集。
 * `overrides`：项目根相对路径 → 文档内容，用于有效视图（已合并文档叠加本提案测试 delta 的合成后态）；
 * 其中磁盘上尚不存在的路径（本提案新建的测试文档）同样计入。
 */
export function readMainPathSet(root: string, overrides: ReadonlyMap<string, string> = new Map()): MainPathSet {
  const files = new Set<string>(listTestCaseDocuments(root));
  for (const path of overrides.keys()) if (path.endsWith('-test-cases.md')) files.add(path);
  const ids = new Set<string>();
  const problems: MainPathProblem[] = [];
  const withSection: string[] = [];
  for (const file of Array.from(files).sort()) {
    let content: string;
    if (overrides.has(file)) content = overrides.get(file)!;
    else {
      try { content = readFileSync(join(root, file), 'utf-8'); } catch { continue; }
    }
    const doc = parseMainPathDocument(content, file);
    if (doc.present) withSection.push(file);
    for (const id of doc.ids) ids.add(id);
    problems.push(...doc.problems);
  }
  return { ids: Array.from(ids).sort(), problems, files: withSection };
}

/** 读取生效的主链路上限（`verify.layered.main_path_max`；非正整数或缺省时为 50）与分层是否开启。 */
export function readMainPathLimit(root: string): { limit: number; layeredEnabled: boolean } {
  try {
    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8')) as { verify?: { layered?: unknown } };
    const layered = config.verify?.layered;
    if (layered && typeof layered === 'object' && !Array.isArray(layered)) {
      const record = layered as Record<string, unknown>;
      const max = record.main_path_max;
      return {
        limit: typeof max === 'number' && Number.isInteger(max) && max > 0 ? max : DEFAULT_MAIN_PATH_MAX,
        layeredEnabled: record.enabled === true,
      };
    }
  } catch { /* 缺省 */ }
  return { limit: DEFAULT_MAIN_PATH_MAX, layeredEnabled: false };
}
