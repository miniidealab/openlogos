import { basename, isAbsolute, relative } from 'node:path';

export const LOCAL_RELEASE_CANDIDATE_SCHEMA = 'openlogos/local-release-candidate@1' as const;
export const LOCAL_RELEASE_PACKAGE_NAME = '@miniidealab/openlogos' as const;
export const LOCAL_RELEASE_CANDIDATE_VERSION = '0.14.6' as const;
export const LOCAL_RELEASE_ROLLBACK_VERSION = '0.14.5' as const;

export const LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS = [
  'claude-plugin-template/.claude-plugin/plugin.json',
  'codex-plugin-template/plugin.json',
  'zcode-plugin-template/.zcode-plugin/plugin.json',
  'qoder-plugin-template/.qoder-plugin/plugin.json',
  'workbuddy-plugin-template/.workbuddy-plugin/plugin.json',
] as const;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface LocalReleaseCandidateIdentity {
  schema: typeof LOCAL_RELEASE_CANDIDATE_SCHEMA;
  package_name: typeof LOCAL_RELEASE_PACKAGE_NAME;
  package_version: typeof LOCAL_RELEASE_CANDIDATE_VERSION;
  plugin_versions: Record<(typeof LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS)[number], string>;
  asset_manifest_version: typeof LOCAL_RELEASE_CANDIDATE_VERSION;
  tarball_sha256: string;
  command_path: string;
  package_root: string;
}

export interface LocalReleaseCommand {
  command: string;
  args: readonly string[];
}

const IDENTITY_KEYS = [
  'schema', 'package_name', 'package_version', 'plugin_versions',
  'asset_manifest_version', 'tarball_sha256', 'command_path', 'package_root',
] as const;

function exactKeys(actual: readonly string[], expected: readonly string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 冻结本地候选的最小公开身份；五类插件、asset 与 package 必须同源。 */
export function freezeLocalReleaseCandidateIdentity(input: LocalReleaseCandidateIdentity): LocalReleaseCandidateIdentity {
  if (!exactKeys(Object.keys(input), IDENTITY_KEYS)) throw new Error('local_candidate_invalid:fields');
  if (input.schema !== LOCAL_RELEASE_CANDIDATE_SCHEMA) throw new Error('local_candidate_invalid:schema');
  if (input.package_name !== LOCAL_RELEASE_PACKAGE_NAME) throw new Error('local_candidate_invalid:package_name');
  if (input.package_version !== LOCAL_RELEASE_CANDIDATE_VERSION) throw new Error('local_candidate_invalid:package_version');
  if (input.asset_manifest_version !== LOCAL_RELEASE_CANDIDATE_VERSION) throw new Error('local_candidate_invalid:asset_manifest_version');
  if (!SHA256_PATTERN.test(input.tarball_sha256)) throw new Error('local_candidate_invalid:tarball_sha256');
  if (!isAbsolute(input.command_path)) throw new Error('local_candidate_invalid:command_path');
  if (!isAbsolute(input.package_root)) throw new Error('local_candidate_invalid:package_root');
  if (!contained(input.package_root, input.command_path)) throw new Error('local_candidate_invalid:command_outside_package');
  if (!exactKeys(Object.keys(input.plugin_versions), LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS)) {
    throw new Error('local_candidate_invalid:plugin_fields');
  }
  for (const path of LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS) {
    if (input.plugin_versions[path] !== LOCAL_RELEASE_CANDIDATE_VERSION) {
      throw new Error(`local_candidate_invalid:plugin_version:${path}`);
    }
  }
  return Object.freeze({ ...input, plugin_versions: Object.freeze({ ...input.plugin_versions }) });
}

/** 本地候选调用图不得包含任何公开发布或远程写动作。 */
export function assertLocalReleaseCommandGraph(commands: readonly LocalReleaseCommand[]): void {
  const forbidden: Array<[string, RegExp]> = [
    ['npm_publish', /^npm(?:\.cmd)?\s+publish\b/i],
    ['npm_dist_tag', /^npm(?:\.cmd)?\s+dist-tag\b/i],
    ['git_tag', /^git\s+tag\b/i],
    ['git_push', /^git\s+push\b/i],
    ['github_release', /^gh\s+release\b/i],
    ['cloudflare_deploy', /^(?:npx\s+)?wrangler\s+pages\s+deploy\b/i],
    ['website_deploy', /^npm(?:\.cmd)?\s+(?:run\s+)?deploy\b/i],
  ];
  for (const item of commands) {
    const line = [basename(item.command), ...item.args].join(' ').trim();
    const match = forbidden.find(([, pattern]) => pattern.test(line));
    if (match) throw new Error(`local_candidate_public_release_forbidden:${match[0]}`);
  }
}

/** 生成只引用固定 0.14.2 tarball 的可复制回滚与版本复核命令。 */
export function buildLocalReleaseRollbackPlan(
  prefix: string,
  rollbackTarball: string,
  installedEntry: string,
): LocalReleaseCommand[] {
  if (!isAbsolute(prefix)) throw new Error('local_candidate_rollback_invalid:prefix');
  if (!isAbsolute(rollbackTarball)) throw new Error('local_candidate_rollback_invalid:tarball');
  if (!isAbsolute(installedEntry) || !contained(prefix, installedEntry)) {
    throw new Error('local_candidate_rollback_invalid:entry');
  }
  const commands: LocalReleaseCommand[] = [
    { command: 'npm', args: ['uninstall', '--prefix', prefix, '--ignore-scripts', LOCAL_RELEASE_PACKAGE_NAME] },
    {
      command: 'npm',
      args: ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', rollbackTarball],
    },
    { command: installedEntry, args: ['--version'] },
  ];
  assertLocalReleaseCommandGraph(commands);
  return commands;
}
