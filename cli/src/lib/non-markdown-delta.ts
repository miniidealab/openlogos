/**
 * non-Markdown（OpenAPI / SQL）整文件 delta 的 marker 协议与内容校验。
 *
 * 这类 canonical target 不是 Markdown 章节文档：delta 首行是控制标记、正文即最终字节。
 * 本模块负责标记校验、剥离与内容合法性（OpenAPI 3.0/3.1 schema、SQL 方言分层校验与适配器路由）。
 *
 * 承自已删除的 `baseline-closure.ts`：与闭包规划无关，逐行保留；其在 change-lint 中的挂载点
 * 由 L9 迁至 L4（delta 段标记与脱模板）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  validate as compileOpenApi30,
  type Output as OpenApiValidationOutput,
  type OutputUnit as OpenApiValidationOutputUnit,
} from '@hyperjump/json-schema/openapi-3-0';
import { validate as compileOpenApi31 } from '@hyperjump/json-schema/openapi-3-1';
import { parseDocument } from 'yaml';
import { classifyCanonicalTargetCategory } from './canonical-target.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export type SqlValidationTier = 'structure' | 'syntax' | 'execution';

/** 方言层被跳过时的可归因留痕（架构 §四十二.1：能力缺失只能降级，不能阻断）。 */
export interface SqlValidationDegradation {
  /** 降级原因：适配器未实现（产品能力）还是未安装（环境能力）。 */
  reason: 'adapter-not-implemented' | 'adapter-not-installed';
  dialect: DatabaseDialect;
  /** 具体缺什么——方言名或二进制名，用于诊断点名。 */
  missing: string[];
  /** 实际执行到的层级。降级时恒为 'structure'。 */
  tier: SqlValidationTier;
  detail: string;
}

export interface NonMarkdownDeltaResult {
  ok: boolean;
  payload?: string;
  message?: string;
  /** SQL delta 专有：实际执行层级；非 SQL 目标为 undefined。 */
  tier?: SqlValidationTier;
  /** SQL delta 专有：方言层被跳过时的留痕；未降级时为 undefined。 */
  degradation?: SqlValidationDegradation;
}

const NON_MD_MARKER = /^## (ADDED|MODIFIED) — (.+?)(（新文件，整文件）|（整文件替换）)$/;

function duplicateAwareObject(payload: string, extension: string): { value?: Record<string, unknown>; error?: string } {
  if (extension === '.json') {
    // JSON.parse 接受重复 key；先用 YAML 1.2 duplicate-aware parser 检查，再执行 JSON 严格语法。
    const ydoc = parseDocument(payload, { uniqueKeys: true, strict: true, prettyErrors: false });
    if (ydoc.errors.length > 0) return { error: ydoc.errors.map(e => e.message).join('；') };
    try {
      const value = JSON.parse(payload) as unknown;
      return asRecord(value) ? { value: value as Record<string, unknown> } : { error: '根必须是对象' };
    } catch (e) { return { error: String(e) }; }
  }
  const doc = parseDocument(payload, { uniqueKeys: true, strict: true, prettyErrors: false });
  if (doc.errors.length > 0) return { error: doc.errors.map(e => e.message).join('；') };
  try {
    const value = doc.toJS({ maxAliasCount: 100 });
    return asRecord(value) ? { value: value as Record<string, unknown> } : { error: '根必须是对象' };
  } catch (e) { return { error: String(e) }; }
}

function collectRefs(value: unknown, refs: string[]): void {
  if (Array.isArray(value)) { value.forEach(v => collectRefs(v, refs)); return; }
  const obj = asRecord(value);
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) {
    if (k === '$ref' && typeof v === 'string') refs.push(v);
    collectRefs(v, refs);
  }
}

function pointerExists(root: Record<string, unknown>, pointer: string): boolean {
  // 当前受控 validator 没有外部 bundler；无法解析的外部引用必须 fail-closed，不能假定成功。
  if (!pointer.startsWith('#/')) return false;
  let cur: unknown = root;
  for (const raw of pointer.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    const obj = asRecord(cur);
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) return false;
    cur = obj[key];
  }
  return true;
}

type ControlledOpenApiValidator = (value: unknown, outputFormat: 'DETAILED') => OpenApiValidationOutput;
const OFFICIAL_OPENAPI_VALIDATORS: Partial<Record<'3.0' | '3.1', ControlledOpenApiValidator>> = {};
let officialOpenApiCompilerError: string | null = null;

/*
 * Hyperjump 的公开 API 先异步编译、再返回同步 validator。模块加载时一次性预编译 OAI 官方
 * 3.0 schema 与 3.1 schema-base（后者同时校验 Schema Object）；之后 evaluator/merge-apply
 * 继续共享同步判据。编译器不可用时只记录失败并在 API 目标上 fail-closed。
 */
try {
  const [openApi30, openApi31] = await Promise.all([
    compileOpenApi30('https://spec.openapis.org/oas/3.0/schema'),
    compileOpenApi31('https://spec.openapis.org/oas/3.1/schema-base'),
  ]);
  OFFICIAL_OPENAPI_VALIDATORS['3.0'] = openApi30 as ControlledOpenApiValidator;
  OFFICIAL_OPENAPI_VALIDATORS['3.1'] = openApi31 as ControlledOpenApiValidator;
} catch (e) {
  officialOpenApiCompilerError = String(e);
}

function officialOpenApiValidator(version: '3.0' | '3.1'): { validate?: ControlledOpenApiValidator; error?: string } {
  const validate = OFFICIAL_OPENAPI_VALIDATORS[version];
  return validate
    ? { validate }
    : { error: officialOpenApiCompilerError ?? `OpenAPI ${version} 官方 schema 未完成编译` };
}

function formatSchemaErrors(output: OpenApiValidationOutput): string {
  if (output.valid) return '';
  const leaves: string[] = [];
  const visit = (items: OpenApiValidationOutputUnit[]): void => {
    for (const item of items) {
      if (leaves.length >= 5) return;
      if (item.errors && item.errors.length > 0) visit(item.errors);
      else {
        const keyword = item.keyword.split('/').pop() ?? item.keyword;
        leaves.push(`${item.instanceLocation || '#'} ${keyword}`);
      }
    }
  };
  visit(output.errors ?? []);
  return leaves.join('；') || '未提供详细错误';
}

function validateOpenApi(payload: string, extension: string): string | null {
  const parsed = duplicateAwareObject(payload, extension);
  if (!parsed.value) return `OpenAPI 解析失败：${parsed.error}`;
  const root = parsed.value;
  const version = typeof root.openapi === 'string' && /^3\.0\.[0-9]+$/.test(root.openapi)
    ? '3.0'
    : typeof root.openapi === 'string' && /^3\.1\.[0-9]+$/.test(root.openapi) ? '3.1' : null;
  if (!version) return 'openapi 必须是受支持的 3.0.x 或 3.1.x';
  const official = officialOpenApiValidator(version);
  if (!official.validate) return `OpenAPI ${version} 官方 schema validator 不可用：${official.error ?? '未知错误'}`;
  const schemaResult = official.validate(root, 'DETAILED');
  if (!schemaResult.valid) {
    return `OpenAPI ${version} 官方 schema 校验失败：${formatSchemaErrors(schemaResult)}`;
  }

  const paths = asRecord(root.paths)!;
  const components = asRecord(root.components);
  if (!components || !asRecord(components.schemas) || Object.keys(asRecord(components.schemas)!).length === 0) {
    return 'components.schemas 必须非空';
  }
  const operationIds = new Set<string>();
  for (const pathItem of Object.values(paths)) {
    const item = asRecord(pathItem);
    if (!item) continue;
    for (const [method, rawOp] of Object.entries(item)) {
      if (!/^(get|put|post|delete|patch|options|head|trace)$/.test(method)) continue;
      const op = asRecord(rawOp);
      if (!op || typeof op.operationId !== 'string' || op.operationId.trim() === '') return `operation ${method} 缺 operationId`;
      if (operationIds.has(op.operationId)) return `operationId 重复：${op.operationId}`;
      operationIds.add(op.operationId);
    }
  }
  if (operationIds.size === 0) return 'paths 中没有 operation';
  const refs: string[] = [];
  collectRefs(root, refs);
  const broken = refs.find(r => !pointerExists(root, r));
  if (broken) return `本地 $ref 无法解析：${broken}`;
  const lower = payload.toLowerCase();
  if (!/(security|bearer|oauth|api[-_ ]?key)/i.test(lower)) return '缺鉴权/security 定义';
  if (!/(deprecated|compatib|兼容|弃用)/i.test(lower)) return '缺兼容或弃用语义';
  if (!/(4\d\d|5\d\d|error|错误)/i.test(lower)) return '缺错误响应语义';
  return null;
}

function validateOpenLogosRootJsonSchema(payload: string): string | null {
  const parsed = duplicateAwareObject(payload, '.json');
  if (!parsed.value) return `JSON Schema 严格解析失败：${parsed.error}`;
  const root = parsed.value;
  if (typeof root.$schema !== 'string' || root.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    return '根 JSON Schema 必须声明 draft 2020-12 `$schema`';
  }
  if (typeof root.$id !== 'string' || root.$id.trim() === '') return '根 JSON Schema 必须声明非空 `$id`';
  if (root.type !== 'object') return '根 JSON Schema 顶层 type 必须为 object';
  if (!asRecord(root.properties) || Object.keys(asRecord(root.properties)!).length === 0) return '根 JSON Schema 必须声明非空 properties';
  return null;
}

export type DatabaseDialect = 'sqlite' | 'postgresql' | 'mysql';

function normalizeDatabaseDialect(value: string): DatabaseDialect | null {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['sqlite', 'sqlite3'].includes(normalized)) return 'sqlite';
  if (['postgres', 'postgresql', 'pgsql'].includes(normalized)) return 'postgresql';
  if (['mysql', 'mariadb'].includes(normalized)) return 'mysql';
  return null;
}

/** 从合并后的项目 tech_stack 解析 SQL 方言；缺失、冲突或未知时一律 fail-closed。 */
export function resolveProjectDatabaseDialect(root: string): { dialect?: DatabaseDialect; error?: string } {
  const indexPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(indexPath)) return { error: '缺少 logos/logos-project.yaml，无法确定 SQL 方言' };
  const doc = parseDocument(readFileSync(indexPath, 'utf-8'), { uniqueKeys: true, strict: true, prettyErrors: false });
  if (doc.errors.length > 0) return { error: `logos-project.yaml 严格解析失败：${doc.errors.map(e => e.message).join('；')}` };
  let rootValue: unknown;
  try { rootValue = doc.toJS({ maxAliasCount: 100 }); } catch (e) { return { error: `logos-project.yaml 转换失败：${String(e)}` }; }
  const techStack = asRecord(asRecord(rootValue)?.tech_stack);
  const database = techStack?.database;
  const candidates: string[] = [];
  if (typeof database === 'string') candidates.push(database);
  else {
    const db = asRecord(database);
    if (db) {
      for (const key of ['dialect', 'engine', 'type', 'name']) {
        if (typeof db[key] === 'string') candidates.push(db[key] as string);
      }
    }
  }
  if (candidates.length === 0) return { error: 'tech_stack.database 未声明 SQL 方言' };
  const normalized = [...new Set(candidates.map(normalizeDatabaseDialect))];
  if (normalized.includes(null)) return { error: `tech_stack.database 含不支持的方言：${candidates.join('、')}` };
  if (normalized.length !== 1) return { error: `tech_stack.database 方言冲突：${candidates.join('、')}` };
  return { dialect: normalized[0]! };
}

interface SqlValidationOutcome {
  problem: string | null;
  tier: SqlValidationTier;
  degradation?: SqlValidationDegradation;
}

/** 结构完整度：五项与方言无关，任何方言、任何适配器可用性下都执行（§2.52.2）。 */
function validateSqlStructure(payload: string): string | null {
  // 类别最低完整度与真正 parser/执行预检是两层门；关键词只负责提示缺少哪种设计资产。
  if (!/\bCREATE\s+TABLE\b/i.test(payload)) return '缺 CREATE TABLE';
  if (!/\bPRIMARY\s+KEY\b/i.test(payload)) return '缺主键';
  if (!/\b(CONSTRAINT|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i.test(payload)) return '缺约束';
  if (!/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(payload)) return '缺索引';
  if (!/(migration|migrate|迁移)/i.test(payload) || !/(rollback|回滚)/i.test(payload)) return '缺迁移/回滚语义';
  return null;
}

function degrade(
  dialect: DatabaseDialect,
  reason: SqlValidationDegradation['reason'],
  missing: string[],
  detail: string,
): SqlValidationOutcome {
  return { problem: null, tier: 'structure', degradation: { reason, dialect, missing, tier: 'structure', detail } };
}

/** SQLite 隔离执行预检：BEGIN → payload → 计数 → ROLLBACK，不落盘。 */
function validateSqliteByExecution(payload: string): SqlValidationOutcome {
  const sqlite = spawnSync('sqlite3', [':memory:'], {
    input: `.bail on\nPRAGMA foreign_keys=ON;\nBEGIN IMMEDIATE;\n${payload}\n`
      + "SELECT 'openlogos_tables=' || count(*) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%';\n"
      + "SELECT 'openlogos_indexes=' || count(*) FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL;\nROLLBACK;\n",
    encoding: 'utf-8', timeout: 10_000,
  });
  // §四十二.1：二进制缺失是**环境能力**缺失，不是提案缺陷——降级而非阻断。
  if (sqlite.error) {
    return degrade('sqlite', 'adapter-not-installed', ['sqlite3'],
      `本机未找到 sqlite3 可执行文件（${sqlite.error.message}）；已完成结构检查，未执行 sqlite 隔离执行预检`);
  }
  if (sqlite.status !== 0) return { problem: `SQLite 执行预检失败：${(sqlite.stderr || '').trim()}`, tier: 'execution' };
  const tables = Number(/openlogos_tables=(\d+)/.exec(sqlite.stdout || '')?.[1] ?? 0);
  const indexes = Number(/openlogos_indexes=(\d+)/.exec(sqlite.stdout || '')?.[1] ?? 0);
  if (tables < 1) return { problem: 'SQLite schema 预检后没有用户表', tier: 'execution' };
  if (indexes < 1) return { problem: 'SQLite schema 预检后没有显式索引', tier: 'execution' };
  return { problem: null, tier: 'execution' };
}

/**
 * 在一次性子进程中初始化 libpg_query WASM 并解析 stdin 上的 payload，以 JSON 回报判决。
 * 只做文本到 AST 的转换：不执行、不连库、不落盘、不联网。
 */
const PG_PARSE_SCRIPT = [
  "const entry = process.argv[1];",
  "let chunks = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', d => { chunks += d; });",
  "process.stdin.on('end', async () => {",
  "  try {",
  "    const mod = require(entry);",
  "    const factory = typeof mod === 'function' ? mod : mod.default;",
  "    if (typeof factory !== 'function') throw new Error('模块未暴露工厂函数');",
  "    const instance = await factory();",
  "    if (!instance || typeof instance.parse !== 'function') throw new Error('实例未暴露 parse 方法');",
  "    const parsed = instance.parse(chunks);",
  "    process.stdout.write(JSON.stringify(parsed.error",
  "      ? { ok: false, error: String(parsed.error.message) }",
  "      : { ok: true }));",
  "  } catch (error) {",
  "    process.stdout.write(JSON.stringify({ loadFailed: error instanceof Error ? error.message : String(error) }));",
  "  }",
  "});",
].join('\n');

/**
 * PostgreSQL 语法级校验：走 libpg_query 的 WASM 编译产物——即 PostgreSQL 自身的语法解析器，
 * 因此**定义上不会误拦合法 PG SQL**。只做文本到 AST 的转换：不执行、不连库、不落盘、不起进程。
 *
 * 这是**语法级**而非执行级——它不会发现「引用了不存在的表」这类只有执行才能发现的问题。
 * 层级自述为 'syntax'，与 SQLite 的 'execution' 明确区别（架构 §四十二.2）。
 */
function validatePostgresBySyntax(payload: string): SqlValidationOutcome {
  // 解析器工厂返回 Promise，而 validateSql 与其三个消费方都是同步的。与其把 async 涟漪扩散到
  // change-lint / merge / baseline-apply，不如沿用 SQLite 分支既有的 spawnSync 子进程模式——
  // 判据同步、WASM 在一次性子进程中初始化并随进程退出回收。
  let entry: string;
  try {
    entry = createRequire(import.meta.url).resolve('pg-query-emscripten');
  } catch (error) {
    return degrade('postgresql', 'adapter-not-installed', ['pg-query-emscripten'],
      `PostgreSQL 语法解析器未安装（${error instanceof Error ? error.message : String(error)}）；`
        + '已完成结构检查，未执行 postgresql 语法预检');
  }
  const child = spawnSync(process.execPath, ['-e', PG_PARSE_SCRIPT, entry], {
    input: payload, encoding: 'utf-8', timeout: 30_000,
  });
  if (child.error) {
    return degrade('postgresql', 'adapter-not-installed', ['pg-query-emscripten'],
      `PostgreSQL 语法解析器无法运行（${child.error.message}）；已完成结构检查，未执行 postgresql 语法预检`);
  }
  const raw = (child.stdout || '').trim();
  let verdict: { ok?: boolean; error?: string; loadFailed?: string };
  try {
    verdict = JSON.parse(raw) as typeof verdict;
  } catch {
    return degrade('postgresql', 'adapter-not-installed', ['pg-query-emscripten'],
      `PostgreSQL 语法解析器返回非预期输出（${(child.stderr || raw).slice(0, 200)}）；`
        + '已完成结构检查，未执行 postgresql 语法预检');
  }
  // 加载失败按「未安装」降级；解析失败才是提案缺陷（§四十二.1 的责任归属）。
  if (verdict.loadFailed) {
    return degrade('postgresql', 'adapter-not-installed', ['pg-query-emscripten'],
      `PostgreSQL 语法解析器无法加载（${verdict.loadFailed}）；已完成结构检查，未执行 postgresql 语法预检`);
  }
  if (!verdict.ok) return { problem: `PostgreSQL 语法预检失败：${verdict.error ?? '未知解析错误'}`, tier: 'syntax' };
  return { problem: null, tier: 'syntax' };
}

/**
 * SQL delta 校验（§2.52 / 架构 §四十二）。
 *
 * 分两层：结构层与方言无关且始终执行；方言层按本机可用适配器路由，不可用时**降级为跳过并留痕**，
 * 绝不阻断交付。此前的实现对非 SQLite 方言无条件 early return，把「产品尚未实现该适配器」表述为
 * 「你的 SQL 不合格」——让用户为工具的未完成买单，且对 PG/MySQL 项目没有任何合法出路。
 *
 * 不变量：任何方言的 payload 都不得送入其它方言的校验器。降级是**不执行方言层**，
 * 而非改用别的方言执行——绝无「用 SQLite 兜底」这条路径。
 */
function validateSql(payload: string, dialect: DatabaseDialect): SqlValidationOutcome {
  const structural = validateSqlStructure(payload);
  if (structural) return { problem: structural, tier: 'structure' };

  if (dialect === 'sqlite') return validateSqliteByExecution(payload);

  if (dialect === 'postgresql') return validatePostgresBySyntax(payload);

  // MySQL 尚无不会误拦合法 SQL 的权威解析器——现有唯一候选实测对合法分区表误拦，
  // 用它等于把「完全阻断」换成「随机阻断」。按未实现降级，等权威解析器出现再补。
  return degrade(dialect, 'adapter-not-implemented', [dialect],
    `${dialect} 的语法/执行预检适配器尚未实现；已完成结构检查，未执行 ${dialect} 方言校验`);
}

/**
 * 校验并剥离 API/DB non-Markdown delta 首行。返回的 payload 不含 marker，调用方不得把 marker 写入目标。
 */
export function validateAndStripNonMarkdownDelta(
  content: string,
  mode: 'MODIFY' | 'CREATE',
  canonicalTargetPath: string,
  options: { root?: string; databaseDialect?: DatabaseDialect } = {},
): NonMarkdownDeltaResult {
  const newline = content.indexOf('\n');
  if (newline < 0) return { ok: false, message: '整文件 delta 缺 payload 或首行行结束符' };
  const first = content.slice(0, newline).replace(/\r$/, '');
  const marker = NON_MD_MARKER.exec(first);
  if (!marker) return { ok: false, message: '首行控制 marker 不合法' };
  const expectedOp = mode === 'CREATE' ? 'ADDED' : 'MODIFIED';
  const expectedSuffix = mode === 'CREATE' ? '（新文件，整文件）' : '（整文件替换）';
  if (marker[1] !== expectedOp || marker[3] !== expectedSuffix) return { ok: false, message: `首行 mode 与 ${mode} 不一致` };
  if (marker[2] !== canonicalTargetPath) return { ok: false, message: `首行 target 与 canonical target 不一致：${marker[2]}` };
  const payload = content.slice(newline + 1);
  if (payload.trim() === '') return { ok: false, message: '剥离 marker 后 payload 为空' };
  if (/^## (?:ADDED|MODIFIED) — /m.test(payload)) return { ok: false, message: 'payload 内残留控制 marker' };
  if (/\b(?:TODO|TBD)\b|后续补充|\[新增的完整内容\]/i.test(payload)) return { ok: false, message: 'payload 含模板/TODO 骨架' };
  const ext = posix.extname(canonicalTargetPath).toLowerCase();
  let problem: string | null;
  if (canonicalTargetPath.startsWith('logos/resources/api/') && ['.yaml', '.yml', '.json'].includes(ext)) {
    problem = validateOpenApi(payload, ext);
  } else if (canonicalTargetPath.startsWith('logos/resources/database/') && ext === '.sql') {
    const resolved = options.databaseDialect
      ? { dialect: options.databaseDialect }
      : options.root ? resolveProjectDatabaseDialect(options.root) : { error: '缺少项目根，无法确定 SQL 方言' };
    if (!resolved.dialect) return { ok: false, message: resolved.error ?? '无法确定 SQL 方言' };
    const outcome = validateSql(payload, resolved.dialect);
    return outcome.problem
      ? { ok: false, message: outcome.problem, tier: outcome.tier }
      : { ok: true, payload, tier: outcome.tier, ...(outcome.degradation ? { degradation: outcome.degradation } : {}) };
  } else if (/^spec\/schema\/[a-z0-9][a-z0-9.-]*\.json$/.test(canonicalTargetPath)) {
    problem = validateOpenLogosRootJsonSchema(payload);
  } else {
    return { ok: false, message: '整文件协议只支持 API YAML/YML/JSON、database SQL 与受控根 spec/schema JSON' };
  }
  return problem ? { ok: false, message: problem } : { ok: true, payload };
}

