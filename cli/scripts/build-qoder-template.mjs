#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(cliRoot, '..');
const target = join(cliRoot, 'qoder-plugin-template');
const source = join(repoRoot, 'plugin-qoder');
const pkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
cpSync(join(repoRoot, 'skills'), join(target, 'skills'), { recursive: true, force: true });
cpSync(join(repoRoot, 'plugin', 'commands'), join(target, 'commands'), { recursive: true, force: true });
cpSync(join(source, 'commands'), join(target, 'commands'), { recursive: true, force: true });

for (const name of readdirSync(join(target, 'commands'))) {
  if (!name.endsWith('.md')) continue;
  const command = join(target, 'commands', name);
  let content = readFileSync(command, 'utf8').replaceAll('--ai-tool claude-code', '--ai-tool qoder');
  if (name === 'next.md') {
    content = content.replace(
      'Run `${CLAUDE_PLUGIN_ROOT}/bin/openlogos-phase --plain` to detect the current project phase.',
      'Run `openlogos next` in the project root directory to detect the current project phase.',
    );
  }
  if (name === 'status.md') {
    content = content.replaceAll('${CLAUDE_PLUGIN_ROOT}', '${QODER_PLUGIN_ROOT}');
  }
  writeFileSync(command, content);
}

for (const name of readdirSync(join(target, 'skills'))) {
  const skill = join(target, 'skills', name, 'SKILL.md');
  if (!existsSync(skill)) continue;
  const content = readFileSync(skill, 'utf8');
  if (content.replace(/\r\n/g, '\n').startsWith('---\n')) continue;
  const frontmatter = [
    '---',
    `name: "${name}"`,
    `description: "OpenLogos ${name} 方法论 Skill"`,
    '---',
    '',
  ].join('\n');
  writeFileSync(skill, frontmatter + content);
}

const manifestPath = join(target, '.qoder-plugin', 'plugin.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = pkg.version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

mkdirSync(join(target, 'agents'), { recursive: true });
console.error(`Qoder template prepared: ${target}`);
