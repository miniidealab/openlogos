import { existsSync, mkdirSync, renameSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t } from '../i18n.js';

export function archive(slug?: string) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  const locale = readLocale(root);

  if (!slug) {
    console.error('Error: Missing change proposal name.');
    console.error('Usage: openlogos archive <slug>');
    console.error('Example: openlogos archive add-remember-me');
    process.exit(1);
  }

  const changePath = join(root, 'logos', 'changes', slug);

  if (!existsSync(changePath)) {
    console.error(`Error: Change proposal '${slug}' not found.`);
    process.exit(1);
  }

  const archiveDir = join(root, 'logos', 'changes', 'archive');
  const archivePath = join(archiveDir, slug);

  if (existsSync(archivePath)) {
    console.error(`Error: Archive '${slug}' already exists in logos/changes/archive/.`);
    process.exit(1);
  }

  mkdirSync(archiveDir, { recursive: true });
  renameSync(changePath, archivePath);

  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      if (guard.activeChange === slug) {
        unlinkSync(guardPath);
        console.log(`  ✓ logos/.openlogos-guard removed`);
      }
    } catch {
      unlinkSync(guardPath);
    }
  }

  console.log(`\n${t(locale, 'archive.done', { slug })}`);
  console.log(`${t(locale, 'archive.path', { slug })}\n`);
}
