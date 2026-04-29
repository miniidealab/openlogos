import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { readLocale } from '../i18n.js';
import * as readline from 'node:readline';
import { type OutputFormat, makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';

interface ModuleEntry {
  id: string;
  name: string;
  lifecycle: 'initial' | 'launched';
}

function readProjectYaml(root: string): Record<string, unknown> {
  const path = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(path)) return {};
  try {
    return parseYaml(readFileSync(path, 'utf-8')) ?? {};
  } catch {
    return {};
  }
}

function writeProjectYaml(root: string, data: Record<string, unknown>): void {
  const path = join(root, 'logos', 'logos-project.yaml');
  writeFileSync(path, stringifyYaml(data, { lineWidth: 0 }));
}

function checkGuard(root: string): void {
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (!existsSync(guardPath)) {
    console.error('错误：当前没有活跃的变更提案（未找到 logos/.openlogos-guard）。');
    console.error('请先运行 openlogos change <slug> 创建变更提案，再执行此操作。');
    process.exit(1);
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

  const yaml = readProjectYaml(root);
  const modules = (yaml.modules as ModuleEntry[] | undefined) ?? [];

  if (format === 'json') {
    const data = {
      modules: modules.map(m => ({
        id: m.id,
        name: m.name,
        lifecycle: m.lifecycle,
      })),
    };
    process.stdout.write(JSON.stringify(makeEnvelope('module list', data)) + '\n');
    return;
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

export function moduleAdd(name: string | undefined): void {
  const root = process.cwd();
  checkConfig(root);
  checkGuard(root);

  if (!name) {
    console.error('Usage: openlogos module add <name>');
    process.exit(1);
  }

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(`Error: module name "${name}" is invalid. Use lowercase letters, digits, and hyphens only.`);
    process.exit(1);
  }

  const yaml = readProjectYaml(root);
  const modules = (yaml.modules as ModuleEntry[] | undefined) ?? [];

  if (modules.find(m => m.id === name)) {
    console.error(`Error: module "${name}" already exists.`);
    process.exit(1);
  }

  const locale = readLocale(root);
  modules.push({
    id: name,
    name: locale === 'zh' ? name : name,
    lifecycle: 'initial',
  });

  yaml.modules = modules;
  writeProjectYaml(root, yaml);
  console.log(`✓ Module "${name}" added to logos-project.yaml`);
  console.log('  Remember to update the current change proposal tasks.md to record this operation.');
}

export function moduleRename(oldName: string | undefined, newName: string | undefined): void {
  const root = process.cwd();
  checkConfig(root);
  checkGuard(root);

  if (!oldName || !newName) {
    console.error('Usage: openlogos module rename <old> <new>');
    process.exit(1);
  }

  if (!/^[a-z][a-z0-9-]*$/.test(newName)) {
    console.error(`Error: new module name "${newName}" is invalid. Use lowercase letters, digits, and hyphens only.`);
    process.exit(1);
  }

  const yaml = readProjectYaml(root);
  const modules = (yaml.modules as ModuleEntry[] | undefined) ?? [];
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
  checkGuard(root);

  if (!name) {
    console.error('Usage: openlogos module remove <name>');
    process.exit(1);
  }

  if (name === 'core') {
    console.error('Error: the "core" module is protected and cannot be removed.');
    process.exit(1);
  }

  const yaml = readProjectYaml(root);
  const modules = (yaml.modules as ModuleEntry[] | undefined) ?? [];
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
