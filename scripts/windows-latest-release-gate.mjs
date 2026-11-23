import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import upgrade from '../website/public/downloads/openlogos-upgrade.cjs';

export const packageName = '@miniidealab/openlogos';
const baseline = '0.16.7';
const registries = {
  official: 'https://registry.npmjs.org/',
  npmmirror: 'https://registry.npmmirror.com/',
};
const budgetMs = 15 * 60_000;
const pollMs = 15_000;

export function assertInstallation(version, observed) {
  if (observed.packageName !== packageName || observed.packageVersion !== version
      || observed.cmdVersion !== version || !observed.entry || !observed.expectedEntry
      || observed.entry.toLowerCase() !== observed.expectedEntry.toLowerCase()) {
    throw new Error('实际 npm 安装或 CMD 入口与目标不一致');
  }
}

export async function checkRegistry({ tag, commit, source }, ops, report = console.log, budget = budgetMs) {
  const version = tag?.match(/^v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)$/)?.[1];
  if (!version || !/^[a-f0-9]{40}$/i.test(commit) || !Object.hasOwn(registries, source)) {
    throw new Error('需要有效的发版 tag、提交和 registry 来源');
  }
  const registry = registries[source];
  const deadline = ops.now() + budget;
  const evidence = { tag, commit, source, registry, version, latest: null };
  const left = () => Math.max(0, deadline - ops.now());
  async function within(stage, maxMs, action) {
    evidence.stage = stage;
    if (!left()) throw new Error('Windows 验收已到截止时间');
    const value = await action(Math.min(left(), maxMs));
    if (!left()) throw new Error('Windows 验收已到截止时间');
    return value;
  }

  try {
    while (left()) {
      try {
        evidence.latest = await within('查询 latest', 30_000, timeout => ops.latest(registry, timeout));
        if (evidence.latest === version) {
          const observed = await ops.upgrade(registry, within, evidence);
          Object.assign(evidence, observed);
          assertInstallation(version, evidence);
          evidence.result = 'pass';
          return evidence;
        }
      } catch (error) {
        if (!error.retryable) throw error;
        evidence.lastRetryError = error.message;
      }
      if (left()) await ops.wait(Math.min(pollMs, left()));
    }
    throw new Error('Windows 验收在截止前未取得目标版本的安装与 CMD 证据');
  } catch (error) {
    evidence.result = 'fail';
    evidence.error = error.message;
    throw error;
  } finally {
    report(JSON.stringify(evidence));
  }
}

function run(file, args, { cwd, env, timeout, taskkill }) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-16_384); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16_384); });
    const timer = setTimeout(() => {
      const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', () => child.kill());
      killer.unref();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      reject(Object.assign(new Error('子进程超过本次时间预算'), { retryable: true }));
    }, timeout);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const retryable = /\b(E404|ETARGET|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|E50[234]|E429)\b/.test(stderr);
      reject(Object.assign(new Error(`子进程退出 ${code}：${(stderr || stdout).trim().slice(-1000)}`), { retryable }));
    });
  });
}

function npmRegistryArgs(registry, cache) {
  return ['--registry=' + registry, '--@miniidealab:registry=' + registry, '--cache', cache,
    '--prefer-online', '--fetch-retries=0', '--no-audit', '--no-fund'];
}

export async function verifyWindowsRelease(target, report) {
  if (process.platform !== 'win32') throw new Error('公网升级就绪验收需要真实 Windows');
  const startedAt = performance.now();
  const cwd = mkdtempSync(join(tmpdir(), 'openlogos-latest-'));
  try {
    const windows = upgrade.windowsOperations(undefined, cwd);
    let npm;
    const system32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    const taskkill = join(system32, 'taskkill.exe');
    const powershell = join(system32, 'WindowsPowerShell/v1.0/powershell.exe');
    const command = Buffer.from(
      "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); "
      + '$arguments=ConvertFrom-Json $env:OPENLOGOS_RELEASE_NPM_ARGS; & $env:OPENLOGOS_RELEASE_NPM @arguments; exit $LASTEXITCODE',
      'utf16le',
    ).toString('base64');
    function npmCommand(args, timeout) {
      npm ??= windows.npmPath();
      return run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
        cwd, timeout, taskkill,
        env: { ...process.env, OPENLOGOS_RELEASE_NPM: npm, OPENLOGOS_RELEASE_NPM_ARGS: JSON.stringify(args) },
      });
    }
    return await checkRegistry(target, {
      now: () => performance.now(),
      wait,
      async latest(registry, timeout) {
        const result = await npmCommand(['view', packageName + '@latest', 'version', '--json',
          ...npmRegistryArgs(registry, join(cwd, 'registry-cache'))], timeout);
        return JSON.parse(result);
      },
      async upgrade(registry, within, evidence) {
        // 每次重试从一个新前缀和已验证的旧版开始，覆盖安装中途部分写入的情形。
        const attempt = mkdtempSync(join(cwd, 'attempt-'));
        const prefix = join(attempt, 'npm');
        const cache = join(attempt, 'cache');
        const install = (target, source, timeout) => npmCommand([
          'install', '-g', packageName + '@' + target, '--prefix', prefix, ...npmRegistryArgs(source, cache),
        ], timeout);
        const env = { ...process.env };
        const pathKey = Object.keys(env).find(name => name.toLowerCase() === 'path') ?? 'Path';
        const path = prefix + ';' + (env[pathKey] ?? '');
        env[pathKey] = path;
        const expectedShim = join(prefix, 'openlogos.cmd');
        const cmd = timeout => run(join(system32, 'cmd.exe'), ['/d', '/c', 'openlogos', '--version'],
          { cwd, env, timeout, taskkill });
        await within('安装旧版', 120_000, timeout => install(baseline, registries.official, timeout));
        await within('核对旧版 CMD', 15_000, async timeout => {
          evidence.beforeEntry = windows.findEntry(path);
          const expected = realpathSync.native(expectedShim);
          if (evidence.beforeEntry?.toLowerCase() !== expected.toLowerCase()) {
            throw new Error('升级前的真实 CMD 入口不在本次前缀');
          }
          evidence.before = await cmd(timeout);
          if (evidence.before !== baseline) throw new Error('升级前的真实 CMD 版本与旧版基线不一致');
        });
        await within('安装 @latest', 120_000, timeout => install('latest', registry, timeout));
        return await within('核对新版包和 CMD 入口', 15_000, async timeout => {
          const installed = JSON.parse(readFileSync(join(prefix, 'node_modules', packageName, 'package.json'), 'utf8'));
          evidence.packageName = installed.name;
          evidence.packageVersion = installed.version;
          evidence.entry = windows.findEntry(path);
          evidence.expectedEntry = realpathSync.native(expectedShim);
          evidence.cmdVersion = await cmd(timeout);
        });
      },
    }, report, Math.max(0, budgetMs - (performance.now() - startedAt)));
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    tag: { type: 'string' }, commit: { type: 'string' }, source: { type: 'string' },
  } });
  try { await verifyWindowsRelease(values); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
