const EXPECTED_SCHEMA = 'runlogos/openlogos-candidate-e2e@1';
const EXPECTED_VERSION = '0.14.0';
const EXPECTED_SCENARIOS = Object.freeze(['create', 'modify', 'mixed', 'response-lost']);

export function validateRunLogosCandidateEvidence(evidence) {
  if (!evidence || evidence.schema !== EXPECTED_SCHEMA || evidence.passed !== true) {
    throw new Error('RunLogos evidence schema 或通过状态无效');
  }
  if (evidence.candidate?.version !== EXPECTED_VERSION) {
    throw new Error(`RunLogos candidate 版本不是 ${EXPECTED_VERSION}`);
  }
  const scenarios = Array.isArray(evidence.scenarios) ? evidence.scenarios : [];
  if (JSON.stringify(scenarios.map(item => item?.scenario)) !== JSON.stringify(EXPECTED_SCENARIOS)) {
    throw new Error('RunLogos evidence 未完整覆盖 CREATE/MODIFY/mixed/response-lost');
  }
  if (scenarios.some(item => item.phase !== 'completed' || item.apply_count !== 1)) {
    throw new Error('RunLogos evidence 未证明每个场景恰好一次 apply 并完成事务');
  }
  if (scenarios.find(item => item.scenario === 'response-lost')?.response_lost_injected !== true) {
    throw new Error('RunLogos evidence 未证明 response-lost 恢复');
  }
  if (evidence.used_source_checkout === true || evidence.used_mock === true || evidence.precreated_completed === true) {
    throw new Error('RunLogos evidence 命中源码、mock 或预造 completed 禁止项');
  }
  return evidence;
}
