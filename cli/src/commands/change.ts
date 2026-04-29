import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readLocale, t, proposalTemplate, tasksTemplate } from '../i18n.js';

interface ModuleEntry {
  id: string;
  lifecycle?: string;
}

function resolveModule(root: string, moduleArg: string | undefined, locale: string): string {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  let modules: ModuleEntry[] = [];
  if (existsSync(yamlPath)) {
    try {
      const yaml = parseYaml(readFileSync(yamlPath, 'utf-8'));
      if (Array.isArray(yaml?.modules)) modules = yaml.modules as ModuleEntry[];
    } catch { /* ignore */ }
  }

  if (moduleArg) {
    if (!modules.find(m => m.id === moduleArg)) {
      console.error(t(locale as 'en' | 'zh', 'change.moduleNotFound', { module: moduleArg }));
      console.error(t(locale as 'en' | 'zh', 'change.moduleNotFoundHint'));
      process.exit(1);
    }
    return moduleArg;
  }

  if (modules.length === 1) return modules[0].id;
  const core = modules.find(m => m.id === 'core');
  return core ? 'core' : (modules[0]?.id ?? 'core');
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
  const moduleId = resolveModule(root, moduleArg, locale);

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
