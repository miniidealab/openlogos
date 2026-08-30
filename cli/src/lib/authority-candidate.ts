import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { type AssetManifest, validateAssetManifest } from './asset-manifest.js';

export const AUTHORITY_ROLE_SKILLS = [
  'architecture-designer', 'change-writer', 'scenario-architect',
  'deployment-designer', 'test-writer', 'code-reviewer',
] as const;

export function authorityCandidateAssetPaths(): string[] {
  return [
    'spec/authority-closure.md',
    'dist/lib/authority-closure.js',
    ...AUTHORITY_ROLE_SKILLS.map(skill => `skills/${skill}/SKILL.md`),
    ...AUTHORITY_ROLE_SKILLS.map(skill => `claude-plugin-template/skills/${skill}/SKILL.md`),
  ];
}

export interface AuthorityAssetFailure { path: string; reason: string }

/** candidate 包的 spec/六 Skill/plugin 投影均由 manifest 裁决；不接受同 semver 的字节漂移。 */
export function validateAuthorityCandidateAssets(manifest: AssetManifest, packageRoot: string): AuthorityAssetFailure[] {
  const failures: AuthorityAssetFailure[] = [];
  try { validateAssetManifest(manifest, packageRoot); }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const match = /asset hash 不匹配：([^ ]+)/.exec(reason);
    failures.push({ path: match?.[1] ?? 'asset-manifest.json', reason });
  }
  const declared = new Set([...manifest.skills, ...manifest.templates, ...manifest.schemas, ...manifest.plugins].map(row => row.path));
  for (const path of authorityCandidateAssetPaths()) {
    if (!declared.has(path)) failures.push({ path, reason: 'required authority asset 未进入 manifest' });
  }
  return failures.sort((a, b) => a.path.localeCompare(b.path));
}

export function authorityAssetHash(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

export const AUTHORITY_CUTOVER_ORDER = [
  'freeze_identity', 'old_writer_stop', 'new_writer_start', 'projection_rebuild', 'freshness_probe',
  'old_writer_rejected', 'exit_evidence',
] as const;
export type AuthorityCutoverEvent = typeof AUTHORITY_CUTOVER_ORDER[number];

export interface AuthorityCutoverCheck {
  pass: boolean;
  missing: AuthorityCutoverEvent[];
  out_of_order: boolean;
  old_writer_rejected: boolean;
}

/** 有限 writer cutover 的事件状态机；旧入口仍成功即 fail closed。 */
export function validateAuthorityCutover(events: Array<{ event: AuthorityCutoverEvent; success: boolean }>): AuthorityCutoverCheck {
  const successful = events.filter(row => row.success).map(row => row.event);
  const missing = AUTHORITY_CUTOVER_ORDER.filter(event => !successful.includes(event));
  let cursor = -1; let outOfOrder = false;
  for (const event of successful) {
    const index = AUTHORITY_CUTOVER_ORDER.indexOf(event);
    if (index <= cursor) outOfOrder = true;
    cursor = Math.max(cursor, index);
  }
  const oldWriterRejected = successful.includes('old_writer_rejected');
  return { pass: missing.length === 0 && !outOfOrder && oldWriterRejected, missing, out_of_order: outOfOrder, old_writer_rejected: oldWriterRejected };
}

export interface InstalledIdentity {
  version: string;
  entry_realpath: string;
  tarball_sha256: string;
  asset_payload_hash: string;
}

export interface RollbackTransition {
  candidate_before: InstalledIdentity;
  frozen_rollback: InstalledIdentity;
  rollback_actual: InstalledIdentity;
  candidate_after: InstalledIdentity;
}

function sameIdentity(left: InstalledIdentity, right: InstalledIdentity): boolean {
  return left.version === right.version && left.entry_realpath === right.entry_realpath
    && left.tarball_sha256 === right.tarball_sha256 && left.asset_payload_hash === right.asset_payload_hash;
}

/** candidate→冻结旧版→candidate 往返身份；最终 candidate 必须字节等价且可幂等重装。 */
export function validateAuthorityRollback(transition: RollbackTransition): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  if (!sameIdentity(transition.frozen_rollback, transition.rollback_actual)) failures.push('rollback_identity_mismatch');
  if (!sameIdentity(transition.candidate_before, transition.candidate_after)) failures.push('candidate_reinstall_not_idempotent');
  if (sameIdentity(transition.candidate_before, transition.rollback_actual)) failures.push('mixed_candidate_and_rollback_identity');
  return { pass: failures.length === 0, failures };
}

/** smoke 证据可选地对入口做 realpath 核验，防止 PATH/global fallback。 */
export async function resolveInstalledEntry(path: string): Promise<string> {
  return realpath(path);
}
