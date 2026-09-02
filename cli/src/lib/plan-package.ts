import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { evaluateProposalClarification } from './clarification.js';
import { authorityClosureSummary, evaluateAuthorityClosure, type AuthorityClosureStage } from './authority-closure.js';
import {
  extractTaskSectionItems, isCodeRequiredForProposal, isTasksCodeFilled,
  isTasksTemplateFilled, parseTaskSections, resolveProposalDeploymentDecision, countMergeableDeltaFiles,
} from './proposal-lifecycle.js';
import {
  PLAN_PACKAGE_CONTRACT_VERSION, PLAN_PACKAGE_SCHEMA, evaluateProposalStructure,
  sortCompletionIssues, type CompletionIssue, type PlanPackageEvaluation,
} from './plan-package-contract.js';

function projectRelative(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, '/');
}

function taskIssue(code: CompletionIssue['code'], path: string, message: string, fixHint: string, extra: Partial<CompletionIssue> = {}): CompletionIssue {
  return { code, path, message, fix_hint: fixHint, ...extra };
}

/**
 * @param stage 校验阶段（架构 §四十一.1）。`next` / `status` 的 proposal_step 派生传 'plan'；
 *              change-lint 全量门与 merge preflight 传 'spec'（默认，fail-closed）。
 */
export function evaluatePlanPackage(root: string, proposalDir: string, locale?: 'zh' | 'en', stage: AuthorityClosureStage = 'spec'): PlanPackageEvaluation {
  const proposalPath = join(proposalDir, 'proposal.md');
  const tasksPath = join(proposalDir, 'tasks.md');
  const historical = ['PLAN_APPROVED', 'SPEC_MERGED', 'MERGED', 'VERIFY_PASS']
    .some(marker => existsSync(join(proposalDir, marker)));
  const proposalContent = existsSync(proposalPath) ? readFileSync(proposalPath, 'utf8') : historical ? '' : readFileSync(proposalPath, 'utf8');
  const tasksContent = existsSync(tasksPath) ? readFileSync(tasksPath, 'utf8') : historical ? '' : readFileSync(tasksPath, 'utf8');
  const proposalRel = projectRelative(root, proposalPath);
  const tasksRel = projectRelative(root, tasksPath);
  const proposalIssues = historical ? [] : evaluateProposalStructure(proposalContent, proposalRel, locale);
  const deployment = resolveProposalDeploymentDecision(proposalDir);
  const clarification = evaluateProposalClarification(proposalContent, deployment.deployment_required);
  if (!historical && (!clarification.valid || clarification.output.status !== 'complete')) {
    proposalIssues.push(taskIssue('proposal_clarification_invalid', proposalRel, `决策澄清契约非法：${clarification.issues.join('；')}`, '按 openlogos/clarification@1 补齐并完成决策澄清。', { section_id: 'clarification', expected: 'openlogos/clarification@1 status=complete' }));
  }
  const authorityClosure = evaluateAuthorityClosure(root, proposalDir, proposalContent, stage);
  if (authorityClosure) {
    for (const authorityIssue of authorityClosure.issues) {
      proposalIssues.push(taskIssue(authorityIssue.code, authorityIssue.path, authorityIssue.message,
        authorityIssue.fix_hint, { section_id: 'authority_impact' }));
    }
  }
  const sections = parseTaskSections(tasksContent);
  const codeRequired = isCodeRequiredForProposal(proposalDir, tasksContent, sections);
  const specComplete = existsSync(join(proposalDir, 'SPEC_MERGED')) || existsSync(join(proposalDir, 'MERGED'));
  const taskIssues: CompletionIssue[] = [];
  if (!historical && !isTasksTemplateFilled(tasksContent)) {
    taskIssues.push(taskIssue('tasks_template_remaining', tasksRel, 'tasks.md 仍含 plan scaffold 占位任务。', '用一文件一任务的真实 [delta]/[deploy] 计划替换模板行。', { section_id: 'delta', expected: '真实 plan 任务' }));
  }
  const hasCodeSection = sections !== null && Object.prototype.hasOwnProperty.call(sections, 'code');
  if (!historical && sections !== null && codeRequired && !hasCodeSection) {
    taskIssues.push(taskIssue('tasks_code_section_missing', tasksRel, '需代码的提案缺少 [code] 标题。', 'plan 阶段补空 `## [code]` 标题，merge 后由 slice-planner 填充。', { section_id: 'code', expected: '## [code]' }));
  }
  const codeItems = extractTaskSectionItems(tasksContent, 'code');
  const specWorkStarted = (sections?.delta?.checked ?? 0) > 0 || countMergeableDeltaFiles(proposalDir) > 0;
  if (!historical && !specComplete && !specWorkStarted && codeItems.length > 0) {
    taskIssues.push(taskIssue('tasks_code_entry_before_spec_complete', tasksRel, 'spec-complete 前 [code] 不得出现 checkbox 切片。', '删除 [code] 下的条目，仅保留空标题。', { section_id: 'code', actual: String(codeItems.length), expected: '0' }));
  }
  if (!historical && deployment.deployment_decision_conflict) {
    taskIssues.push(taskIssue('tasks_deployment_conflict', tasksRel, deployment.deployment_decision_conflict_reason ?? '部署决策冲突。', '使 proposal 部署声明与 tasks.md [deploy] 是否在场一致。', { section_id: 'deploy', expected: deployment.deployment_required ? '非空 [deploy]' : '无 [deploy]' }));
  }
  const proposalSorted = sortCompletionIssues(proposalIssues);
  const taskSorted = sortCompletionIssues(taskIssues);
  const issues = sortCompletionIssues([...proposalSorted, ...taskSorted]);
  return {
    schema: PLAN_PACKAGE_SCHEMA,
    contract_version: PLAN_PACKAGE_CONTRACT_VERSION,
    ready: proposalSorted.length === 0 && taskSorted.length === 0,
    proposal: { filled: proposalSorted.length === 0, issues: proposalSorted },
    tasks: {
      plan_filled: taskSorted.length === 0,
      code_required: codeRequired,
      code_slices_filled: isTasksCodeFilled(tasksContent),
      issues: taskSorted,
    },
    issues,
    ...(authorityClosure ? { authority_closure: authorityClosureSummary(authorityClosure) } : {}),
  };
}
