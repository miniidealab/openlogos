import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t, PHASE_KEYS, SUGGEST_KEYS } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import type { Lifecycle } from './init.js';

interface PhaseStatus {
  key: string;
  label: string;
  path: string;
  done: boolean;
  skipped: boolean;
  files: string[];
}

interface ProposalInfo {
  name: string;
  hasProposal: boolean;
  hasTasks: boolean;
  deltaCount: number;
}

export interface StatusData {
  phases: Array<{ key: string; label: string; done: boolean; skipped: boolean; files: string[] }>;
  active_proposals: Array<{
    name: string;
    has_proposal: boolean;
    has_tasks: boolean;
    delta_count: number;
  }>;
  current_phase: string | null;
  suggestion: string;
  all_done: boolean;
  lifecycle: string;
  source_roots: { src: string[]; test: string[] } | null;
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

export function collectStatusData(root: string): StatusData {
  const configPath = join(root, 'logos', 'logos.config.json');
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
    join(root, 'logos/resources/implementation'),
    join(root, 'logos/resources/verify'),
  ];

  const phases: PhaseStatus[] = PHASE_KEYS.map((key, i) => ({
    key,
    label: t(locale, key),
    path: phasePaths[i],
    done: false,
    skipped: false,
    files: [],
  }));

  for (const phase of phases) {
    phase.files = listFiles(phase.path);
    phase.done = phase.files.length > 0;
  }

  // Auto-detect skipped phases: if a phase is empty but a later phase
  // is done, the empty one was intentionally skipped (e.g. CLI projects
  // that don't need API/DB design).
  const lastDoneIdx = phases.reduce(
    (acc, p, i) => (p.done ? i : acc), -1,
  );
  for (let i = 0; i < lastDoneIdx; i++) {
    if (!phases[i].done) {
      phases[i].skipped = true;
    }
  }

  // Collect active proposals
  const changesDir = join(root, 'logos', 'changes');
  const activeProposals: ProposalInfo[] = [];

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

  // Determine current phase and suggestion (skip over skipped phases)
  const firstIncomplete = phases.find(p => !p.done && !p.skipped);
  const allDone = !firstIncomplete;

  let lifecycle: Lifecycle = 'initial';
  let sourceRoots: { src: string[]; test: string[] } | null = null;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    lifecycle = config.lifecycle || 'initial';
    sourceRoots = config.sourceRoots ?? null;
  } catch { /* ignore */ }

  let suggestion: string;
  if (allDone) {
    suggestion = lifecycle === 'initial'
      ? t(locale, 'launch.suggest')
      : t(locale, 'status.allDoneHint').trim();
  } else {
    const suggestKey = SUGGEST_KEYS[firstIncomplete!.key];
    suggestion = suggestKey ? t(locale, suggestKey) : t(locale, 'suggest.fallback');
  }

  return {
    phases: phases.map(p => ({ key: p.key, label: p.label, done: p.done, skipped: p.skipped, files: p.files })),
    active_proposals: activeProposals.map(p => ({
      name: p.name,
      has_proposal: p.hasProposal,
      has_tasks: p.hasTasks,
      delta_count: p.deltaCount,
    })),
    current_phase: firstIncomplete ? firstIncomplete.key : null,
    suggestion,
    all_done: allDone,
    lifecycle,
    source_roots: sourceRoots,
  };
}

export function status(format: OutputFormat = 'text') {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'status', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.',
      )));
      process.exit(1);
    }
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  const data = collectStatusData(root);

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('status', data)));
    return;
  }

  // Human-readable output (unchanged behavior)
  const locale = readLocale(root);
  const LINE = '─'.repeat(50);

  console.log('\n📊 OpenLogos Project Status\n');
  console.log(LINE);

  for (const phase of data.phases) {
    if (phase.skipped) continue;
    const icon = phase.done ? '✅' : '🔲';
    console.log(`${icon}  ${phase.label}`);
    if (phase.done) {
      for (const f of phase.files) {
        console.log(`     └─ ${f}`);
      }
    }
  }

  console.log(LINE);

  if (data.source_roots) {
    console.log(`\n📂 Source roots: src=[${data.source_roots.src.join(', ')}] test=[${data.source_roots.test.join(', ')}]`);
  }

  if (data.active_proposals.length > 0) {
    console.log(`\n📝 ${t(locale, 'status.activeProposals')}`);
    for (const p of data.active_proposals) {
      const parts = [
        p.has_proposal ? 'proposal.md ✓' : 'proposal.md ✗',
        p.has_tasks ? 'tasks.md ✓' : 'tasks.md ✗',
        `deltas: ${p.delta_count} files`,
      ];
      console.log(`     └─ ${p.name} (${parts.join(' | ')})`);
    }
    console.log(LINE);
  }

  if (data.all_done) {
    console.log(`\n🎉 ${t(locale, 'status.allDone')}`);
    if (data.lifecycle === 'initial') {
      console.log(`   → ${t(locale, 'launch.suggest')}`);
    }
    console.log(t(locale, 'status.allDoneHint') + '\n');
  } else {
    const firstIncomplete = data.phases.find(p => !p.done && !p.skipped)!;
    console.log(`\n💡 ${t(locale, 'status.suggestNext', { label: firstIncomplete.label })}`);
    console.log(`   → ${data.suggestion}\n`);
  }
}
