import { createHash } from 'node:crypto';

const EXPECTED_SCHEMA = 'runlogos/openlogos-candidate-e2e@1';
const EXPECTED_VERSION = '0.14.1';
const EXPECTED_SCENARIOS = Object.freeze(['create', 'modify', 'mixed', 'response-lost']);

const sha256 = value => createHash('sha256').update(value).digest('hex');

export function validateRunLogosCandidateEvidence(evidence, candidate = {}) {
  if (!evidence || evidence.schema !== EXPECTED_SCHEMA || evidence.passed !== true) {
    throw new Error('RunLogos evidence schema 或通过状态无效');
  }
  if (evidence.candidate?.version !== EXPECTED_VERSION) {
    throw new Error(`RunLogos candidate 版本不是 ${EXPECTED_VERSION}`);
  }
  if (candidate.commandPath && candidate.tarballSha256) {
    const expectedIdentity = sha256(`${candidate.commandPath}:${candidate.tarballSha256}`).slice(0, 16);
    if (evidence.candidate?.identity_hash !== expectedIdentity) {
      throw new Error('RunLogos candidate identity 与冻结入口/制品不一致');
    }
  }
  const scenarios = Array.isArray(evidence.scenarios) ? evidence.scenarios : [];
  if (JSON.stringify(scenarios.map(item => item?.scenario)) !== JSON.stringify(EXPECTED_SCENARIOS)) {
    throw new Error('RunLogos evidence 未完整覆盖 CREATE/MODIFY/mixed/response-lost');
  }
  if (scenarios.some(item => item.phase !== 'completed' || item.apply_count !== 1
    || !Number.isInteger(item.final_path_count) || item.final_path_count < 1
    || !Number.isInteger(item.artifact_path_count) || item.artifact_path_count < 1
    || item.commit_path_count !== item.final_path_count + item.artifact_path_count)) {
    throw new Error('RunLogos evidence 未证明 completed receipt 路径闭包与恰好一次 apply');
  }
  if (scenarios.find(item => item.scenario === 'response-lost')?.response_lost_injected !== true) {
    throw new Error('RunLogos evidence 未证明 response-lost 恢复');
  }
  if (evidence.used_source_checkout === true || evidence.used_mock === true || evidence.precreated_completed === true
    || evidence.read_private_transaction === true || evidence.derived_commit_paths === true) {
    throw new Error('RunLogos evidence 命中源码、mock、预造 completed 或私有事务旁路禁止项');
  }
  return evidence;
}
