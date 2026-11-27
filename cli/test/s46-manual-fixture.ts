/**
 * smoke-manual-acceptance 切片 3 共用夹具：基于 S1 夹具（buildEnvProject）构造开启人工验收的 prod 环境、人工用例与部署，
 * 并提供真实 CLI / 进程内两种执行器。本模块不得 import vitest。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildEnvProject, git, runCli, LEDGER_REL, SLUG } from './s19-module-env-fixtures.js';

export { LEDGER_REL, SLUG, runCli, git };
export const PROPOSAL_DIR = (root: string) => join(root, 'logos/changes', SLUG);
export const S01_SPEC = 'logos/resources/test/core-S01-test-cases.md';
export const SMOKE_SPEC = 'logos/resources/test/smoke/core-smoke-test-cases.md';
export const ST05 = '| ST-S01-05 [manual] | 人工观察终端渲染 | 真实终端 | 打开交互提示 | 颜色正确 |';
export const ST08 = '| ST-S01-08 [manual] | 人工确认首启 | 实机 | 安装 | 首启正常 |';

export function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

export interface ManualProjectOptions {
  /** 有活跃提案（提案通道，缺省 true）；false 时删除 guard（版本通道）。 */
  proposal?: boolean;
  /** prod 的 manual_acceptance 内容（缺省 `{enabled: true}`）；null 表示 prod 不写该字段。 */
  prodManual?: string | null;
  /** 测试规格中的人工 UT/ST 行（缺省 [ST05]）。 */
  manualRows?: string[];
  /** smoke 规格追加的人工 SMOKE 行 ID（缺省 ['SMOKE-core-901']）。 */
  manualSmoke?: string[];
  /** 只保留人工用例：smoke 规格不含任何自动用例、不配置 runner（全人工项目）。 */
  manualOnly?: boolean;
}

/** 构造夹具并提交，返回项目根；cleanup 由调用方登记。 */
export function manualProject(cleanups: Array<() => void>, opts: ManualProjectOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ol-s46-ma-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  buildEnvProject(root, 'S1');
  const prodManual = opts.prodManual === undefined ? '{enabled: true}' : opts.prodManual;
  if (prodManual !== null) {
    const yaml = readFileSync(join(root, 'logos/environments.yaml'), 'utf-8')
      .replace('  - {id: prod, name: Production, tier: prod, aliases: [生产]}', `  - {id: prod, name: Production, tier: prod, aliases: [生产], manual_acceptance: ${prodManual}}`);
    writeFileSync(join(root, 'logos/environments.yaml'), yaml);
  }
  const manualRows = opts.manualRows ?? [ST05];
  if (manualRows.length > 0) {
    put(root, S01_SPEC, `# core-S01\n\n| ID | 描述 | 前置 | 操作 | 预期 |\n|---|---|---|---|---|\n${manualRows.join('\n')}\n`);
  }
  const manualSmoke = opts.manualSmoke ?? ['SMOKE-core-901'];
  if (opts.manualOnly) {
    rmSync(join(root, 'logos/resources/test/smoke/shared-smoke-test-cases.md'), { force: true });
    put(root, SMOKE_SPEC, `# Smoke\n\n| ID | 描述 |\n|---|---|\n${manualSmoke.map(id => `| ${id} [manual] | 实机确认 |`).join('\n')}\n`);
    const cfgPath = join(root, 'logos/logos.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    delete cfg.smoke.command;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    rmSync(join(root, 'scripts'), { recursive: true, force: true });
  } else if (manualSmoke.length > 0) {
    const smoke = readFileSync(join(root, SMOKE_SPEC), 'utf-8');
    writeFileSync(join(root, SMOKE_SPEC), smoke + manualSmoke.map(id => `| ${id} [manual] | 实机安装后确认首启界面 |`).join('\n') + '\n');
  }
  if (opts.proposal === false) rmSync(join(root, 'logos/.openlogos-guard'), { force: true });
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'manual fixture', '--allow-empty']);
  return root;
}

export function head(root: string): string {
  return git(root, ['rev-parse', 'HEAD']);
}

export function envelope(text: string): any {
  const lines = text.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* not json */ }
  }
  return null;
}

export interface Run { status: number; out: any; err: any; stdout: string; stderr: string }

export function cli(root: string, args: string[]): Run {
  const r = runCli(root, args);
  return { status: r.status, out: envelope(r.stdout), err: envelope(r.stderr), stdout: r.stdout, stderr: r.stderr };
}

/** 提案通道部署：deploy-done --env，返回 deploy_id。 */
export function deployDone(root: string, env = 'prod'): string {
  const r = cli(root, ['deploy-done', '--env', env, '--ref', 'HEAD', '--format', 'json']);
  if (r.status !== 0) throw new Error(`deploy-done failed: ${r.stderr}`);
  const id = r.out?.data?.deployment?.deploy_id;
  if (r.out?.data?.deployment?.ledger_written !== true || typeof id !== 'string') throw new Error(`deploy-done no deploy id: ${r.stdout}`);
  // 评审 delta-r5 F5：提案通道夹具显式传 --ref HEAD，部署版本必须是已提交用例的版本
  const ref = r.out.data.deployment.ref;
  if (ref !== head(root) || r.out.data.deployment.ref_source !== 'explicit') throw new Error(`deploy-done ref mismatch: ${ref} vs ${head(root)}`);
  return id;
}

const meta = (env: string) => ({ environment: env, slug: null, recorded_at: new Date().toISOString(), observed_head: null, observed_dirty: null });

/** 版本通道部署：直接写一条带 channel 的 deploy 记录（夹具账本，不经部署脚本）。 */
export function ledgerDeploy(root: string, env: string, deployId: string, ref: string | null, result = 'done'): void {
  appendLedger(root, {
    kind: 'deploy', ...meta(env), deploy_id: deployId, ref, ref_source: ref === null ? 'unknown' : 'explicit', result,
    channel: 'version', mode: 'script', ref_requested: ref ?? 'f'.repeat(40),
  });
}

export function ledgerManual(root: string, env: string, deployId: string, caseId: string, result = 'pass', note: string | null = null): void {
  appendLedger(root, { kind: 'manual', ...meta(env), deploy_id: deployId, ref: null, case_id: caseId, result, note, evidence: [], recorder: null });
}

export function appendLedger(root: string, row: unknown): void {
  const path = join(root, LEDGER_REL);
  mkdirSync(dirname(path), { recursive: true });
  const prev = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  writeFileSync(path, prev + JSON.stringify(row) + '\n');
}

export function ledgerRows(root: string): any[] {
  const path = join(root, LEDGER_REL);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

export const smokeJson = (root: string, env = 'prod') => cli(root, ['smoke', '--env', env, '--format', 'json']);
export const acceptJson = (root: string, args: string[]) => cli(root, ['accept', '--env', 'prod', ...args, '--format', 'json']);
export const archiveRun = (root: string) => cli(root, ['archive', SLUG]);
export const nextJson = (root: string, auto = false) => cli(root, ['next', ...(auto ? ['--auto'] : []), '--format', 'json']);
export const markers = (root: string) => ['SMOKE_PASS', 'SMOKE_FAIL'].filter(m => existsSync(join(PROPOSAL_DIR(root), m)));
