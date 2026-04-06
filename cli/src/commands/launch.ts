import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t } from '../i18n.js';
import { createAgentsMd, deploySkills, type AiTool, type Lifecycle } from './init.js';
import { syncLogosProjectName } from './sync.js';

export function launch() {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const currentLifecycle: Lifecycle = config.lifecycle || 'initial';

  if (currentLifecycle === 'active') {
    console.log(`\n${t(readLocale(root), 'launch.alreadyActive')}\n`);
    return;
  }

  config.lifecycle = 'active';
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const locale = readLocale(root);
  const aiTool: AiTool = config.aiTool || 'cursor';
  const projectName = config.name || 'Unnamed Project';

  syncLogosProjectName(root, projectName);

  writeFileSync(join(root, 'AGENTS.md'), createAgentsMd(locale, aiTool, 'agents', 'active'));
  writeFileSync(join(root, 'CLAUDE.md'), createAgentsMd(locale, aiTool, 'claude', 'active'));

  const deployResult = deploySkills(root, aiTool, locale, 'active');

  console.log(`\n${t(locale, 'launch.done')}`);
  console.log(t(locale, 'launch.hint1'));
  console.log(t(locale, 'launch.hint2'));
  if (deployResult && deployResult.count > 0) {
    console.log(`  ✓ ${t(locale, 'launch.rulesUpdated', { target: deployResult.target })}`);
  }
  console.log('');
}
