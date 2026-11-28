/**
 * 本仓测试入口按清单选文件（enable-layered-verify；`spec/test-results.md`「测试入口的义务」第 2 条）。
 *
 * verify 分层收窄或切片 checkpoint 时注入 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`（JSON 字符串数组）。收到清单时
 * 只收集可能含清单内用例的测试文件，文件内仍按用例名过滤。
 *
 * 等价基准：只按用例名过滤（收集全部文件）时实际执行的全部用例。选文件只允许不收集「确定不含清单内用例」的文件：
 *   一个文件满足任一条就收集——
 *     ① 源码中出现清单内的任一用例 ID；
 *     ② 不能证明它注册的全部名称都是源码里写明的文字。能证明的条件（按语法树判断，全部满足才算）：
 *        - 对 `it` / `test` / `describe` / `suite` 的每一处引用，都是一次注册调用的被调用者（可带已知修饰符），
 *          且第一个参数是不含反斜杠转义、不含插值的字符串字面量；
 *        - 这四个名字没有以别的方式取得或转手：从 `vitest` 导入时不改名、不用命名空间或默认导入、不 `require`；
 *          不从其他模块导入同名绑定；不经 `xxx.it`、`globalThis.test`、`xxx['it']` 访问；不当作值传递、赋值、用作解构
 *          默认值或再导出；文件里没有与它们同名的声明（变量、解构、函数、类、枚举、命名空间，含转译时被擦除的
 *          `declare`；函数参数与 catch 变量除外），不从对象里解构出这四个属性；全局对象
 *          （`globalThis` 等）只用于取不是注册器的具名属性；
 *        - 经相对导入（含再导出、`require`、动态导入）能到达的全部模块里，没有对这四个名字的未绑定引用，也不从
 *          `vitest` 取得注册器（只导入 `vi`、`expect`、钩子等不算）；导入解析不到、动态导入或 `require` 的目标不是
 *          字面量时视为不能证明。
 *   清单中有任何一个 ID 在全部测试文件中都找不到，或测试目录下存在符号链接（本模块的枚举与 vitest 的发现规则可能不一致）时，
 *   回落为收集全部文件。
 * 判断拿不准时一律保留文件。
 *
 * 本文件不是测试文件（不匹配 `*.test.ts`），由 `vitest.config.ts` 引用，并由 UT-S13-323～326 直接调用。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export const ELIGIBLE_IDS_ENV = 'OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS';

/** 合法清单：非空的字符串数组；其余（未设置、空串、非法 JSON、非数组、含非字符串、空数组）一律视为没有清单。 */
export function parseEligibleIds(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  try {
    const ids = JSON.parse(raw) as unknown;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string')) return undefined;
    return ids as string[];
  } catch {
    return undefined;
  }
}

/** 文件内的用例名过滤（与引入选文件之前相同）。 */
export function eligibleNamePattern(ids: string[] | undefined): RegExp | undefined {
  if (!ids) return undefined;
  const escaped = ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`);
}

/** 注册用例或分组的四个名字。 */
const REGISTRARS = new Set(['it', 'test', 'describe', 'suite']);
/** 不带参数、不改变名称来源的修饰符。 */
const PLAIN_MODIFIERS = new Set(['only', 'skip', 'todo', 'concurrent', 'sequential', 'fails', 'shuffle']);
/** 带一个条件参数、其后才是注册调用的修饰符。 */
const CONDITION_MODIFIERS = new Set(['skipIf', 'runIf']);
/** 可能持有全局注册器的对象名。 */
const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'self', 'window']);

/** 对一个模块源码的分析结果。 */
export interface ModuleFacts {
  /** 不能证明「注册的全部名称都是源码里写明的文字」（针对测试文件本身）。 */
  namesUnknown: boolean;
  /** 可能注册用例或转手注册器（针对被导入的模块）：从 vitest 导入了注册器，或有对四个名字的未绑定引用，或有不透明的访问。 */
  mayRegister: boolean;
  /** 相对导入的说明符（静态导入、再导出、字面量参数的 require / 动态导入）。 */
  relativeImports: string[];
  /** 有目标不是字面量的动态导入或 require。 */
  opaqueImport: boolean;
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.(?:m|c)?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function bindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) { out.add(name.text); return; }
  for (const el of name.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);
}

/**
 * `id` 这处引用是否绑定到函数参数或 catch 变量。只认这两种：它们一定有运行时的绑定，而且要把注册器交给它们，
 * 传入的一方必须把注册器当作值使用（会被另一条规则抓到）。其余与注册器同名的声明（变量、函数、类、枚举、命名空间、
 * 导入，含只有类型没有运行时实现的 `declare`）一律由 analyzeModule 判为不能证明——不在这里当作「局部绑定」。
 */
function boundLocally(id: ts.Identifier): boolean {
  const name = id.text;
  for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
    const names = new Set<string>();
    if (ts.isFunctionLike(node) && 'body' in node && node.body) for (const p of node.parameters) bindingNames(p.name, names);
    if (ts.isCatchClause(node) && node.variableDeclaration) bindingNames(node.variableDeclaration.name, names);
    if (names.has(name)) return true;
  }
  return false;
}

/** 声明是否处于没有运行时实现的环境（`declare …`、`declare global { … }` 等）。 */
function isAmbient(node: ts.Node): boolean {
  for (let cur: ts.Node | undefined = node; cur; cur = cur.parent) {
    if (ts.canHaveModifiers(cur) && ts.getModifiers(cur)?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword)) return true;
  }
  return false;
}

/**
 * 全局对象名（`globalThis`、`global`、`self`、`window`）这处引用是否被本文件里一个**有运行时实现**的局部声明遮住：
 * 函数参数、catch 变量，或所在作用域里不处于 `declare` 环境的变量声明（含循环变量）。业务代码里常有叫 `global`、`self`
 * 的局部变量，它们不是全局对象。
 */
function globalNameShadowed(id: ts.Identifier): boolean {
  if (boundLocally(id)) return true;
  const name = id.text;
  const has = (list: ts.VariableDeclarationList): boolean => {
    if (isAmbient(list)) return false;
    const names = new Set<string>();
    for (const d of list.declarations) bindingNames(d.name, names);
    return names.has(name);
  };
  for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
    if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      for (const st of node.statements) if (ts.isVariableStatement(st) && has(st.declarationList)) return true;
    }
    if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer) && has(node.initializer)) return true;
  }
  return false;
}

/** 解构元素所属的最外层声明（变量声明或参数）。 */
function rootDeclaration(node: ts.BindingElement): ts.Node {
  let cur: ts.Node = node;
  while (ts.isBindingElement(cur) || ts.isObjectBindingPattern(cur) || ts.isArrayBindingPattern(cur)) cur = cur.parent;
  return cur;
}

/** 标识符是不是一处「取值的引用」（而不是属性名、声明名、导入导出说明符里的名字）。 */
function isValueReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) && p.right === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p)
    || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === id) return false;
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return false; // 声明名或被解构的属性名（后者由解构规则单独处理）；默认值是普通表达式
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p)) && p.name === id) return false;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false; // 由导入规则单独处理
  if (ts.isLabeledStatement(p) || ts.isBreakStatement(p) || ts.isContinueStatement(p)) return false;
  if (ts.isJsxAttribute(p) && p.name === id) return false;
  return true; // 含 ShorthandPropertyAssignment、ExportSpecifier、作为参数或被赋值等
}

/** `id` 是否一次注册调用的被调用者，且第一个参数是不含转义、不含插值的字符串字面量。 */
function staticRegistration(id: ts.Identifier, sf: ts.SourceFile): boolean {
  let cur: ts.Expression = id;
  for (;;) {
    const p: ts.Node = cur.parent;
    if (!ts.isPropertyAccessExpression(p) || p.expression !== cur) break;
    const modifier = p.name.text;
    if (PLAIN_MODIFIERS.has(modifier)) { cur = p; continue; }
    if (CONDITION_MODIFIERS.has(modifier) && ts.isCallExpression(p.parent) && p.parent.expression === p) { cur = p.parent; continue; }
    return false; // .each、.for、.extend 或认不出的成员
  }
  const call = cur.parent;
  if (!ts.isCallExpression(call) || call.expression !== cur) return false; // 当作值使用
  const first = call.arguments[0];
  if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) return false;
  return !first.getText(sf).includes('\\'); // 转义：源码文字不等于运行时名称
}

/** 分析一个模块的源码。解析失败不抛错：语法树照常返回，认不出的写法按「不能证明」处理。 */
export function analyzeModule(file: string, source: string): ModuleFacts {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const facts: ModuleFacts = { namesUnknown: false, mayRegister: false, relativeImports: [], opaqueImport: false };
  const opaque = (): void => { facts.namesUnknown = true; facts.mayRegister = true; };
  const noteSpecifier = (text: string): void => {
    if (text.startsWith('./') || text.startsWith('../')) facts.relativeImports.push(text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      noteSpecifier(from);
      const clause = node.importClause;
      const isVitest = from === 'vitest';
      if (clause && !clause.isTypeOnly) {
        if (clause.name && (isVitest || REGISTRARS.has(clause.name.text))) opaque(); // 默认导入
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) { if (isVitest || REGISTRARS.has(bindings.name.text)) opaque(); }
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (isVitest) {
              // 只导入 vi、expect、钩子等不算；导入注册器才算可能注册，改名导入则无法跟踪
              if (REGISTRARS.has(imported)) { facts.mayRegister = true; if (el.propertyName) opaque(); }
            }
            else if (REGISTRARS.has(el.name.text)) opaque(); // 从别的模块导入同名绑定：不知道它做什么
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      noteSpecifier(node.moduleSpecifier.text);
      if (node.moduleSpecifier.text === 'vitest') opaque();
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        noteSpecifier(arg.text);
        if (arg.text === 'vitest' || arg.text.startsWith('vitest/')) opaque();
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword || arg) {
        facts.opaqueImport = true;
      }
    } else if (ts.isBindingElement(node) || ts.isVariableDeclaration(node)) {
      // 用变量声明或解构得到一个叫 it / test / describe / suite 的局部名字，或从对象里解构出这四个属性：
      // 之后经这个名字（或它的别名）注册的用例无法跟踪。函数参数不在此列——把注册器传进来的一方会被「当作值使用」抓到。
      const declared = new Set<string>();
      if (!(ts.isBindingElement(node) && ts.isParameter(rootDeclaration(node)))) bindingNames(node.name, declared);
      if ([...declared].some(n => REGISTRARS.has(n))) opaque();
      if (ts.isBindingElement(node) && node.propertyName) {
        const key = node.propertyName;
        if (ts.isComputedPropertyName(key)) { if (!(ts.isStringLiteral(key.expression) && !REGISTRARS.has(key.expression.text))) opaque(); }
        else if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && REGISTRARS.has(key.text)) opaque();
      }
    } else if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)
      || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) || ts.isImportEqualsDeclaration(node))
      && node.name && ts.isIdentifier(node.name) && REGISTRARS.has(node.name.text)) {
      // 与注册器同名的函数、类、枚举、命名空间声明：可能只是类型声明（`declare function it(...)`，转译时被擦除，
      // 运行时仍是全局注册器），也可能是包了一层的实现——两种都无法跟踪
      opaque();
    } else if (ts.isIdentifier(node) && GLOBAL_OBJECTS.has(node.text) && isValueReference(node) && !globalNameShadowed(node)) {
      // 全局对象只允许「取一个不是注册器的具名属性」；解构、下标、整体传递等都可能取走注册器
      const p = node.parent;
      const plainMember = ts.isPropertyAccessExpression(p) && p.expression === node && !REGISTRARS.has(p.name.text);
      const typeofCheck = ts.isTypeOfExpression(p);
      if (!plainMember && !typeofCheck) opaque();
    } else if (ts.isPropertyAccessExpression(node)) {
      const member = node.name.text;
      if (member === 'it' || member === 'describe' || member === 'suite') opaque(); // xxx.it(...)
      else if (member === 'test' && ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text)) opaque();
    } else if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      if ((ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) && REGISTRARS.has(arg.text)) opaque();
    } else if (ts.isIdentifier(node) && REGISTRARS.has(node.text) && isValueReference(node) && !boundLocally(node)) {
      facts.mayRegister = true;
      if (!staticRegistration(node, sf)) facts.namesUnknown = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return facts;
}

function resolveRelativeImport(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, ...['.ts', '.mts', '.mjs', '.js', '.cjs', '.tsx', '.jsx'].map(ext => base + ext)];
  if (/\.(?:m|c)?js$/.test(base)) candidates.push(base.replace(/\.(m|c)?js$/, '.$1ts'));
  for (const ext of ['index.ts', 'index.mjs', 'index.js']) candidates.push(join(base, ext));
  return candidates.find(p => { try { return statSync(p).isFile(); } catch { return false; } });
}

/** 分析结果按绝对路径缓存。只缓存「模块自身」的事实，不缓存依赖遍历的结论——遍历每个测试文件各做一次，不受扫描顺序与导入环影响。 */
export type FactsCache = Map<string, ModuleFacts | null>;

function factsOf(file: string, cache: FactsCache, source?: string): ModuleFacts | null {
  const known = cache.get(file);
  if (known !== undefined) return known;
  let facts: ModuleFacts | null;
  try { facts = analyzeModule(file, source ?? readFileSync(file, 'utf8')); } catch { facts = null; }
  cache.set(file, facts);
  return facts;
}

/**
 * 经相对导入（含传递）能到达的模块里，有没有可能注册用例的：对整个可达集合做一次完整遍历，任一模块可能注册、
 * 读不到、导入解析不到、或含目标不明的动态导入，即返回 true。
 */
function importsMayRegister(file: string, facts: ModuleFacts, cache: FactsCache): boolean {
  if (facts.opaqueImport) return true;
  const seen = new Set<string>([file]);
  const queue: Array<[string, string[]]> = [[file, facts.relativeImports]];
  while (queue.length > 0) {
    const [from, specifiers] = queue.shift()!;
    for (const specifier of specifiers) {
      const target = resolveRelativeImport(from, specifier);
      if (!target) return true;
      if (seen.has(target)) continue;
      seen.add(target);
      if (/\.(?:json|node)$/.test(target)) continue;
      const next = factsOf(target, cache);
      if (!next || next.mayRegister || next.opaqueImport) return true;
      queue.push([target, next.relativeImports]);
    }
  }
  return false;
}

/**
 * 一个测试文件注册的全部名称是否都能从它自己的源码确定（规则见文件头）。返回 false 的文件收到任何清单都要收集。
 */
export function fileNamesKnown(file: string, source: string, cache: FactsCache = new Map()): boolean {
  const facts = factsOf(file, cache, source);
  if (!facts || facts.namesUnknown) return false;
  return !importsMayRegister(file, facts, cache);
}

export interface FileSelection {
  /** `all`：收集全部文件；`narrowed`：只收集 `files`。 */
  mode: 'all' | 'narrowed';
  /** 要收集的测试文件（绝对路径，升序）。 */
  files: string[];
  /** `all` 的原因：没有清单；清单中有 ID 在全部测试文件中都找不到；测试目录下有符号链接；有测试文件读不到。 */
  reason?: 'no_list' | 'id_not_found' | 'symlink_present' | 'unreadable';
  /** `id_not_found` 时找不到的 ID。 */
  missingIds?: string[];
}

export interface TestFileListing {
  /** 全部 `*.test.ts`（绝对路径，升序）；不跟随符号链接。 */
  files: string[];
  /** 目录下遇到的符号链接（无论指向文件还是目录）。vitest 的发现规则会跟随它们，本模块不跟随，所以有链接时不收窄。 */
  symlinks: string[];
}

/** 枚举 `dir` 下（递归）的测试文件，并报告遇到的符号链接。 */
export function scanTestDir(dir: string): TestFileListing {
  const files: string[] = [];
  const symlinks: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const p = join(d, entry.name);
      if (entry.isSymbolicLink()) symlinks.push(p);
      else if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return { files: files.sort(), symlinks: symlinks.sort() };
}

/** 列出 `dir` 下（递归）的全部 `*.test.ts`，绝对路径、升序。 */
export function listTestFiles(dir: string): string[] {
  return scanTestDir(dir).files;
}

/** 按清单选出要收集的测试文件。`allFiles` 是全部测试文件的绝对路径；`symlinks` 非空时不收窄。 */
export function selectTestFiles(ids: string[] | undefined, allFiles: string[], symlinks: string[] = []): FileSelection {
  const files = [...allFiles].sort();
  if (!ids) return { mode: 'all', files, reason: 'no_list' };
  if (symlinks.length > 0) return { mode: 'all', files, reason: 'symlink_present' };
  const sources = new Map<string, string>();
  for (const file of files) {
    try { sources.set(file, readFileSync(file, 'utf8')); } catch { return { mode: 'all', files, reason: 'unreadable' }; }
  }
  const missingIds = ids.filter(id => ![...sources.values()].some(src => src.includes(id)));
  if (missingIds.length > 0) return { mode: 'all', files, reason: 'id_not_found', missingIds };
  const cache: FactsCache = new Map();
  const kept = files.filter(file => {
    const src = sources.get(file)!;
    if (ids.some(id => src.includes(id))) return true;
    return !fileNamesKnown(file, src, cache);
  });
  return { mode: 'narrowed', files: kept, missingIds: [] };
}

export interface EligibleVitestOptions {
  include: string[];
  testNamePattern: RegExp | undefined;
  selection: FileSelection;
}

/**
 * 供 vitest 配置使用：由环境变量取值算出 `include` 与 `testNamePattern`。
 * `selectFiles: false` 时只按用例名过滤、收集全部文件（引入选文件之前的行为，测试用它作等价基准）。
 */
export function eligibleVitestOptions(opts: { raw: string | undefined; root: string; testDir?: string; allGlob?: string; selectFiles?: boolean }): EligibleVitestOptions {
  const ids = parseEligibleIds(opts.raw);
  const allGlob = opts.allGlob ?? 'test/**/*.test.ts';
  const listing = scanTestDir(join(opts.root, opts.testDir ?? 'test'));
  const selection = opts.selectFiles === false ? { mode: 'all' as const, files: listing.files, reason: 'no_list' as const } : selectTestFiles(ids, listing.files, listing.symlinks);
  const include = selection.mode === 'all' ? [allGlob] : selection.files.map(file => relative(opts.root, file).split(sep).join('/'));
  return { include, testNamePattern: eligibleNamePattern(ids), selection };
}
