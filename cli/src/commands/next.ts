import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readLocale, t } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { collectStatusData } from './status.js';
import type { ProposalStep } from './status.js';

export interface NextModuleItem {
  id: string;
  name: string;
  lifecycle: 'initial' | 'launched';
  action: string;
  command: string | null;
  detail: string;
  active_change: string | null;
  proposal_step: ProposalStep | null;
}

export interface NextData {
  action: string;
  command: string | null;
  detail: string;
  active_change: string | null;
  proposal_step: string | null;
  modules?: NextModuleItem[];
}

function buildModuleNextItem(
  mod: { id: string; name: string; lifecycle: 'initial' | 'launched'; suggestion: string; active_change: { slug: string; proposal_step: ProposalStep } | null },
  guardActiveChange: string | null,
  guardModule: string | null,
  locale: string,
): NextModuleItem {
  if (mod.lifecycle === 'launched') {
    if (mod.active_change) {
      const step = mod.active_change.proposal_step;
      let action: string;
      let command: string | null = null;
      if (step === 'writing') {
        action = t(locale as Parameters<typeof t>[0], 'next.fillProposal');
      } else if (step === 'implementing') {
        action = t(locale as Parameters<typeof t>[0], 'next.startCoding');
      } else if (step === 'in-progress') {
        action = t(locale as Parameters<typeof t>[0], 'next.continueImpl');
      } else {
        action = t(locale as Parameters<typeof t>[0], 'next.merge');
        command = null;
      }
      return {
        id: mod.id, name: mod.name, lifecycle: 'launched',
        action, command, detail: mod.suggestion,
        active_change: mod.active_change.slug, proposal_step: step,
      };
    }

    // No active change on this module
    if (guardActiveChange && guardModule !== mod.id) {
      // Blocked by another module's guard
      const detail = locale === 'zh'
        ? `当前活跃提案 ${guardActiveChange}（归属 ${guardModule ?? '?'}）未完成，请先完成后再为此模块创建新提案`
        : `Active proposal ${guardActiveChange} (module: ${guardModule ?? '?'}) is in progress — finish it before creating a new proposal for this module`;
      return {
        id: mod.id, name: mod.name, lifecycle: 'launched',
        action: 'blocked', command: null, detail,
        active_change: null, proposal_step: null,
      };
    }

    return {
      id: mod.id, name: mod.name, lifecycle: 'launched',
      action: t(locale as Parameters<typeof t>[0], 'next.createChange'),
      command: 'openlogos change <slug>',
      detail: mod.suggestion,
      active_change: null, proposal_step: null,
    };
  }

  // initial lifecycle — not affected by guard
  return {
    id: mod.id, name: mod.name, lifecycle: 'initial',
    action: mod.suggestion,
    command: null,
    detail: '',
    active_change: null, proposal_step: null,
  };
}

export function next(format: OutputFormat = 'text', moduleId?: string) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'next', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.',
      )));
      process.exit(1);
    }
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  // Validate --module if provided
  if (moduleId) {
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    if (existsSync(yamlPath)) {
      try {
        const yaml = parseYaml(readFileSync(yamlPath, 'utf-8'));
        const mods = Array.isArray(yaml?.modules) ? yaml.modules as Array<{ id: string }> : [];
        if (!mods.find(m => m.id === moduleId)) {
          console.error(`Error: Module '${moduleId}' not found in logos-project.yaml.`);
          console.error('Run `openlogos module list` to see available modules.');
          process.exit(1);
        }
      } catch { /* ignore */ }
    }
  }

  const data = collectStatusData(root, moduleId);
  const locale = readLocale(root);

  // Read guard module
  let guardModule: string | null = null;
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      guardModule = guard.module || null;
    } catch { /* ignore */ }
  }

  // Build per-module next items if modules exist
  let moduleItems: NextModuleItem[] | undefined;
  if (data.modules && data.modules.length > 0) {
    moduleItems = data.modules.map(m => buildModuleNextItem(
      {
        id: m.id, name: m.name, lifecycle: m.lifecycle,
        suggestion: m.suggestion,
        active_change: m.active_change ? { slug: m.active_change.slug, proposal_step: m.active_change.proposal_step } : null,
      },
      data.active_change,
      guardModule,
      locale,
    ));
  }

  // Global action (legacy / no-modules path)
  let action: string;
  let command: string | null = null;
  let detail: string;

  if (data.lifecycle === 'launched') {
    if (!data.active_change) {
      action = t(locale, 'next.createChange');
      command = 'openlogos change <slug>';
      detail = t(locale, 'next.createChangeDetail');
    } else {
      const slug = data.active_change;
      switch (data.proposal_step) {
        case 'writing':
          action = t(locale, 'next.fillProposal');
          command = null;
          detail = t(locale, 'next.fillProposalDetail', { slug });
          break;
        case 'implementing':
          action = t(locale, 'next.startCoding');
          command = null;
          detail = t(locale, 'next.startCodingDetail', { slug });
          break;
        case 'in-progress':
          action = t(locale, 'next.continueImpl');
          command = null;
          detail = t(locale, 'next.continueImplDetail', { slug });
          break;
        case 'ready-to-merge':
          action = t(locale, 'next.merge');
          command = null;
          detail = t(locale, 'next.mergeDetail', { slug });
          break;
        default:
          action = t(locale, 'next.fillProposal');
          command = null;
          detail = t(locale, 'next.fillProposalDetail', { slug });
      }
    }
  } else if (data.all_done) {
    action = t(locale, 'next.launch');
    command = 'openlogos launch';
    detail = t(locale, 'launch.suggest');
  } else {
    action = data.suggestion;
    command = null;
    detail = data.current_phase
      ? t(locale, 'next.phaseDetail', { phase: data.current_phase })
      : '';
  }

  const result: NextData = {
    action,
    command,
    detail,
    active_change: data.active_change,
    proposal_step: data.proposal_step,
    ...(moduleItems !== undefined ? { modules: moduleItems } : {}),
  };

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('next', result)));
    return;
  }

  console.log(`\n💡 ${t(locale, 'next.title')}\n`);

  if (moduleItems && moduleItems.length > 0) {
    for (const m of moduleItems) {
      const icon = m.lifecycle === 'initial' ? '🔄' : (m.action === 'blocked' ? '⏸️ ' : '✅');
      console.log(`  ${icon}  ${m.id} (${m.name})`);
      console.log(`       ${m.action}`);
      if (m.command) console.log(`       → ${m.command}`);
      if (m.detail) console.log(`       ${m.detail}`);
    }
  } else {
    console.log(`   ${action}`);
    if (command) console.log(`\n   → ${command}`);
    if (detail) console.log(`\n   ${detail}`);
  }
  console.log();
}
