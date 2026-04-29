import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { readLocale, t } from '../i18n.js';
import { createAgentsMd, deploySkills, deployOpenCodePlugin, deployCodexPlugin, type AiTool } from './init.js';
import { syncLogosProjectName } from './sync.js';
import { migrateProjectLifecycle } from '../lib/migrate-lifecycle.js';

export function launch(moduleArg?: string) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');
  const locale = readLocale(root);

  if (!existsSync(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Run migration for old projects before deriving state
  const migration = migrateProjectLifecycle(root);
  if (migration.migrated && migration.autoMarked) {
    console.log(t(locale, 'launch.migrationAuto', { module: migration.autoMarked }));
  } else if (migration.migrated && migration.warned) {
    console.error(t(locale, 'launch.migrationWarn'));
  }

  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) {
    console.error('Error: logos/logos-project.yaml not found.');
    process.exit(1);
  }

  const yaml = parseYaml(readFileSync(yamlPath, 'utf-8')) ?? {};
  const modules: Array<{ id: string; name: string; lifecycle?: string }> =
    Array.isArray(yaml.modules) ? yaml.modules : [];

  // Resolve target module id
  let targetId: string;
  if (moduleArg) {
    targetId = moduleArg;
  } else if (modules.length === 1) {
    targetId = modules[0].id;
  } else if (modules.length === 0) {
    console.error('Error: No modules registered in logos-project.yaml.');
    process.exit(1);
  } else {
    const ids = modules.map(m => m.id).join(', ');
    console.error(t(locale, 'launch.multiModuleError', { modules: ids }));
    process.exit(1);
  }

  const mod = modules.find(m => m.id === targetId);
  if (!mod) {
    console.error(t(locale, 'launch.moduleNotFound', { module: targetId }));
    process.exit(1);
  }

  if (mod.lifecycle === 'launched' && migration.autoMarked !== targetId) {
    console.log(`\n${t(locale, 'launch.moduleAlreadyLaunched', { module: targetId })}\n`);
    return;
  }

  // Mark module as launched
  mod.lifecycle = 'launched';
  writeFileSync(yamlPath, stringifyYaml(yaml, { lineWidth: 0 }));

  // Fix 5: remove stale project-level lifecycle from config
  if ('lifecycle' in config) {
    delete config['lifecycle'];
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  const isLaunched = true;
  const rawAiTool = config.aiTool || 'cursor';
  const aiTools: AiTool[] = Array.isArray(rawAiTool) ? rawAiTool : [rawAiTool];
  const primaryAiTool: AiTool = aiTools[0];
  const projectName = config.name || 'Unnamed Project';

  syncLogosProjectName(root, projectName);

  writeFileSync(join(root, 'AGENTS.md'), createAgentsMd(locale, primaryAiTool, 'agents', isLaunched));
  writeFileSync(join(root, 'CLAUDE.md'), createAgentsMd(locale, primaryAiTool, 'claude', isLaunched));

  for (const tool of aiTools) {
    const deployResult = deploySkills(root, tool, locale, isLaunched);
    if (deployResult && deployResult.count > 0) {
      console.log(`  ✓ ${t(locale, 'launch.rulesUpdated', { target: deployResult.target })}`);
    }
  }

  if (aiTools.includes('opencode')) {
    deployOpenCodePlugin(root, locale);
  }

  if (aiTools.includes('codex')) {
    deployCodexPlugin(root, locale);
  }

  console.log(`\n${t(locale, 'launch.done', { module: targetId })}`);
  console.log(t(locale, 'launch.hint1'));
  console.log(t(locale, 'launch.hint2'));
  console.log('');
}
