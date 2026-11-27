/**
 * 提案通道的人工验收状态（smoke-manual-acceptance，spec/environments.md §15.7、§15.8；功能规格 §2.107.7、§2.107.8）。
 *
 * 只读账本（不读 git）：以活跃提案 DEPLOY_DONE 的环境 E 与 deploy_id D 为准，派生
 * - waiting：D 最近一条 smoke 记录为 pending 时的剩余清单（next / status 的 awaiting-manual-acceptance）；
 * - archive 核对：E 开启人工验收（D 零条 manual 记录也核对）或 D 有 manual 记录时，D 自己的最近 smoke 记录须为 pass
 *   （开启时还须 manual_passed=true）且其后没有 D 的 manual 记录。
 * 未开启人工验收、D 没有 manual 记录的提案：applicable=false，既有判据逐字不变。
 */
import { join } from 'node:path';
import { loadEnvironmentRegistry, readDeploymentLedger, waitingStateOf } from './environments.js';
import { readDeployDoneMarker } from './lifecycle-gate.js';

export interface ProposalManualState {
  environment: string;
  deploy_id: string;
  enabled: boolean;
  /** archive 账本核对是否适用。 */
  applicable: boolean;
  /** D 自己的最近有效结论是否为（未过期的）通过。 */
  passValid: boolean;
  waiting: { deploy_id: string; remaining: string[] } | null;
}

export function readProposalManualState(root: string, slug: string): ProposalManualState | null {
  const read = readDeployDoneMarker(join(root, 'logos', 'changes', slug));
  if (read.kind !== 'valid') return null;
  const environment = read.marker.environment;
  const deployId = read.marker.deploy_id;
  if (typeof environment !== 'string' || environment === '' || typeof deployId !== 'string' || deployId === '') return null;
  const reg = loadEnvironmentRegistry(root);
  const env = reg.state === 'loaded' ? reg.environments.find(e => e.id === environment) : undefined;
  const enabled = env?.manualAcceptance?.enabled === true;
  const state = readDeploymentLedger(root).byEnvironment.get(environment);
  const manual = state?.manualByDeploy.get(deployId) ?? [];
  const last = state?.lastSmokeByDeploy.get(deployId);
  const manualAfter = (seq: number) => manual.filter(m => m.seq > seq);
  const passValid = Boolean(last && last.record.result === 'pass' && (!enabled || last.record.manual_passed === true)
    && manualAfter(last.seq).length === 0);
  // 评审 code-r1 F4：等待态复用环境视图的 waitingStateOf（当前部署 = 最近一条 deploy 记录），只在它与提案 DEPLOY_DONE
  // 的部署一致时派生；部署已被更替（如经版本通道部署了 D2）时旧 pending 失效，不再提示为 D1 记录，也不替提案验收 D2
  const envWaiting = waitingStateOf(state);
  const waiting: ProposalManualState['waiting'] = envWaiting && envWaiting.deploy_id === deployId ? envWaiting : null;
  return { environment, deploy_id: deployId, enabled, applicable: enabled || manual.length > 0, passValid, waiting };
}
