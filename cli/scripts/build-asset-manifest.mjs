import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildAssetManifest, validateAssetManifest } from '../dist/lib/asset-manifest.js';

const cliRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(cliRoot, '..');
const packagePath = relative => existsSync(join(cliRoot, relative)) ? join(cliRoot, relative) : null;
const source = (packaged, repository) => packagePath(packaged) ?? join(repoRoot, repository);
const packageJson = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const sources = [
  { group: 'skills', path: 'skills/change-writer/SKILL.md', sourcePath: source('skills/change-writer/SKILL.md', 'skills/change-writer/SKILL.md') },
  { group: 'skills', path: 'skills/change-writer/SKILL.en.md', sourcePath: source('skills/change-writer/SKILL.en.md', 'skills/change-writer/SKILL.en.md') },
  { group: 'templates', path: 'dist/i18n.js', sourcePath: join(cliRoot, 'dist/i18n.js') },
  { group: 'schemas', path: 'spec/schema/next.schema.json', sourcePath: source('spec/schema/next.schema.json', 'spec/schema/next.schema.json') },
  { group: 'schemas', path: 'spec/schema/status.schema.json', sourcePath: source('spec/schema/status.schema.json', 'spec/schema/status.schema.json') },
  { group: 'plugins', path: 'claude-plugin-template/.claude-plugin/plugin.json', sourcePath: source('claude-plugin-template/.claude-plugin/plugin.json', 'plugin/.claude-plugin/plugin.json') },
  { group: 'plugins', path: 'claude-plugin-template/skills/change-writer/SKILL.md', sourcePath: source('claude-plugin-template/skills/change-writer/SKILL.md', 'plugin/skills/change-writer/SKILL.md') },
];
const manifest = buildAssetManifest(packageJson.version, '1.3.0', sources);
const target = join(cliRoot, 'asset-manifest.json');
writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n');
if (sources.every(row => existsSync(join(cliRoot, row.path)))) validateAssetManifest(manifest, cliRoot);
console.log(`asset manifest: ${manifest.payloadHash}`);
