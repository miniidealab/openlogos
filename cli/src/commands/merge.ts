import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readLocale, t, mergePromptTemplate } from '../i18n.js';

const DELTA_TO_RESOURCE: Record<string, string> = {
  'prd': 'logos/resources/prd',
  'api': 'logos/resources/api',
  'database': 'logos/resources/database',
  'scenario': 'logos/resources/scenario',
};

interface DeltaFile {
  deltaPath: string;
  targetDir: string;
  relativePath: string;
}

export function scanDeltas(deltasDir: string): DeltaFile[] {
  const results: DeltaFile[] = [];
  if (!existsSync(deltasDir)) return results;

  for (const category of readdirSync(deltasDir)) {
    const categoryDir = join(deltasDir, category);
    if (!statSync(categoryDir).isDirectory()) continue;

    const targetDir = DELTA_TO_RESOURCE[category];
    if (!targetDir) continue;

    const files = readdirSync(categoryDir).filter(f => {
      const full = join(categoryDir, f);
      return statSync(full).isFile() && !f.startsWith('.');
    });

    for (const file of files) {
      results.push({
        deltaPath: join(categoryDir, file),
        targetDir,
        relativePath: `deltas/${category}/${file}`,
      });
    }
  }

  return results;
}

export function merge(slug?: string) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  if (!slug) {
    console.error('Error: Missing change proposal name.');
    console.error('Usage: openlogos merge <slug>');
    console.error('Example: openlogos merge add-remember-me');
    process.exit(1);
  }

  const changePath = join(root, 'logos', 'changes', slug);

  if (!existsSync(changePath)) {
    console.error(`Error: Change proposal '${slug}' not found.`);
    process.exit(1);
  }

  const deltasDir = join(changePath, 'deltas');
  const deltas = scanDeltas(deltasDir);

  if (deltas.length === 0) {
    console.error(`Error: No delta files found in logos/changes/${slug}/deltas/.`);
    console.error('Add delta files before running merge.');
    process.exit(1);
  }

  const locale = readLocale(root);

  const proposalPath = join(changePath, 'proposal.md');
  const proposalContent = existsSync(proposalPath)
    ? readFileSync(proposalPath, 'utf-8')
    : '(proposal.md not found)';

  const promptContent = mergePromptTemplate(locale, slug, proposalContent, deltas.map(d => ({
    relativePath: d.relativePath,
    deltaFullPath: relative(root, d.deltaPath),
    targetDir: d.targetDir,
  })));

  const promptPath = join(changePath, 'MERGE_PROMPT.md');
  writeFileSync(promptPath, promptContent);

  console.log(`\n📋 ${t(locale, 'merge.summary')}`);
  console.log(t(locale, 'merge.proposal', { slug }));
  console.log(t(locale, 'merge.deltaCount', { count: String(deltas.length) }));
  for (const d of deltas) {
    console.log(`    ${d.relativePath} → ${d.targetDir}/`);
  }

  console.log(`\n  ✓ logos/changes/${slug}/MERGE_PROMPT.md`);

  console.log(`\n💡 ${t(locale, 'merge.aiHint', { slug })}`);
  console.log(`\n${t(locale, 'merge.archiveHint', { slug })}\n`);
}
