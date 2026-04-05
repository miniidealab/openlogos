import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t } from '../i18n.js';
import { createAgentsMd, deploySkills, type AiTool } from './init.js';

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

  const namesynced = syncLogosProjectName(root, projectName);
  if (namesynced) {
    console.log(`  ✓ logos-project.yaml name synced to "${projectName}"`);
  }

  writeFileSync(join(root, 'AGENTS.md'), createAgentsMd(locale, aiTool, 'agents'));
  console.log('  ✓ AGENTS.md updated');

  writeFileSync(join(root, 'CLAUDE.md'), createAgentsMd(locale, aiTool, 'claude'));
  console.log('  ✓ CLAUDE.md updated');

  const deployResult = deploySkills(root, aiTool);
  if (deployResult && deployResult.count > 0) {
    console.log(`  ✓ ${t(locale, 'init.skillsSynced', { count: String(deployResult.count), target: deployResult.target })}`);
  }

  console.log('\nSync complete.\n');
}
