import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t, PHASE_KEYS, SUGGEST_KEYS } from '../i18n.js';
import type { Lifecycle } from './init.js';

interface PhaseStatus {
  key: string;
  label: string;
  path: string;
  done: boolean;
  files: string[];
}

export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { recursive: true })
      .map(f => String(f))
      .filter(f => {
        const full = join(dir, f);
        return statSync(full).isFile() && !f.endsWith('.gitkeep');
      });
  } catch {
    return [];
  }
}

export function status() {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  const locale = readLocale(root);

  const phasePaths = [
    join(root, 'logos/resources/prd/1-product-requirements'),
    join(root, 'logos/resources/prd/2-product-design'),
    join(root, 'logos/resources/prd/3-technical-plan/1-architecture'),
    join(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation'),
    join(root, 'logos/resources/api'),
    join(root, 'logos/resources/database'),
    join(root, 'logos/resources/test'),
    join(root, 'logos/resources/scenario'),
    join(root, 'logos/resources/verify'),
  ];

  const phases: PhaseStatus[] = PHASE_KEYS.map((key, i) => ({
    key,
    label: t(locale, key),
    path: phasePaths[i],
    done: false,
    files: [],
  }));

  for (const phase of phases) {
    phase.files = listFiles(phase.path);
    phase.done = phase.files.length > 0;
  }

  console.log('\n📊 OpenLogos Project Status\n');
  console.log('─'.repeat(50));

  for (const phase of phases) {
    const icon = phase.done ? '✅' : '🔲';
    console.log(`${icon}  ${phase.label}`);
    if (phase.done) {
      for (const f of phase.files) {
        console.log(`     └─ ${f}`);
      }
    }
  }

  console.log('─'.repeat(50));

  const changesDir = join(root, 'logos', 'changes');
  const activeProposals: { name: string; hasProposal: boolean; hasTasks: boolean; deltaCount: number }[] = [];

  if (existsSync(changesDir)) {
    for (const entry of readdirSync(changesDir)) {
      if (entry === 'archive' || entry === '.gitkeep') continue;
      const entryPath = join(changesDir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      const hasProposal = existsSync(join(entryPath, 'proposal.md'));
      const hasTasks = existsSync(join(entryPath, 'tasks.md'));
      const deltasDir = join(entryPath, 'deltas');
      const deltaCount = existsSync(deltasDir) ? listFiles(deltasDir).length : 0;

      activeProposals.push({ name: entry, hasProposal, hasTasks, deltaCount });
    }
  }

  if (activeProposals.length > 0) {
    console.log(`\n📝 ${t(locale, 'status.activeProposals')}`);
    for (const p of activeProposals) {
      const parts = [
        p.hasProposal ? 'proposal.md ✓' : 'proposal.md ✗',
        p.hasTasks ? 'tasks.md ✓' : 'tasks.md ✗',
        `deltas: ${p.deltaCount} files`,
      ];
      console.log(`     └─ ${p.name} (${parts.join(' | ')})`);
    }
    console.log('─'.repeat(50));
  }

  const firstIncomplete = phases.find(p => !p.done);
  if (!firstIncomplete) {
    let lifecycle: Lifecycle = 'initial';
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      lifecycle = config.lifecycle || 'initial';
    } catch { /* ignore */ }

    console.log(`\n🎉 ${t(locale, 'status.allDone')}`);
    if (lifecycle === 'initial') {
      console.log(`   → ${t(locale, 'launch.suggest')}`);
    }
    console.log(t(locale, 'status.allDoneHint') + '\n');
  } else {
    console.log(`\n💡 ${t(locale, 'status.suggestNext', { label: firstIncomplete.label })}`);
    const suggestKey = SUGGEST_KEYS[firstIncomplete.key];
    console.log(`   → ${suggestKey ? t(locale, suggestKey) : t(locale, 'suggest.fallback')}\n`);
  }
}
