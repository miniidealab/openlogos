import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t, proposalTemplate, tasksTemplate } from '../i18n.js';

export function change(slug?: string) {
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

  if (existsSync(changePath)) {
    console.error(`Error: Change proposal '${slug}' already exists.`);
    process.exit(1);
  }

  const locale = readLocale(root);

  console.log(`\n${t(locale, 'change.creating', { slug })}\n`);

  const deltaDirs = ['deltas/prd', 'deltas/api', 'deltas/database', 'deltas/scenario'];

  mkdirSync(changePath, { recursive: true });
  for (const dir of deltaDirs) {
    mkdirSync(join(changePath, dir), { recursive: true });
  }

  writeFileSync(join(changePath, 'proposal.md'), proposalTemplate(locale, slug));
  console.log(`  ✓ logos/changes/${slug}/proposal.md`);

  writeFileSync(join(changePath, 'tasks.md'), tasksTemplate(locale));
  console.log(`  ✓ logos/changes/${slug}/tasks.md`);

  console.log(`  ✓ logos/changes/${slug}/deltas/`);

  const guardPath = join(root, 'logos', '.openlogos-guard');
  const guard = JSON.stringify({
    activeChange: slug,
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
