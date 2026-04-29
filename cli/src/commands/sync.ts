import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readLocale, t } from '../i18n.js';
import { createAgentsMd, deploySkills, deploySpecs, deployOpenCodePlugin, deployCodexPlugin, type AiTool } from './init.js';
import { syncResourceIndex } from '../lib/sync-resource-index.js';
import { VERSION } from '../lib/json-output.js';
import { migrateProjectLifecycle } from '../lib/migrate-lifecycle.js';

export function syncLogosProjectName(root: string, projectName: string) {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) return false;

  const content = readFileSync(yamlPath, 'utf-8');
  const updated = content.replace(
    /^(\s*name:\s*)"[^"]*"/m,
    `$1"${projectName}"`
  );

  if (updated !== content) {
    writeFileSync(yamlPath, updated);
    return true;
  }
  return false;
}

export function sync() {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  console.log(`\nSyncing project files... (openlogos v${VERSION})\n`);

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const projectName = config.name || 'Unnamed Project';
  const locale = readLocale(root);
  const rawAiTool = config.aiTool || 'cursor';
  const aiTools: AiTool[] = Array.isArray(rawAiTool) ? rawAiTool : [rawAiTool];
  const primaryAiTool: AiTool = aiTools[0];

  // Run migration for old projects (config.lifecycle === 'active' → mark module launched)
  const migration = migrateProjectLifecycle(root);
  if (migration.migrated && migration.autoMarked) {
    console.log(`  ✓ ${t(locale, 'launch.migrationAuto', { module: migration.autoMarked })}`);
  } else if (migration.migrated && migration.warned) {
    console.error(`  ⚠ ${t(locale, 'launch.migrationWarn')}`);
  }

  // Derive isLaunched from modules
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  let isLaunched = false;
  if (existsSync(yamlPath)) {
    try {
      const yaml = parseYaml(readFileSync(yamlPath, 'utf-8'));
      if (Array.isArray(yaml?.modules)) {
        isLaunched = (yaml.modules as Array<{ lifecycle?: string }>).some(m => m.lifecycle === 'launched');
      }
    } catch { /* ignore */ }
  }

  const namesynced = syncLogosProjectName(root, projectName);
  if (namesynced) {
    console.log(`  ✓ logos-project.yaml name synced to "${projectName}"`);
  }

  // ========== Step 2: 扫描并补录缺失的 resource_index 条目 ==========
  const indexResult = syncResourceIndex(root, locale);
  if (indexResult.added > 0) {
    console.log(`  ✓ ${t(locale, 'sync.indexAdded', { count: String(indexResult.added) })}`);
  } else {
    console.log(`  ✓ ${t(locale, 'sync.indexNoop')}`);
  }

  const requiredDocs: Record<string, { label: { en: string; zh: string }; path: string; pattern: string }> = {
    changes: {
      label: { en: 'Change Proposals', zh: '变更提案' },
      path: './changes',
      pattern: '**/*.{md,json}',
    },
  };

  if (!config.documents) config.documents = {};
  let configUpdated = false;
  for (const [key, value] of Object.entries(requiredDocs)) {
    if (!config.documents[key]) {
      config.documents[key] = value;
      configUpdated = true;
      console.log(`  ✓ documents.${key} added to logos.config.json`);
    }
  }
  if (configUpdated) {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  // Ensure sourceRoots exists (backfill for older projects)
  if (!config.sourceRoots) {
    config.sourceRoots = { src: ['src'], test: ['test'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('  ✓ sourceRoots added to logos.config.json');
  }

  writeFileSync(join(root, 'AGENTS.md'), createAgentsMd(locale, primaryAiTool, 'agents', isLaunched));
  console.log('  ✓ AGENTS.md updated');

  writeFileSync(join(root, 'CLAUDE.md'), createAgentsMd(locale, primaryAiTool, 'claude', isLaunched));
  console.log('  ✓ CLAUDE.md updated');

  for (const tool of aiTools) {
    const deployResult = deploySkills(root, tool, locale, isLaunched);
    if (deployResult && deployResult.count > 0) {
      console.log(`  ✓ ${t(locale, 'init.skillsSynced', { count: String(deployResult.count), target: deployResult.target })}`);
    }
  }

  if (aiTools.includes('opencode')) {
    const pluginResult = deployOpenCodePlugin(root, locale);
    if (pluginResult) {
      console.log(`  ✓ ${t(locale, 'init.opencodePluginSynced', { target: pluginResult.target })}`);
      if (pluginResult.config.created) {
        console.log(`  ✓ ${t(locale, 'init.opencodeConfigCreated')}`);
      } else if (pluginResult.config.updated) {
        console.log(`  ✓ ${t(locale, 'init.opencodeConfigUpdated')}`);
      }
      if (pluginResult.commandCount > 0) {
        console.log(`  ✓ ${t(locale, 'init.opencodeCommandsDeployed', { count: String(pluginResult.commandCount) })}`);
      }
    }
  }

  if (aiTools.includes('codex')) {
    const codexResult = deployCodexPlugin(root, locale);
    if (codexResult) {
      console.log(`  ✓ ${t(locale, 'init.codexPluginSynced', { target: codexResult.target })}`);
      if (codexResult.config.created) {
        console.log(`  ✓ ${t(locale, 'init.codexConfigCreated')}`);
      } else if (codexResult.config.updated) {
        console.log(`  ✓ ${t(locale, 'init.codexConfigUpdated')}`);
      }
    }
  }

  const specResult = deploySpecs(root);
  if (specResult && specResult.count > 0) {
    console.log(`  ✓ ${specResult.count} specs synced to logos/spec/`);
  }

  console.log('\nSync complete.\n');
}
