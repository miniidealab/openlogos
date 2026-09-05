#!/usr/bin/env node
// 组装随包 cursor-plugin-template（cursor-adapter-parity）：
// hooks/agents 取自 plugin-cursor；skills 取共享 skills（补 frontmatter，name==目录名）；
// commands 由 plugin/commands/*.md 转换为 disable-model-invocation 显式命令 Skills。
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(cliRoot, '..');
const target = join(cliRoot, 'cursor-plugin-template');
const source = join(repoRoot, 'plugin-cursor');

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

// skills：共享方法论 Skills，缺 frontmatter 的补齐（description 以 OpenLogos 开头 = 托管归属锚）。
const skillsTarget = join(target, 'skills');
rmSync(skillsTarget, { recursive: true, force: true });
mkdirSync(skillsTarget, { recursive: true });
for (const name of readdirSync(join(repoRoot, 'skills'))) {
  const sourceDir = join(repoRoot, 'skills', name);
  if (!statSync(sourceDir).isDirectory()) continue;
  cpSync(sourceDir, join(skillsTarget, name), { recursive: true });
  const skill = join(skillsTarget, name, 'SKILL.md');
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
  writeFileSync(skill, `${frontmatter}\n${content}`);
}

// commands：claude 模板命令 → openlogos-<name>/SKILL.md（disable-model-invocation: true）。
const commandsSource = join(repoRoot, 'plugin', 'commands');
const commandsTarget = join(target, 'commands');
rmSync(commandsTarget, { recursive: true, force: true });
mkdirSync(commandsTarget, { recursive: true });
for (const file of readdirSync(commandsSource)) {
  if (!file.endsWith('.md')) continue;
  const base = basename(file, '.md');
  const name = `openlogos-${base}`;
  const body = readFileSync(join(commandsSource, file), 'utf8')
    .replaceAll('--ai-tool claude-code', '--ai-tool cursor')
    .replaceAll('${CLAUDE_PLUGIN_ROOT}/bin/openlogos-phase --plain', 'openlogos next')
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', '.cursor');
  const stripped = body.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]+?\n---\n/, '');
  const dir = join(commandsTarget, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'),
    `---\nname: "${name}"\ndescription: "OpenLogos — OpenLogos ${base} command"\ndisable-model-invocation: true\n---\n\n${stripped}`);
}

console.log(`cursor-plugin-template built at ${target}`);
