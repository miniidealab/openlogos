import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { assertInstallation, checkRegistry, packageName, verifyWindowsRelease } from '../../scripts/windows-latest-release-gate.mjs';
import { distributeRelease, readBundle } from '../../scripts/release-publish-bundle.mjs';

const version = '0.16.23';
const tag = 'v' + version;
const commit = 'a'.repeat(40);
const target = { tag, commit, source: 'npmmirror' };
const expectedEntry = 'C:\\Temp\\npm\\openlogos.cmd';
const installed = { packageName, packageVersion: version, cmdVersion: version, entry: expectedEntry, expectedEntry };

function clockFixture() {
  let now = 0;
  return {
    now: () => now,
    wait: vi.fn(async ms => { now += ms; }),
    latest: vi.fn().mockResolvedValue(version),
    upgrade: vi.fn().mockResolvedValue(installed),
  };
}

describe('Windows 公网升级就绪门', () => {
  it('UT-S19-110: 传播等待有界并以安装结果裁决', async () => {
    const log = vi.fn();
    const delayed = clockFixture();
    delayed.latest.mockResolvedValueOnce('0.16.22');
    delayed.upgrade.mockImplementation((registry, within) => within('安装 @latest', 120_000, timeout => {
      expect(registry).toBe('https://registry.npmmirror.com/');
      expect(timeout).toBe(1_000);
      return installed;
    }));
    await expect(checkRegistry(target, delayed, log, 16_000)).resolves.toMatchObject({ result: 'pass', latest: version });
    expect(delayed.latest).toHaveBeenCalledTimes(2);
    expect(delayed.upgrade).toHaveBeenCalledOnce();

    for (const failure of ['旧版', '超时', '安装失败']) {
      const ops = clockFixture();
      if (failure === '旧版') ops.latest.mockResolvedValue('0.16.22');
      if (failure === '超时') ops.latest.mockRejectedValue(Object.assign(new Error('网络探测超时'), { retryable: true }));
      if (failure === '安装失败') {
        ops.upgrade.mockImplementation((_, within) => within('安装 @latest', 120_000, () => {
          throw new Error('安装失败');
        }));
      }
      await expect(checkRegistry(target, ops, log, 16_000)).rejects.toThrow();
      const evidence = JSON.parse(log.mock.lastCall![0]);
      expect(evidence).toMatchObject({ result: 'fail', source: 'npmmirror', version, stage: expect.any(String) });
      if (failure === '旧版') expect(evidence.latest).toBe('0.16.22');
      if (failure === '超时') expect(evidence.lastRetryError).toContain('网络探测超时');
      if (failure === '安装失败') expect(evidence).toMatchObject({ latest: version, stage: '安装 @latest' });
      else expect(ops.upgrade).not.toHaveBeenCalled();
      expect(ops.now()).toBeLessThanOrEqual(16_000);
    }
  });

  it('UT-S19-111: 包名、包版本、裸 CMD 版本和真实入口共同裁决', () => {
    expect(() => assertInstallation(version, installed)).not.toThrow();
    for (const observed of [
      { packageName: 'other-package' }, { packageVersion: '0.16.22' }, { cmdVersion: '0.16.7' },
      { entry: 'C:\\Old\\openlogos.cmd' }, { entry: null },
    ]) {
      expect(() => assertInstallation(version, { ...installed, ...observed })).toThrow('入口与目标不一致');
    }
  });

  it('UT-S19-112: tag 发版依赖双源成功，重试校验及复用冻结包', () => {
    const workflow = parse(readFileSync(new URL('../../.github/workflows/publish.yml', import.meta.url), 'utf8'));
    const { publish, 'windows-latest': windows, distribute } = workflow.jobs;
    expect(workflow.on.push.tags).toContain('v*');
    expect(windows).toMatchObject({
      needs: 'publish', 'runs-on': 'windows-latest', strategy: { matrix: { source: ['official', 'npmmirror'] } },
    });
    expect(distribute.needs).toEqual(['publish', 'windows-latest']);
    expect(distribute.if).toBeUndefined();
    expect(windows['continue-on-error']).toBeUndefined();
    const windowsRun = windows.steps.find(step => step.run?.includes('windows-latest-release-gate.mjs'));
    expect(windowsRun).toMatchObject({ env: { RELEASE_SOURCE: '${{ matrix.source }}' } });
    expect(windowsRun.if).toBeUndefined();
    expect(windowsRun['continue-on-error']).toBeUndefined();
    const upload = publish.steps.findIndex(step => step.uses?.startsWith('actions/upload-artifact@'));
    const publishIndex = publish.steps.findIndex(step => step.run?.includes('npm publish'));
    expect(upload).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(upload);
    expect(publish.steps[publishIndex].run).toContain('../release-bundle/');
    expect(distribute.steps.find(step => step.uses?.startsWith('actions/download-artifact@')).with['artifact-ids'])
      .toBe('${{ needs.publish.outputs.release-bundle-id }}');
    expect(distribute.steps.some(step => step.run?.includes('release-publish-bundle.mjs distribute'))).toBe(true);
    expect(distribute.steps.some(step => step.run?.includes('wrangler pages deploy'))).toBe(true);
    expect(distribute.steps.some(step => step.run?.includes('npm publish'))).toBe(false);

    const bundle = mkdtempSync(join(tmpdir(), 'openlogos-release-test-'));
    try {
      const filename = 'miniidealab-openlogos-' + version + '.tgz';
      const archive = Buffer.from('冻结制品');
      const notes = Buffer.from('冻结发布说明');
      const sha = bytes => createHash('sha256').update(bytes).digest('hex');
      writeFileSync(join(bundle, filename), archive);
      writeFileSync(join(bundle, 'release-notes.md'), notes);
      writeFileSync(join(bundle, 'release.json'), JSON.stringify({
        tag, commit, filename, archiveSha256: sha(archive), notesSha256: sha(notes),
      }));
      expect(() => readBundle(bundle, tag, 'b'.repeat(40))).toThrow('提交不符');
      let published = false;
      let download = archive;
      let releaseNotes = notes.toString('utf8');
      const command = vi.fn((file, args) => {
        if (file === 'git') return `${commit}\trefs/tags/${tag}^{}\n`;
        if (args[0] === 'api') {
          if (!published) throw Object.assign(new Error('查询 Release'), { stderr: 'gh: HTTP 404' });
          return JSON.stringify({ tag_name: tag, draft: false, body: releaseNotes, assets: [{ name: filename }] });
        }
        if (args[1] === 'create') published = true;
        if (args[1] === 'download') writeFileSync(join(args.at(-1), filename), download);
        return '';
      });
      distributeRelease(bundle, tag, commit, 'miniidealab/openlogos', command);
      distributeRelease(bundle, tag, commit, 'miniidealab/openlogos', command);
      expect(command.mock.calls.filter(([, args]) => args[1] === 'create')).toHaveLength(1);
      expect(command.mock.calls.some(([, args]) => args.at(-1) === join(bundle, filename))).toBe(true);
      releaseNotes = '不同的发布说明';
      expect(() => distributeRelease(bundle, tag, commit, 'miniidealab/openlogos', command)).toThrow('发布说明与冻结说明不符');
      releaseNotes = notes.toString('utf8');
      download = Buffer.from('不同的制品');
      expect(() => distributeRelease(bundle, tag, commit, 'miniidealab/openlogos', command)).toThrow('附件的 SHA-256 不符');
      writeFileSync(join(bundle, filename), download);
      expect(() => readBundle(bundle, tag, commit)).toThrow('SHA-256 不符');
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('ST-S19-37: 从两个公开源在真实 Windows 原地升级到当前公开版', async () => {
    const response = await fetch('https://registry.npmjs.org/@miniidealab%2fopenlogos/latest', { signal: AbortSignal.timeout(30_000) });
    expect(response.ok).toBe(true);
    const publicVersion = (await response.json()).version;
    expect(publicVersion).toMatch(/^\d+\.\d+\.\d+$/);
    const tag = 'v' + publicVersion;
    const ref = 'refs/tags/' + tag;
    const refs = new Map(execFileSync('git', ['ls-remote', '--exit-code', 'https://github.com/miniidealab/openlogos.git', ref, ref + '^{}'], {
      encoding: 'utf8', timeout: 30_000, windowsHide: true,
    }).trim().split(/\r?\n/).map(line => {
      const [sha, name] = line.split('\t');
      return [name, sha];
    }));
    const commit = refs.get(ref + '^{}') ?? refs.get(ref);
    expect(commit).toMatch(/^[a-f0-9]{40}$/i);
    const both = await Promise.allSettled(['official', 'npmmirror'].map(source => verifyWindowsRelease({ tag, commit, source })));
    for (const result of both) {
      if (result.status === 'rejected') throw result.reason;
      expect(result.value).toMatchObject({ before: '0.16.7', packageVersion: publicVersion, cmdVersion: publicVersion, result: 'pass' });
    }
  }, 17 * 60_000);
});
