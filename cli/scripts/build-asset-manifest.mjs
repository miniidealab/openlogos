import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildAssetManifest, validateAssetManifest } from '../dist/lib/asset-manifest.js';

const cliRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(cliRoot, '..');
const packagePath = relative => existsSync(join(cliRoot, relative)) ? join(cliRoot, relative) : null;
const source = (packaged, repository) => packagePath(packaged) ?? join(repoRoot, repository);
const packageJson = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const sources = [
  { group: 'schemas', path: 'spec/authority-closure.md', sourcePath: source('spec/authority-closure.md', 'spec/authority-closure.md') },
  { group: 'templates', path: 'dist/lib/authority-closure.js', sourcePath: join(cliRoot, 'dist/lib/authority-closure.js') },
  { group: 'skills', path: 'skills/architecture-designer/SKILL.md', sourcePath: source('skills/architecture-designer/SKILL.md', 'skills/architecture-designer/SKILL.md') },
  { group: 'skills', path: 'skills/change-writer/SKILL.md', sourcePath: source('skills/change-writer/SKILL.md', 'skills/change-writer/SKILL.md') },
  { group: 'skills', path: 'skills/change-writer/SKILL.en.md', sourcePath: source('skills/change-writer/SKILL.en.md', 'skills/change-writer/SKILL.en.md') },
  { group: 'skills', path: 'skills/merge-executor/SKILL.md', sourcePath: source('skills/merge-executor/SKILL.md', 'skills/merge-executor/SKILL.md') },
  { group: 'skills', path: 'skills/merge-executor/SKILL.en.md', sourcePath: source('skills/merge-executor/SKILL.en.md', 'skills/merge-executor/SKILL.en.md') },
  { group: 'skills', path: 'skills/scenario-architect/SKILL.md', sourcePath: source('skills/scenario-architect/SKILL.md', 'skills/scenario-architect/SKILL.md') },
  { group: 'skills', path: 'skills/deployment-designer/SKILL.md', sourcePath: source('skills/deployment-designer/SKILL.md', 'skills/deployment-designer/SKILL.md') },
  { group: 'skills', path: 'skills/test-writer/SKILL.md', sourcePath: source('skills/test-writer/SKILL.md', 'skills/test-writer/SKILL.md') },
  { group: 'skills', path: 'skills/code-reviewer/SKILL.md', sourcePath: source('skills/code-reviewer/SKILL.md', 'skills/code-reviewer/SKILL.md') },
  { group: 'templates', path: 'dist/i18n.js', sourcePath: join(cliRoot, 'dist/i18n.js') },
  { group: 'schemas', path: 'spec/schema/next.schema.json', sourcePath: source('spec/schema/next.schema.json', 'spec/schema/next.schema.json') },
  { group: 'schemas', path: 'spec/schema/status.schema.json', sourcePath: source('spec/schema/status.schema.json', 'spec/schema/status.schema.json') },
  { group: 'schemas', path: 'spec/schema/merge-transaction.schema.json', sourcePath: source('spec/schema/merge-transaction.schema.json', 'spec/schema/merge-transaction.schema.json') },
  { group: 'plugins', path: 'claude-plugin-template/.claude-plugin/plugin.json', sourcePath: source('claude-plugin-template/.claude-plugin/plugin.json', 'plugin/.claude-plugin/plugin.json') },
  { group: 'plugins', path: 'claude-plugin-template/skills/change-writer/SKILL.md', sourcePath: source('claude-plugin-template/skills/change-writer/SKILL.md', 'plugin/skills/change-writer/SKILL.md') },
  { group: 'plugins', path: 'claude-plugin-template/skills/architecture-designer/SKILL.md', sourcePath: source('claude-plugin-template/skills/architecture-designer/SKILL.md', 'plugin/skills/architecture-designer/SKILL.md') },
  { group: 'plugins', path: 'claude-plugin-template/skills/scenario-architect/SKILL.md', sourcePath: source('claude-plugin-template/skills/scenario-architect/SKILL.md', 'plugin/skills/scenario-architect/SKILL.md') },
  { group: 'plugins', path: 'claude-plugin-template/skills/deployment-designer/SKILL.md', sourcePath: source('claude-plugin-template/skills/deployment-designer/SKILL.md', 'plugin/skills/deployment-designer/SKILL.md') },
  { group: 'plugins', path: 'claude-plugin-template/skills/test-writer/SKILL.md', sourcePath: source('claude-plugin-template/skills/test-writer/SKILL.md', 'plugin/skills/test-writer/SKILL.md') },
  { group: 'plugins', path: 'claude-plugin-template/skills/code-reviewer/SKILL.md', sourcePath: source('claude-plugin-template/skills/code-reviewer/SKILL.md', 'plugin/skills/code-reviewer/SKILL.md') },
];
const manifest = buildAssetManifest(packageJson.version, '1.4.0', sources);
const target = join(cliRoot, 'asset-manifest.json');
writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n');
if (sources.every(row => existsSync(join(cliRoot, row.path)))) validateAssetManifest(manifest, cliRoot);
console.log(`asset manifest: ${manifest.payloadHash}`);
