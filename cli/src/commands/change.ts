import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readLocale, t, proposalTemplate, tasksTemplate } from '../i18n.js';

interface ModuleEntry {
  id: string;
  lifecycle?: string;
}

function resolveModule(root: string, moduleArg: string | undefined, locale: string, slug: string): string {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  let modules: ModuleEntry[] = [];
  if (existsSync(yamlPath)) {
    try {
      const yaml = parseYaml(readFileSync(yamlPath, 'utf-8'));
      if (Array.isArray(yaml?.modules)) modules = yaml.modules as ModuleEntry[];
    } catch { /* ignore */ }
  }
  const l = locale as 'en' | 'zh';

  if (moduleArg) {
    if (!modules.find(m => m.id === moduleArg)) {
      console.error(t(l, 'change.moduleNotFound', { module: moduleArg }));
      // F1（code-r1）：决策表第 2 行要求「模块不存在 + 合法清单」——按 modules[] 声明顺序列出全部合法 id。
      console.error(t(l, 'change.moduleNotFoundAvailable', { modules: modules.map(m => m.id).join(', ') }));
      console.error(t(l, 'change.moduleNotFoundHint'));
      process.exit(1);
    }
    return moduleArg;
  }

  if (modules.length === 1) return modules[0].id;   // 单模块归属该唯一模块（可能非 core，不硬编码）
  const core = modules.find(m => m.id === 'core');
  if (core) return 'core';                          // 多模块含 core → 默认挂靠 core
  if (modules.length === 0) return 'core';          // 退化：无模块注册，保留既有兜底（不改行为）

  // 多模块（≥2）无 core 且未传 --module → fail-closed（issue #17）：
  // 非零退出，为每个合法 module id 各给出一条完整可执行的重试命令；绝不静默回退 modules[0]。
  console.error(t(l, 'change.moduleNoCore'));
  console.error(t(l, 'change.moduleNoCoreRetryHeader'));
  for (const m of modules) {
    console.error(`  openlogos change ${slug} --module ${m.id}`);
  }
  process.exit(1);
}

export function change(slug?: string, moduleArg?: string) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  if (!slug) {
    console.error('Error: Missing change proposal name.');
    console.error('Usage: openlogos change <slug>');
    console.error('Example: openlogos change add-remember-me');
    process.exit(1);
  }

  const changePath = join(root, 'logos', 'changes', slug);
  const locale = readLocale(root);

  if (existsSync(changePath)) {
    console.error(`Error: Change proposal '${slug}' already exists.`);
    process.exit(1);
  }

  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      const activeChange = typeof guard.activeChange === 'string' ? guard.activeChange : null;
      const activeChangePath = activeChange ? join(root, 'logos', 'changes', activeChange) : null;
      const archivedChangePath = activeChange ? join(root, 'logos', 'changes', 'archive', activeChange) : null;

      if (activeChange && activeChangePath && archivedChangePath && existsSync(activeChangePath) && !existsSync(archivedChangePath)) {
        console.error(t(locale, 'change.guardConflict', { activeChange }));
        console.error(t(locale, 'change.guardConflictHint', { activeChange }));
        process.exit(1);
      }
    } catch {
      console.error(t(locale, 'change.guardInvalid'));
      console.error(t(locale, 'change.guardInvalidHint'));
      process.exit(1);
    }
  }

  // Resolve module
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  let allModules: ModuleEntry[] = [];
  if (existsSync(yamlPath)) {
    try {
      const yaml = parseYaml(readFileSync(yamlPath, 'utf-8'));
      if (Array.isArray(yaml?.modules)) allModules = yaml.modules as ModuleEntry[];
    } catch { /* ignore */ }
  }
  const moduleId = resolveModule(root, moduleArg, locale, slug);

  // Print module assignment message
  if (moduleArg) {
    console.log(`\n${t(locale, 'change.creating', { slug })}`);
    console.log(t(locale, 'change.moduleAssigned', { module: moduleId }));
  } else if (allModules.length === 1) {
    console.log(`\n${t(locale, 'change.creating', { slug })}`);
    console.log(t(locale, 'change.moduleAuto', { module: moduleId }));
  } else {
    console.log(`\n${t(locale, 'change.creating', { slug })}`);
    console.log(t(locale, 'change.moduleDefault', { module: moduleId }));
  }
  console.log('');

  const deltaDirs = ['deltas/prd', 'deltas/api', 'deltas/database', 'deltas/scenario'];

  mkdirSync(changePath, { recursive: true });
  for (const dir of deltaDirs) {
    mkdirSync(join(changePath, dir), { recursive: true });
  }

  writeFileSync(join(changePath, 'proposal.md'), proposalTemplate(locale, slug, moduleId));
  console.log(`  ✓ logos/changes/${slug}/proposal.md`);

  writeFileSync(join(changePath, 'tasks.md'), tasksTemplate(locale));
  console.log(`  ✓ logos/changes/${slug}/tasks.md`);

  console.log(`  ✓ logos/changes/${slug}/deltas/`);

  const guard = JSON.stringify({
    activeChange: slug,
    module: moduleId,
    createdAt: new Date().toISOString(),
  }, null, 2);
  writeFileSync(guardPath, guard);
  console.log(`  ✓ logos/.openlogos-guard`);

  console.log(`\n${t(locale, 'change.done')}`);
  console.log(t(locale, 'change.step1', { slug }));
  console.log(t(locale, 'change.step2'));
  console.log(t(locale, 'change.step3'));
  console.log(t(locale, 'change.step4', { slug }) + '\n');
}
