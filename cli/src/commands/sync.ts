import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t } from '../i18n.js';
import { createAgentsMd, deploySkills, deploySpecs, deployOpenCodePlugin, type AiTool, type Lifecycle } from './init.js';

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

  console.log('\nSyncing project files...\n');

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const projectName = config.name || 'Unnamed Project';
  const locale = readLocale(root);
  const aiTool: AiTool = config.aiTool || 'cursor';
  const lifecycle: Lifecycle = config.lifecycle || 'initial';

  const namesynced = syncLogosProjectName(root, projectName);
  if (namesynced) {
    console.log(`  ✓ logos-project.yaml name synced to "${projectName}"`);
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

  writeFileSync(join(root, 'AGENTS.md'), createAgentsMd(locale, aiTool, 'agents', lifecycle));
  console.log('  ✓ AGENTS.md updated');

  writeFileSync(join(root, 'CLAUDE.md'), createAgentsMd(locale, aiTool, 'claude', lifecycle));
  console.log('  ✓ CLAUDE.md updated');

  const deployResult = deploySkills(root, aiTool, locale, lifecycle);
  if (deployResult && deployResult.count > 0) {
    console.log(`  ✓ ${t(locale, 'init.skillsSynced', { count: String(deployResult.count), target: deployResult.target })}`);
  }

  if (aiTool === 'opencode') {
    const pluginResult = deployOpenCodePlugin(root, locale);
    if (pluginResult) {
      console.log(`  ✓ ${t(locale, 'init.opencodePluginSynced', { target: pluginResult.target })}`);
      if (pluginResult.config.created) {
        console.log(`  ✓ ${t(locale, 'init.opencodeConfigCreated')}`);
      } else if (pluginResult.config.updated) {
        console.log(`  ✓ ${t(locale, 'init.opencodeConfigUpdated')}`);
      }
    }
  }

  const specResult = deploySpecs(root);
  if (specResult && specResult.count > 0) {
    console.log(`  ✓ ${specResult.count} specs synced to logos/spec/`);
  }

  console.log('\nSync complete.\n');
}
