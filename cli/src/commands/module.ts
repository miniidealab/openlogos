import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { readLocale } from '../i18n.js';
import * as readline from 'node:readline';
import { type OutputFormat, makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import { PRODUCT_TYPE_ENUM, isValidProductType, isGuiProductType } from '../lib/ui-first.js';
import { readProjectYaml as readRecoveredProjectYaml, type YamlDiagnostics } from '../lib/project-yaml.js';

interface ModuleEntry {
  id: string;
  name: string;
  lifecycle: 'initial' | 'launched';
  product_type?: string;
}

/**
 * fix-module-cmd-yaml-error-handling（S17 EX-3.2 / EX-3.3）：module 族统一读取结果。
 * - 健康 yaml：raw 为完整原始文档（供 read-modify-write 回写），diagnostics 为 null。
 * - 严格解析失败：降级到 lib/project-yaml 的 AST 恢复读取（与 status/next 同一口径），
 *   raw 为 null（降级态禁止整文档回写），modules 为恢复出的集合，diagnostics 携带解析诊断。
 */
interface ModuleYamlRead {
  raw: Record<string, unknown> | null;
  modules: ModuleEntry[];
  diagnostics: YamlDiagnostics | null;
}

function readModuleYaml(root: string): ModuleYamlRead {
  const path = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(path)) return { raw: {}, modules: [], diagnostics: null };
  try {
    const raw = (parseYaml(readFileSync(path, 'utf-8')) ?? {}) as Record<string, unknown>;
    return { raw, modules: (raw.modules as ModuleEntry[] | undefined) ?? [], diagnostics: null };
  } catch {
    const recovered = readRecoveredProjectYaml(root);
    return {
      raw: null,
      modules: (recovered.data?.modules ?? []) as unknown as ModuleEntry[],
      diagnostics: recovered.yaml_diagnostics ?? { parse_status: 'error', messages: [] },
    };
  }
}

function yamlErrorDetail(diagnostics: YamlDiagnostics): string {
  return diagnostics.messages[0] ?? 'unknown parse error';
}

/**
 * 错误分层门（EX-3.2 / EX-3.3）：
 * - 不可恢复（parse_status "error"）→ 任何 module 命令报 PROJECT_YAML_UNPARSABLE；
 * - 恢复态（parse_status "recovered"）→ 仅写命令报 PROJECT_YAML_DEGRADED_WRITE_REFUSED（forWrite=true）。
 * 命中即输出错误（JSON envelope 到 stderr / 文本到 console.error）并 exit 1；返回则可继续。
 * 数据不摧毁不变量：命中路径零写入，logos-project.yaml 字节不变。
 */
function rejectDegradedYaml(
  read: ModuleYamlRead,
  command: string,
  format: OutputFormat,
  forWrite: boolean,
): void {
  if (!read.diagnostics) return;
  const detail = yamlErrorDetail(read.diagnostics);
  let code: string;
  let msg: string;
  if (read.diagnostics.parse_status === 'error') {
    code = 'PROJECT_YAML_UNPARSABLE';
    msg = `logos-project.yaml is unparsable: ${detail}. Fix the YAML syntax and retry.`;
  } else if (forWrite) {
    code = 'PROJECT_YAML_DEGRADED_WRITE_REFUSED';
    msg = `logos-project.yaml has YAML syntax errors (read degraded to AST recovery): ${detail}. Fix the YAML syntax before modifying modules; refusing to write back a partially recovered document.`;
  } else {
    return;
  }
  if (format === 'json') {
    process.stderr.write(JSON.stringify(makeErrorEnvelope(command, code, msg)) + '\n');
  } else {
    console.error(`Error: ${msg}`);
  }
  process.exit(1);
}

function writeProjectYaml(root: string, data: Record<string, unknown>): void {
  const path = join(root, 'logos', 'logos-project.yaml');
  writeFileSync(path, stringifyYaml(data, { lineWidth: 0 }));
}

function warnIfActiveChange(root: string, operation: string): void {
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      const slug = guard.activeChange ?? '(unknown)';
      console.warn(`⚠  Warning: active change proposal "${slug}" detected.`);
      console.warn(`   ${operation} may affect files referenced in the proposal's deltas or tasks.md.`);
      console.warn(`   Review logos/changes/${slug}/tasks.md after this operation if needed.`);
    } catch {
      console.warn(`⚠  Warning: an active change proposal is in progress. Review it after ${operation}.`);
    }
  }
}

function checkConfig(root: string): void {
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }
}

function walkAndCollect(dir: string, prefix: string, results: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      walkAndCollect(fullPath, prefix, results);
    } else if (entry.startsWith(`${prefix}-`)) {
      results.push(fullPath);
    }
  }
}

const TEXT_EXTENSIONS = new Set(['.md', '.yaml', '.yml', '.json', '.txt', '.ts', '.js']);

function updateCrossReferences(root: string, oldName: string, newName: string): string[] {
  const updated: string[] = [];
  const scanDirs = [
    join(root, 'logos'),
    join(root, 'spec'),
  ];

  function scanDir(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const st = statSync(fullPath);
      if (st.isDirectory()) {
        scanDir(fullPath);
      } else {
        const ext = entry.slice(entry.lastIndexOf('.'));
        if (!TEXT_EXTENSIONS.has(ext)) continue;
        const content = readFileSync(fullPath, 'utf-8');
        // Replace `oldName-` prefix occurrences (word-boundary-safe: preceded by non-alnum or start)
        const updated_content = content.replace(
          new RegExp(`(?<![a-z0-9-])${oldName}-`, 'g'),
          `${newName}-`,
        );
        if (updated_content !== content) {
          writeFileSync(fullPath, updated_content);
          updated.push(fullPath.replace(root + '/', ''));
        }
      }
    }
  }

  for (const d of scanDirs) scanDir(d);
  return updated;
}

export function moduleList(format: OutputFormat = 'text'): void {
  const root = process.cwd();

  // JSON mode: errors go to stderr as JSON envelope
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    if (format === 'json') {
      process.stderr.write(JSON.stringify(makeErrorEnvelope('module list', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.')) + '\n');
    } else {
      console.error('Error: logos/logos.config.json not found.');
      console.error('Run `openlogos init` first to initialize the project.');
    }
    process.exit(1);
  }

  const read = readModuleYaml(root);
  rejectDegradedYaml(read, 'module list', format, false);
  const modules = read.modules;

  if (format === 'json') {
    const data: Record<string, unknown> = {
      modules: modules.map(m => ({
        id: m.id,
        name: m.name,
        lifecycle: m.lifecycle,
      })),
    };
    // 恢复态（EX-3.3 只读分层）：附解析诊断，口径与 status 一致，供消费方提示「yaml 受损（已降级恢复）」。
    if (read.diagnostics) {
      data.yaml_diagnostics = read.diagnostics;
    }
    process.stdout.write(JSON.stringify(makeEnvelope('module list', data)) + '\n');
    return;
  }

  if (read.diagnostics) {
    console.warn('⚠  logos-project.yaml has YAML syntax errors; modules below were recovered from a degraded parse. Fix the YAML before modifying modules.');
  }

  if (modules.length === 0) {
    console.log('No modules registered. Run `openlogos module add <name>` to create one.');
    return;
  }

  console.log('\n🧩 Registered Modules\n');
  const sorted = [...modules].sort((a, b) => {
    if (a.lifecycle === 'initial' && b.lifecycle !== 'initial') return -1;
    if (b.lifecycle === 'initial' && a.lifecycle !== 'initial') return 1;
    return 0;
  });
  for (const m of sorted) {
    const icon = m.lifecycle === 'initial' ? '🔄' : '✅';
    console.log(`  ${icon}  ${m.id}  ${m.name}  [${m.lifecycle}]`);
  }
  console.log();
}

export function moduleAdd(name: string | undefined, productType?: string): void {
  const root = process.cwd();
  checkConfig(root);

  if (!name) {
    console.error('Usage: openlogos module add <name> [product-type]');
    process.exit(1);
  }

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(`Error: module name "${name}" is invalid. Use lowercase letters, digits, and hyphens only.`);
    process.exit(1);
  }

  // 可选 product_type：给出即校验，非法值报错退出；省略则不写该字段（缺失 = 非 GUI 安全默认）。
  if (productType !== undefined && !isValidProductType(productType)) {
    console.error(`Error: invalid product type "${productType}". Valid values: ${PRODUCT_TYPE_ENUM.join(', ')}.`);
    process.exit(1);
  }

  const read = readModuleYaml(root);
  rejectDegradedYaml(read, 'module add', 'text', true);
  const yaml = read.raw!;
  const modules = read.modules;

  if (modules.find(m => m.id === name)) {
    console.error(`Error: module "${name}" already exists.`);
    process.exit(1);
  }

  const locale = readLocale(root);
  const entry: ModuleEntry = {
    id: name,
    name: locale === 'zh' ? name : name,
    lifecycle: 'initial',
  };
  if (productType !== undefined) {
    entry.product_type = productType;
  }
  modules.push(entry);

  yaml.modules = modules;
  writeProjectYaml(root, yaml);
  console.log(`✓ Module "${name}" added to logos-project.yaml`);
}

/**
 * proposal-ui-ux-first（切片1）：设置/更新模块的 product_type（overlay 注入与 ui_impact 派生的唯一数据源）。
 * 唯一数据源 = logos-project.yaml modules[].product_type。
 * 缺参/非法枚举/未知 module → 报错退出（exit 1），不写文件；合法幂等写入（相同值为 no-op）。
 */
export function moduleSetProductType(
  moduleId: string | undefined,
  productType: string | undefined,
  format: OutputFormat = 'text',
): void {
  const root = process.cwd();
  checkConfig(root);

  // 缺参 → 用法错误，不写文件。
  if (!moduleId || !productType) {
    if (format === 'json') {
      process.stderr.write(JSON.stringify(makeErrorEnvelope(
        'module set-product-type',
        'MISSING_ARGUMENT',
        'Usage: openlogos module set-product-type <module-id> <enum>',
      )) + '\n');
    } else {
      console.error('Usage: openlogos module set-product-type <module-id> <enum>');
    }
    process.exit(1);
  }

  // 非法枚举 → 报错并列出全部合法枚举，不写文件。
  if (!isValidProductType(productType)) {
    const msg = `Invalid product type "${productType}". Valid values: ${PRODUCT_TYPE_ENUM.join(', ')}.`;
    if (format === 'json') {
      process.stderr.write(JSON.stringify(makeErrorEnvelope(
        'module set-product-type',
        'INVALID_PRODUCT_TYPE',
        msg,
      )) + '\n');
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
  }

  const read = readModuleYaml(root);
  rejectDegradedYaml(read, 'module set-product-type', format, true);
  const yaml = read.raw!;
  const modules = read.modules;
  const mod = modules.find(m => m.id === moduleId);

  // 未知 module id → 报错，不写文件。
  if (!mod) {
    const msg = `Module "${moduleId}" not found.`;
    if (format === 'json') {
      process.stderr.write(JSON.stringify(makeErrorEnvelope(
        'module set-product-type',
        'MODULE_NOT_FOUND',
        msg,
      )) + '\n');
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
  }

  // 合法：幂等写入（相同值 = no-op，仍成功 exit 0）。
  const changed = mod.product_type !== productType;
  if (changed) {
    mod.product_type = productType;
    yaml.modules = modules;
    writeProjectYaml(root, yaml);
  }

  const isGui = isGuiProductType(productType);

  if (format === 'json') {
    const data = {
      module_id: moduleId,
      product_type: productType,
      is_gui: isGui,
      changed,
    };
    process.stdout.write(JSON.stringify(makeEnvelope('module set-product-type', data)) + '\n');
    return;
  }

  if (changed) {
    console.log(`✓ Module "${moduleId}" product_type set to "${productType}".`);
  } else {
    console.log(`✓ Module "${moduleId}" product_type already "${productType}" (no change).`);
  }
  console.log('  Run `openlogos sync` to align the GUI overlay if needed.');
}

export function moduleRename(oldName: string | undefined, newName: string | undefined): void {
  const root = process.cwd();
  checkConfig(root);
  warnIfActiveChange(root, `renaming module "${oldName}" → "${newName}"`);

  if (!oldName || !newName) {
    console.error('Usage: openlogos module rename <old> <new>');
    process.exit(1);
  }

  if (!/^[a-z][a-z0-9-]*$/.test(newName)) {
    console.error(`Error: new module name "${newName}" is invalid. Use lowercase letters, digits, and hyphens only.`);
    process.exit(1);
  }

  const read = readModuleYaml(root);
  rejectDegradedYaml(read, 'module rename', 'text', true);
  const yaml = read.raw!;
  const modules = read.modules;
  const idx = modules.findIndex(m => m.id === oldName);

  if (idx === -1) {
    console.error(`Error: module "${oldName}" not found.`);
    process.exit(1);
  }

  if (modules.find(m => m.id === newName)) {
    console.error(`Error: module "${newName}" already exists.`);
    process.exit(1);
  }

  modules[idx] = { ...modules[idx], id: newName };
  yaml.modules = modules;
  writeProjectYaml(root, yaml);
  console.log(`✓ Updated logos-project.yaml: "${oldName}" → "${newName}"`);

  const resourcesDir = join(root, 'logos', 'resources');
  const filesToRename: string[] = [];
  walkAndCollect(resourcesDir, oldName, filesToRename);

  for (const filePath of filesToRename) {
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    const base = filePath.substring(filePath.lastIndexOf('/') + 1);
    const newBase = `${newName}-${base.slice(oldName.length + 1)}`;
    renameSync(filePath, join(dir, newBase));
  }

  if (filesToRename.length > 0) {
    console.log(`\n✓ Renamed ${filesToRename.length} file(s):`);
    for (const f of filesToRename) {
      const base = f.substring(f.lastIndexOf('/') + 1);
      const newBase = `${newName}-${base.slice(oldName.length + 1)}`;
      console.log(`  ${f.replace(root + '/', '')} → ${newBase}`);
    }
  } else {
    console.log('  No files found with that prefix.');
  }

  const refUpdated = updateCrossReferences(root, oldName, newName);
  if (refUpdated.length > 0) {
    console.log(`\n✓ Updated cross-references in ${refUpdated.length} file(s):`);
    for (const f of refUpdated) console.log(`  ${f}`);
  }
}

export function moduleRemove(name: string | undefined): void {
  const root = process.cwd();
  checkConfig(root);
  warnIfActiveChange(root, `removing module "${name}"`);

  if (!name) {
    console.error('Usage: openlogos module remove <name>');
    process.exit(1);
  }

  if (name === 'core') {
    console.error('Error: the "core" module is protected and cannot be removed.');
    process.exit(1);
  }

  const read = readModuleYaml(root);
  rejectDegradedYaml(read, 'module remove', 'text', true);
  const yaml = read.raw!;
  const modules = read.modules;
  const idx = modules.findIndex(m => m.id === name);

  if (idx === -1) {
    console.error(`Error: module "${name}" not found.`);
    process.exit(1);
  }

  const resourcesDir = join(root, 'logos', 'resources');
  const affected: string[] = [];
  walkAndCollect(resourcesDir, name, affected);

  console.log(`\nAbout to remove module "${name}" from logos-project.yaml.`);
  if (affected.length > 0) {
    console.log(`\nThe following ${affected.length} file(s) will NOT be deleted automatically:`);
    for (const f of affected) console.log(`  ${f.replace(root + '/', '')}`);
    console.log('\nPlease delete them manually if no longer needed.');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`\nConfirm removal of module "${name}"? (yes/no): `, (answer: string) => {
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }
    modules.splice(idx, 1);
    yaml.modules = modules;
    writeProjectYaml(root, yaml);
    console.log(`✓ Module "${name}" removed from logos-project.yaml`);
  });
}
