/**
 * 环境事实守卫（架构 §四十九、`logos/resources/test/core-S19-test-cases.md`「S19 环境事实不入 verify 期断言的守卫元测试」）。
 *
 * **判据按「位置语义」分类，不按「是否等于当前版本」匹配。** 这条区分是本模块存在的全部理由：
 * 升版是 deploy 期动作、恒晚于 verify，故障快照里钉着的必然是**上一个**版本；以「等于当前包版本」
 * 为判据的守卫，恰好在唯一该拦的输入上命中为零（0.15.3 实证：当前值 0.15.3、故障快照 0.15.2）。
 *
 * 三类位置、三种处置：
 *  - **包版本承载位**：envelope 顶层 `"version"`、`--version` 输出行、tarball/安装包版本
 *    → 出现任意 `x.y.z` 即违规，合法形态只有规范化占位符；
 *  - **契约版本位**：`data.contract.version`、随包 schema 内嵌契约版本
 *    → 必须是固定字面量；被规范化成占位符**反向违规**；
 *  - **叙述文本**：注释、用例标题、文档字符串 → 不是断言期望值，不参与判定。
 *
 * 本模块是纯函数集合（输入为「路径 + 文本」对，不自行读盘），因此 UT-S19-48 可以用合成夹具
 * 直接驱动它，而不必在仓库里真的制造一份坏快照。
 */

export type EnvFactViolationCode =
  /** 包版本承载位出现了具体版本字面量（该位置只允许规范化占位符） */
  | 'package_version_pinned'
  /** 契约版本位被规范化成了占位符（该位置必须逐字节守死） */
  | 'contract_version_normalized';

export interface EnvFactViolation {
  code: EnvFactViolationCode;
  path: string;
  line: number;
  /** 命中的原始片段（截断），供诊断逐条点名 */
  excerpt: string;
  fixHint: string;
}

export interface GuardSource {
  path: string;
  text: string;
}

const SEMVER = String.raw`\d+\.\d+\.\d+`;
const PLACEHOLDER = /<[A-Z_]+>/;

/** envelope 头部序列：`"command":"<cmd>","version":"<值>"`——顶层包版本承载位的结构识别。 */
const ENVELOPE_VERSION = new RegExp(String.raw`"command":"[a-z-]+","version":"([^"]*)"`, 'g');
/** 文本快照 / 文本输出里的 `--version` 行形态：整行只有一个可执行名与版本。 */
const VERSION_LINE = new RegExp(String.raw`^\s*(?:openlogos|@miniidealab/openlogos)\s+v?(${SEMVER})\s*$`);
/** tarball / 安装包版本承载位：包名-版本.tgz。 */
const TARBALL_VERSION = new RegExp(String.raw`openlogos-(${SEMVER})\.tgz`, 'g');
/** 契约版本位：`"contract":{"version":"…"}`（JSON 快照）。 */
const CONTRACT_VERSION_SLOT = new RegExp(String.raw`"contract":\{"version":"([^"]*)"`, 'g');

/**
 * 测试源中「断言主语明确denote CLI 包版本」的期望值。
 *
 * 收窄到可高置信判定的主语——envelope/输出对象的 `.version`、以及以包版本命名的标识符；
 * 契约类主语（`contract.version`、`planContractVersion`、`minimum_app_version` 等）**不在此列**，
 * 它们是被测性质或外部契约常量，钉死是要求而非缺陷。
 */
const PACKAGE_VERSION_ASSERTION = new RegExp(
  String.raw`expect\(\s*([A-Za-z_$][\w$.\[\]'"]*(?:version|Version))\b[^)]*\)\s*(?:,[^)]*\))?\s*\.\s*(?:toBe|toEqual|toContain|toMatch)\(\s*['"\`](${SEMVER})['"\`]`,
  'g',
);
/** 主语含契约语义即豁免（大小写不敏感）。 */
const CONTRACT_SUBJECT = /contract|schema|minimum_app|plan_contract|planContract/i;
/** 明确指向 CLI 包版本的主语。 */
const PACKAGE_SUBJECT = /^(?:.*\b)?(?:env|envelope|payload|out|output|json|result|parsed)?\.?(?:cli)?version$|cliVersion|pkgVersion|packageVersion|globalVersion/i;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function push(list: EnvFactViolation[], v: EnvFactViolation): void {
  list.push(v);
}

/** 扫描快照资产（`*.snap`）：结构识别包版本承载位与契约版本位。 */
export function scanSnapshot(source: GuardSource): EnvFactViolation[] {
  const out: EnvFactViolation[] = [];
  const { path, text } = source;

  for (const m of text.matchAll(ENVELOPE_VERSION)) {
    const value = m[1];
    if (PLACEHOLDER.test(value)) continue;                       // 合法：已规范化
    if (!new RegExp(`^${SEMVER}$`).test(value)) continue;        // 非版本形态，不判定
    push(out, {
      code: 'package_version_pinned', path, line: lineOf(text, m.index ?? 0),
      excerpt: m[0].slice(0, 120),
      fixHint: 'envelope 顶层 version 是包版本承载位：改为规范化占位符（如 <PKG_VERSION>）后再比 golden（架构 §49.2）。',
    });
  }

  for (const m of text.matchAll(TARBALL_VERSION)) {
    push(out, {
      code: 'package_version_pinned', path, line: lineOf(text, m.index ?? 0),
      excerpt: m[0].slice(0, 120),
      fixHint: 'tarball 版本是包版本承载位：改为运行时读取 + 关系断言，或规范化后比对。',
    });
  }

  text.split('\n').forEach((line, i) => {
    const m = VERSION_LINE.exec(line);
    if (m) {
      push(out, {
        code: 'package_version_pinned', path, line: i + 1, excerpt: line.trim().slice(0, 120),
        fixHint: '`--version` 输出是包版本承载位：规范化该行后再比 golden。',
      });
    }
  });

  for (const m of text.matchAll(CONTRACT_VERSION_SLOT)) {
    if (!PLACEHOLDER.test(m[1])) continue;                       // 合法：固定字面量
    push(out, {
      code: 'contract_version_normalized', path, line: lineOf(text, m.index ?? 0),
      excerpt: m[0].slice(0, 120),
      fixHint: '契约版本位必须逐字节守死：撤销对 data.contract.version 的规范化（架构 §49.2 边界）。',
    });
  }

  return out;
}

/** 扫描测试源（`*.test.ts`）：只看断言期望值，不看注释、用例标题与文档字符串。 */
export function scanTestSource(source: GuardSource): EnvFactViolation[] {
  const out: EnvFactViolation[] = [];
  const { path, text } = source;
  for (const m of text.matchAll(PACKAGE_VERSION_ASSERTION)) {
    const subject = m[1];
    if (CONTRACT_SUBJECT.test(subject)) continue;                // 契约/外部常量：钉死是要求
    if (!PACKAGE_SUBJECT.test(subject)) continue;                // 主语不 denote 包版本：不判定
    push(out, {
      code: 'package_version_pinned', path, line: lineOf(text, m.index ?? 0),
      excerpt: m[0].slice(0, 140),
      fixHint: '包版本断言必须运行时读取后作关系断言（如 tarball 版本 == package.json 版本），不得钉死字面量。',
    });
  }
  return out;
}

/** 对一组资产运行守卫；排序稳定（path → line → code）。 */
export function runEnvFactGuard(
  snapshots: GuardSource[],
  testSources: GuardSource[],
): EnvFactViolation[] {
  const all = [...snapshots.flatMap(scanSnapshot), ...testSources.flatMap(scanTestSource)];
  return all.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.code.localeCompare(b.code));
}

export function formatViolations(violations: EnvFactViolation[]): string {
  return violations
    .map(v => `  - [${v.code}] ${v.path}:${v.line}\n      命中：${v.excerpt}\n      修法：${v.fixHint}`)
    .join('\n');
}
