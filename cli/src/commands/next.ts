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
  bootstrap?: 'normal' | 'skipped';
  action: string;
  command: string | null;
  detail: string;
  active_change: string | null;
  proposal_step: ProposalStep | null;
  deployment_decision_conflict?: boolean;
  deployment_decision_conflict_reason?: string | null;
  deployment_warnings?: string[];
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
  mod: {
    id: string;
    name: string;
    lifecycle: 'initial' | 'launched';
    bootstrap?: 'normal' | 'skipped';
    suggestion: string;
    active_change: {
      slug: string;
      proposal_step: ProposalStep;
      deployment_decision_conflict?: boolean;
      deployment_decision_conflict_reason?: string | null;
      deployment_warnings?: string[];
    } | null;
  },
  guardActiveChange: string | null,
  guardModule: string | null,
  locale: string,
): NextModuleItem {
  if (mod.lifecycle === 'launched') {
    if (mod.active_change) {
      if (mod.active_change.deployment_decision_conflict) {
        return {
          id: mod.id, name: mod.name, lifecycle: 'launched',
          action: locale === 'zh' ? '修正部署决策冲突' : 'Fix deployment decision conflict',
          command: null,
          detail: mod.active_change.deployment_warnings?.join(' ') || mod.suggestion,
          active_change: mod.active_change.slug,
          proposal_step: mod.active_change.proposal_step,
          deployment_decision_conflict: true,
          deployment_decision_conflict_reason: mod.active_change.deployment_decision_conflict_reason ?? null,
          ...(mod.active_change.deployment_warnings ? { deployment_warnings: mod.active_change.deployment_warnings } : {}),
        };
      }
      const step = mod.active_change.proposal_step;
      const { action, command } = actionForProposalStep(locale, step);
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

    if (mod.bootstrap === 'skipped') {
      return {
        id: mod.id, name: mod.name, lifecycle: 'launched',
        bootstrap: mod.bootstrap,
        action: locale === 'zh' ? '先补充项目基线文档' : 'Fill in baseline docs first',
        command: 'openlogos change add-baseline-docs',
        detail: locale === 'zh'
          ? '建议先创建补文档提案，再开始业务迭代。'
          : 'Create a baseline-docs change proposal before starting feature work.',
        active_change: null, proposal_step: null,
      };
    }

    return {
      id: mod.id, name: mod.name, lifecycle: 'launched',
      bootstrap: mod.bootstrap,
      action: t(locale as Parameters<typeof t>[0], 'next.createChange'),
      command: 'openlogos change <slug>',
      detail: mod.suggestion,
      active_change: null, proposal_step: null,
    };
  }

  // initial lifecycle — not affected by guard
  return {
    id: mod.id, name: mod.name, lifecycle: 'initial',
    bootstrap: mod.bootstrap,
    action: mod.suggestion,
    command: null,
    detail: '',
    active_change: null, proposal_step: null,
  };
}

function actionForProposalStep(locale: string, step: ProposalStep | null): { action: string; command: string | null; detailKey: string } {
  switch (step) {
    case 'writing':
      return { action: t(locale as Parameters<typeof t>[0], 'next.fillProposal'), command: null, detailKey: 'next.fillProposalDetail' };
    case 'delta-writing':
    case 'implementing':
    case 'in-progress':
      return { action: t(locale as Parameters<typeof t>[0], 'next.writeDeltas'), command: null, detailKey: 'next.writeDeltasDetail' };
    case 'ready-to-merge':
      return { action: t(locale as Parameters<typeof t>[0], 'next.merge'), command: null, detailKey: 'next.mergeDetail' };
    case 'merge-generated':
      return { action: t(locale as Parameters<typeof t>[0], 'next.executeMerge'), command: null, detailKey: 'next.executeMergeDetail' };
    case 'coding':
      return { action: t(locale as Parameters<typeof t>[0], 'next.startCoding'), command: null, detailKey: 'next.startCodingDetail' };
    case 'ready-to-verify':
      return { action: t(locale as Parameters<typeof t>[0], 'next.runVerify'), command: null, detailKey: 'next.runVerifyDetail' };
    case 'verify-passed':
    case 'deploy-done':
    case 'smoke-passed':
      return { action: t(locale as Parameters<typeof t>[0], 'next.archive'), command: null, detailKey: 'next.archiveDetail' };
    case 'ready-to-deploy':
      return { action: t(locale as Parameters<typeof t>[0], 'next.authorizeDeploy'), command: null, detailKey: 'next.authorizeDeployDetail' };
    case 'ready-to-smoke':
      return { action: t(locale as Parameters<typeof t>[0], 'next.runSmoke'), command: null, detailKey: 'next.runSmokeDetail' };
    case 'smoke-failed':
      return { action: t(locale as Parameters<typeof t>[0], 'next.fixAndSmoke'), command: null, detailKey: 'next.fixAndSmokeDetail' };
    case 'verify-failed':
      return { action: t(locale as Parameters<typeof t>[0], 'next.fixAndVerify'), command: null, detailKey: 'next.fixAndVerifyDetail' };
    default:
      return { action: t(locale as Parameters<typeof t>[0], 'next.fillProposal'), command: null, detailKey: 'next.fillProposalDetail' };
  }
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
        id: m.id, name: m.name, lifecycle: m.lifecycle, bootstrap: m.bootstrap,
        suggestion: m.suggestion,
        active_change: m.active_change ? {
          slug: m.active_change.slug,
          proposal_step: m.active_change.proposal_step,
          deployment_decision_conflict: m.active_change.deployment_decision_conflict,
          deployment_decision_conflict_reason: m.active_change.deployment_decision_conflict_reason,
          deployment_warnings: m.active_change.deployment_warnings,
        } : null,
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
      const bootstrapModule = data.modules?.find(m => m.lifecycle === 'launched' && m.bootstrap === 'skipped');
      if (bootstrapModule) {
        action = locale === 'zh'
          ? '先补充项目基线文档'
          : 'Fill in the project baseline documents first';
        command = 'openlogos change add-baseline-docs';
        detail = locale === 'zh'
          ? '建议先创建补文档提案，再开始业务迭代。'
          : 'Create a baseline-docs change proposal before starting feature work.';
      } else {
        action = t(locale, 'next.createChange');
        command = 'openlogos change <slug>';
        detail = t(locale, 'next.createChangeDetail');
      }
    } else {
      const slug = data.active_change;
      const activeModule = data.modules?.find(m => m.active_change?.slug === slug);
      if (activeModule?.active_change?.deployment_decision_conflict) {
        action = locale === 'zh' ? '修正部署决策冲突' : 'Fix deployment decision conflict';
        command = null;
        detail = activeModule.active_change.deployment_decision_conflict_reason
          || activeModule.active_change.deployment_warnings?.join(' ')
          || (locale === 'zh'
            ? 'proposal.md 与 tasks.md 的部署决策不一致，请先修正。'
            : 'proposal.md and tasks.md disagree on deployment decisions — fix them first.');
      } else {
        const nextAction = actionForProposalStep(locale, data.proposal_step);
        action = nextAction.action;
        command = nextAction.command;
        detail = t(locale, nextAction.detailKey, { slug });
      }
    }
  } else if (data.all_done) {
    action = t(locale, 'next.launch');
    command = 'openlogos launch';
    detail = t(locale, 'launch.suggest');
  } else {
    const firstModule = data.modules?.find(m => m.bootstrap === 'skipped' || m.lifecycle === 'initial');
    const bootstrapSkipped = firstModule?.bootstrap === 'skipped'
      || firstModule?.phase_progress?.['phase.1']?.skip_reason === 'bootstrap-skipped'
      || firstModule?.phase_progress?.['phase.2']?.skip_reason === 'bootstrap-skipped'
      || firstModule?.phase_progress?.['phase.3-0']?.skip_reason === 'bootstrap-skipped';

    if (bootstrapSkipped && !data.active_change) {
      action = locale === 'zh'
        ? '先补充项目基线文档'
        : 'Fill in the project baseline documents first';
      command = 'openlogos change add-baseline-docs';
      detail = locale === 'zh'
        ? '建议先创建补文档提案，再开始业务迭代。'
        : 'Create a baseline-docs change proposal before starting feature work.';
    } else {
      action = data.suggestion;
      command = null;
      detail = data.current_phase
        ? t(locale, 'next.phaseDetail', { phase: data.current_phase })
        : '';
    }
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
