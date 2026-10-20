/**
 * smoke-scope-isolated-modules code-r1 F1：安装态 smoke（SMOKE-core-297）的行为比较基线必须绑定到验收要求的旧版制品
 * （local-release-candidate.ts 的回滚版本常量），不能随修复后的重部署漂移为最近一次回滚制品（修复前的新版）。
 *
 * 被测：scripts/lib/local-install-baseline.mjs（runner scripts/smoke-smoke-scope-isolated-modules-0-16-11.js 的基线选择）。
 * 用真实 npm pack 形态的 tarball（package/package.json）构造本机留存目录，不安装、不部署。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// @ts-expect-error 纯 JS 模块（scripts/lib），无类型声明
import { LOCAL_INSTALL_REL, rollbackVersionConst, selectBaselineArtifact, tarballVersion } from '../../scripts/lib/local-install-baseline.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-ssim-baseline-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, LOCAL_INSTALL_REL, 'rollback'), { recursive: true });
  mkdirSync(join(root, LOCAL_INSTALL_REL, 'candidates'), { recursive: true });
  return root;
}

/** 写一个 npm pack 形态的 tarball（package/package.json 的 version 为给定值）。 */
function tarball(root: string, rel: string, version: string): string {
  const stage = mkdtempSync(join(tmpdir(), 'openlogos-ssim-pkg-'));
  cleanups.push(() => rmSync(stage, { recursive: true, force: true }));
  mkdirSync(join(stage, 'package'));
  writeFileSync(join(stage, 'package/package.json'), JSON.stringify({ name: '@miniidealab/openlogos', version }));
  const out = join(root, LOCAL_INSTALL_REL, rel);
  const r = spawnSync('tar', ['-czf', out, '-C', stage, 'package']);
  expect(r.status).toBe(0);
  return out;
}

function receipt(root: string, previousVersion: string, rollbackPath: string): void {
  writeFileSync(join(root, LOCAL_INSTALL_REL, 'last-deploy.json'), JSON.stringify({
    previous_version: previousVersion, rollback_artifact: { path: rollbackPath, sha256: 'x' },
  }));
}

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('SMOKE-core-297 基线绑定（smoke-scope-isolated-modules code-r1 F1）', () => {
  it('基线版本取 local-release-candidate.ts 的回滚版本常量；tarball 版本可读', () => {
    // 关系式：回滚版本常量为合法版本号且不等于当前候选版本（升版脚本把它设为升版前版本）
    const rollback = rollbackVersionConst(REPO);
    expect(rollback).toMatch(/^\d+\.\d+\.\d+$/);
    expect(rollback).not.toBe(JSON.parse(readFileSync(join(REPO, 'cli/package.json'), 'utf-8')).version);
    const root = repo();
    expect(tarballVersion(tarball(root, 'rollback/a.tgz', '0.16.10'))).toBe('0.16.10');
  });

  it('首次部署：最近回滚制品即 0.16.10，被选为基线', () => {
    const root = repo();
    const a = tarball(root, 'rollback/a-first.tgz', '0.16.10');
    tarball(root, 'candidates/a-first.tgz', '0.16.11');
    receipt(root, '0.16.10', a);
    expect(selectBaselineArtifact(root, '0.16.10')).toEqual({ path: a, version: '0.16.10', sha256: sha(a) });
  });

  it('修复后再部署：最近回滚制品已是修复前的 0.16.11，仍选首次部署留存的 0.16.10', () => {
    const root = repo();
    const first = tarball(root, 'rollback/a-first.tgz', '0.16.10');
    tarball(root, 'candidates/a-first.tgz', '0.16.11');
    const second = tarball(root, 'rollback/b-second.tgz', '0.16.11');
    tarball(root, 'candidates/b-second.tgz', '0.16.11');
    receipt(root, '0.16.11', second);
    const picked = selectBaselineArtifact(root, '0.16.10');
    expect(picked).toEqual({ path: first, version: '0.16.10', sha256: sha(first) });
    expect(picked.path).not.toBe(second);
  });

  it('回滚目录没有 0.16.10 时退回候选目录中 0.16.10 的制品（上一版部署的候选包）', () => {
    const root = repo();
    const prevCandidate = tarball(root, 'candidates/0-prev.tgz', '0.16.10');
    const second = tarball(root, 'rollback/b-second.tgz', '0.16.11');
    receipt(root, '0.16.11', second);
    expect(selectBaselineArtifact(root, '0.16.10')).toEqual({ path: prevCandidate, version: '0.16.10', sha256: sha(prevCandidate) });
  });

  it('留存制品中没有基线版本时返回缺失项（runner 写显式 skip），不退化为最近回滚制品', () => {
    const root = repo();
    const second = tarball(root, 'rollback/b-second.tgz', '0.16.11');
    receipt(root, '0.16.11', second);
    expect(selectBaselineArtifact(root, '0.16.10')).toMatchObject({ missing: ['baseline-artifact'] });
    expect(selectBaselineArtifact(root, null)).toMatchObject({ missing: ['baseline-version'] });
  });
});
