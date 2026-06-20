import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t, type Locale } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { readProjectYaml } from '../lib/project-yaml.js';
import { detectProposalStepViaFlow } from '../lib/flow-derive.js';
import {
  parseTaskSections,
  resolveProposalDeploymentDecision,
  type ModuleInfo,
} from './status.js';

const DEPLOYMENT_REPORT_PATH = 'logos/resources/verify/deployment-report.md';

export interface ActiveProposalGuard {
  slug: string;
  proposalDir: string;
  moduleId: string | null;
}

export interface DeployDoneData {
  slug: string;
  environment: string | null;
  marker_path: string;
  deployment_report_path: string;
  deploy_tasks_checked: number;
  deploy_tasks_total: number;
  cleared_smoke_markers: string[];
  next_step: 'ready-to-smoke' | 'deploy-done';
}

interface SectionCheckResult {
  content: string;
  checked: number;
  total: number;
}

export function readActiveProposalGuard(root: string): ActiveProposalGuard | null {
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (!existsSync(guardPath)) return null;

  try {
    const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
    const slug = typeof guard.activeChange === 'string' ? guard.activeChange.trim() : '';
    if (!slug) return null;
    return {
      slug,
      proposalDir: join(root, 'logos', 'changes', slug),
      moduleId: typeof guard.module === 'string' && guard.module.trim() ? guard.module.trim() : null,
    };
  } catch {
    return null;
  }
}

export function checkTaskSection(content: string, tag: string): SectionCheckResult {
  const lines = content.split(/\r?\n/);
  const sectionPattern = /^## \[([a-z][a-z0-9-]*)\]/i;
  let inSection = false;
  let total = 0;

  const checkedLines = lines.map(line => {
    const sectionMatch = line.match(sectionPattern);
    if (sectionMatch) {
      inSection = sectionMatch[1].toLowerCase() === tag.toLowerCase();
      return line;
    }

    if (!inSection) return line;
    if (/^- \[[ x]\]/i.test(line)) {
      total += 1;
      return line.replace(/^- \[[ x]\]/i, '- [x]');
    }
    return line;
  });

  return {
    content: checkedLines.join('\n'),
    checked: total,
    total,
  };
}

function resolveModuleDefaults(root: string, moduleId: string | null): Pick<ModuleInfo, 'deployment_required' | 'smoke_required'> {
  const project = readProjectYaml(root).data;
  const modules = project?.modules ?? [];
  const selectedModule = moduleId
    ? modules.find(mod => mod.id === moduleId)
    : modules.length === 1 ? modules[0] : undefined;
  const gates = selectedModule ? project?.deployment_gates?.[selectedModule.id] : undefined;

  return {
    deployment_required: typeof gates?.deployment_required === 'boolean'
      ? gates.deployment_required
      : selectedModule?.deployment_required,
    smoke_required: typeof gates?.smoke_required === 'boolean'
      ? gates.smoke_required
      : selectedModule?.smoke_required,
  };
}

function fail(format: OutputFormat, locale: Locale, code: string, messageKey: string, vars?: Record<string, string>): never {
  const message = t(locale, messageKey, vars);
  if (format === 'json') {
    console.error(JSON.stringify(makeErrorEnvelope('deploy-done', code, message)));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

function readDeploySummary(proposalDir: string): { checked: number; total: number } | null {
  const tasksPath = join(proposalDir, 'tasks.md');
  if (!existsSync(tasksPath)) return null;
  const sections = parseTaskSections(readFileSync(tasksPath, 'utf-8'));
  return sections?.deploy ?? null;
}

function clearSmokeMarkers(proposalDir: string): string[] {
  const cleared: string[] = [];
  for (const marker of ['SMOKE_PASS', 'SMOKE_FAIL']) {
    const markerPath = join(proposalDir, marker);
    if (existsSync(markerPath)) {
      rmSync(markerPath, { force: true });
      cleared.push(marker);
    }
  }
  return cleared;
}

function normalizeNextStep(step: string): DeployDoneData['next_step'] {
  return step === 'ready-to-smoke' ? 'ready-to-smoke' : 'deploy-done';
}

export function deployDone(format: OutputFormat = 'text', environment?: string) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');
  const locale = readLocale(root);

  if (!existsSync(configPath)) {
    fail(format, locale, 'PROJECT_NOT_INITIALIZED', 'deployDone.error.projectNotInitialized');
  }

  const active = readActiveProposalGuard(root);
  if (!active) {
    fail(format, locale, 'NO_ACTIVE_CHANGE', 'deployDone.error.noActiveChange');
  }

  if (!existsSync(active.proposalDir)) {
    fail(format, locale, 'CHANGE_NOT_FOUND', 'deployDone.error.changeNotFound', { slug: active.slug });
  }

  if (!existsSync(join(active.proposalDir, 'VERIFY_PASS')) || existsSync(join(active.proposalDir, 'VERIFY_FAIL'))) {
    fail(format, locale, 'VERIFY_NOT_PASSED', 'deployDone.error.verifyNotPassed');
  }

  const moduleDefaults = resolveModuleDefaults(root, active.moduleId);
  const deploymentDecision = resolveProposalDeploymentDecision(active.proposalDir, moduleDefaults);
  if (deploymentDecision.deployment_decision_conflict) {
    fail(format, locale, 'DEPLOYMENT_DECISION_CONFLICT', 'deployDone.error.decisionConflict', {
      reason: deploymentDecision.deployment_decision_conflict_reason ?? '',
    });
  }

  if (deploymentDecision.deployment_required !== true) {
    fail(format, locale, 'DEPLOYMENT_NOT_REQUIRED', 'deployDone.error.notRequired');
  }

  const deploySummary = readDeploySummary(active.proposalDir);
  if (!deploySummary || deploySummary.total === 0) {
    fail(format, locale, 'DEPLOY_TASKS_MISSING', 'deployDone.error.deployTasksMissing');
  }

  const deploymentReportFullPath = join(root, DEPLOYMENT_REPORT_PATH);
  if (!existsSync(deploymentReportFullPath)) {
    fail(format, locale, 'DEPLOYMENT_REPORT_MISSING', 'deployDone.error.deploymentReportMissing', {
      path: DEPLOYMENT_REPORT_PATH,
    });
  }

  const tasksPath = join(active.proposalDir, 'tasks.md');
  const checkedTasks = checkTaskSection(readFileSync(tasksPath, 'utf-8'), 'deploy');
  writeFileSync(tasksPath, checkedTasks.content);

  const markerRelativePath = `logos/changes/${active.slug}/DEPLOY_DONE`;
  writeFileSync(join(root, markerRelativePath), '');
  const clearedSmokeMarkers = clearSmokeMarkers(active.proposalDir);
  const nextStep = normalizeNextStep(detectProposalStepViaFlow(active.proposalDir, moduleDefaults));

  const data: DeployDoneData = {
    slug: active.slug,
    environment: environment ?? null,
    marker_path: markerRelativePath,
    deployment_report_path: DEPLOYMENT_REPORT_PATH,
    deploy_tasks_checked: checkedTasks.checked,
    deploy_tasks_total: checkedTasks.total,
    cleared_smoke_markers: clearedSmokeMarkers,
    next_step: nextStep,
  };

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('deploy-done', data)));
    return;
  }

  console.log(`\n${t(locale, 'deployDone.title')}\n`);
  console.log(`  ${t(locale, 'deployDone.proposal', { slug: data.slug })}`);
  if (data.environment) console.log(`  ${t(locale, 'deployDone.environment', { environment: data.environment })}`);
  console.log(`  ${t(locale, 'deployDone.marker', { path: data.marker_path })}`);
  console.log(`  ${t(locale, 'deployDone.deployTasks', {
    checked: String(data.deploy_tasks_checked),
    total: String(data.deploy_tasks_total),
  })}`);
  console.log(`  ${t(locale, 'deployDone.clearedSmokeMarkers', {
    markers: data.cleared_smoke_markers.length > 0 ? data.cleared_smoke_markers.join(', ') : '-',
  })}`);
  const nextCommand = data.next_step === 'ready-to-smoke'
    ? `openlogos smoke${data.environment ? ` --env ${data.environment}` : ''}`
    : `openlogos archive ${data.slug}`;
  console.log(`\n${t(locale, data.next_step === 'ready-to-smoke' ? 'deployDone.nextSmoke' : 'deployDone.nextArchive', {
    command: nextCommand,
  })}\n`);
}
