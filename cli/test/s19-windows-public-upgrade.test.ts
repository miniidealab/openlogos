import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { describeOnPlatform } from './platform-skip.js';
import { installArgs, promoteUserPath, runUpgrade, windowsOperations } from '../../website/public/downloads/openlogos-upgrade.cjs';

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const prefixFixture = 'C:\\Users\\Test\\AppData\\Roaming\\npm';
const official = 'https://registry.npmjs.org/';

it('UT-S19-108: 使用官方源与精确版本，拒绝无效输入', () => {
  expect(installArgs(version, prefixFixture)).toEqual([
    'install', '-g', '@miniidealab/openlogos@' + version, '--prefix', prefixFixture,
    '--registry=' + official, '--@miniidealab:registry=' + official, '--prefer-online',
  ]);
  const npmPath = vi.fn();
  expect(() => runUpgrade('latest', { npmPath })).toThrow('请传入公告中的版本号');
  expect(npmPath).not.toHaveBeenCalled();
});

it('UT-S19-109: 目标目录去重后前移，保留其他条目及原始引用', () => {
  const source = '%USERPROFILE%\\tools;%APPDATA%\\npm;D:\\tools;C:/Users/Test/AppData/Roaming/NPM/;%LOCALAPPDATA%\\Microsoft\\WindowsApps';
  const expand = (item: string) => item.replace('%APPDATA%', 'C:\\Users\\Test\\AppData\\Roaming');
  expect(promoteUserPath(source, prefixFixture, expand)).toBe(
    prefixFixture + ';%USERPROFILE%\\tools;D:\\tools;%LOCALAPPDATA%\\Microsoft\\WindowsApps',
  );
  const short = 'C:\\Users\\TESTUS~1\\AppData\\Roaming\\npm';
  const realPath = (item: string) => item === short ? prefixFixture : item;
  expect(promoteUserPath(short + ';D:\\tools;' + prefixFixture, prefixFixture, expand, realPath)).toBe(
    prefixFixture + ';D:\\tools',
  );
});

it('UT-S19-109: npm 短路径与 CMD 长入口为同一文件时保留现有 Path', () => {
  const short = 'C:\\Users\\TESTUS~1\\AppData\\Roaming\\npm';
  const entry = prefixFixture + '\\openlogos.cmd';
  const writeUserPath = vi.fn();
  const system = {
    npmPath: () => 'npm.cmd',
    runShim(_entry: string, args: string[]) {
      if (args[0] === 'prefix') return short;
      return args[0] === '--version' ? version : '';
    },
    expand: (value: string) => value,
    realPath: (value: string) => value.replace(short, prefixFixture),
    readPaths: () => ({ machine: '', user: { kind: 'String', value: short } }),
    findEntry: () => entry,
    commandVersion: () => version,
    writeUserPath,
  };
  expect(runUpgrade(version, system)).toMatchObject({ version, entry, pathChanged: false });
  expect(writeUserPath).not.toHaveBeenCalled();
});

describeOnPlatform(process.platform === 'win32', 'requires win32', '真实 Windows 升级', () => {
  let temporary: string;
  let candidate: string;
  const registryKeys: string[] = [];

  function cmd(args: string[], cwd: string) {
    return execFileSync('cmd.exe', ['/d', '/c', ...args], { cwd, encoding: 'utf8', timeout: 180_000 });
  }

  beforeAll(() => {
    temporary = mkdtempSync(join(tmpdir(), 'openlogos-windows-upgrade-'));
    const checkout = join(temporary, 'candidate');
    execFileSync('git', ['clone', '--quiet', '--no-local', '--sparse', '--config', 'core.longpaths=true',
      resolve('..'), checkout], { timeout: 90_000 });
    // 只检出 npm prepack 的输入，避免历史归档的长路径进入 Windows 夹具。
    execFileSync('git', ['sparse-checkout', 'set', 'cli', 'skills', 'spec', 'plugin', 'plugin-codex',
      'plugin-opencode', 'plugin-cursor', 'plugin-qoder', 'plugin-workbuddy', 'plugin-zcode'],
    { cwd: checkout, timeout: 90_000 });
    const cli = join(checkout, 'cli');
    cmd(['npm', 'ci', '--no-audit', '--no-fund'], cli);
    cmd(['npm', 'pack', '--json'], cli);
    const name = readdirSync(cli).find(file => file.endsWith('-' + version + '.tgz'));
    if (!name) throw new Error('缺少候选 npm tarball。');
    candidate = join(cli, name);
  }, 360_000);

  afterAll(() => {
    for (const key of registryKeys) spawnSync('reg.exe', ['delete', 'HKCU\\' + key, '/f'], { windowsHide: true });
    if (temporary) rmSync(temporary, { recursive: true, force: true, maxRetries: 3 });
  });

  function fixture(label: string) {
    const folder = join(temporary, label);
    const prefix = join(folder, 'npm');
    mkdirSync(prefix, { recursive: true });
    const key = 'Software\\OpenLogos\\UpgradeTests\\' + temporary.split(/[\\/]/).at(-1) + '-' + label;
    registryKeys.push(key);
    const actual = windowsOperations(key, folder);
    const npm = actual.npmPath();
    const nodeDirectory = dirname(process.execPath);
    const verify = (raw: string) => actual.commandVersion(nodeDirectory + ';' + actual.expand(raw)).trim();
    const runtime = {
      ...actual,
      npmPath: () => npm,
      runShim(entry: string, args: string[]) {
        if (entry === npm && args[0] === 'prefix') return prefix;
        if (entry === npm && args[0] === 'install') {
          expect(args).toContain('@miniidealab/openlogos@' + version);
          return actual.runShim(npm, [...args.slice(0, 2), candidate, ...args.slice(3)]);
        }
        return actual.runShim(entry, args);
      },
      readPaths: () => ({ machine: nodeDirectory, user: actual.readPaths().user }),
      notify: vi.fn(),
    };
    return { folder, prefix, actual, runtime, npm, verify };
  }

  it('ST-S19-35: 用真实 npm 原地安装候选包，新 CMD 输出目标版本', () => {
    const { prefix, actual, runtime, npm, verify } = fixture('original-prefix');
    actual.runShim(npm, ['install', '-g', '@miniidealab/openlogos@0.16.7', '--prefix', prefix, '--registry=' + official]);
    actual.writeUserPath({ kind: null, value: null }, { kind: 'ExpandString', value: prefix });
    expect(verify(prefix)).toBe('0.16.7');
    const result = runUpgrade(version, runtime);
    expect(result).toMatchObject({ version, target: join(prefix, 'openlogos.cmd'), pathChanged: false });
    expect(verify(actual.readPaths().user.value)).toBe(version);
    expect(realpathSync.native(result.entry)).toBe(realpathSync.native(result.target));
    console.log('Windows upgrade ST-S19-35: CMD ' + version + ' | ' + result.entry);
  }, 180_000);

  it('ST-S19-36: 用户级旧入口可修复，机器级入口继续优先时保留原值', () => {
    const { folder, prefix, actual, runtime, verify } = fixture('中文用户入口');
    const old = join(folder, 'old');
    mkdirSync(old);
    writeFileSync(join(old, 'openlogos.cmd'), '@echo off\r\necho 0.16.7\r\n');
    const raw = '%SystemRoot%\\System32;' + old + ';' + prefix;
    const original = { kind: 'ExpandString', value: raw };
    actual.writeUserPath({ kind: null, value: null }, original);
    expect(verify(raw)).toBe('0.16.7');
    const result = runUpgrade(version, runtime);
    expect(result).toMatchObject({ version, pathChanged: true });
    expect(actual.readPaths().user.value).toBe(prefix + ';%SystemRoot%\\System32;' + old);
    expect(verify(actual.readPaths().user.value)).toBe(version);
    expect(runtime.notify).toHaveBeenCalledOnce();

    actual.writeUserPath(actual.readPaths().user, original);
    const blocked = { ...runtime, readPaths: () => ({ machine: old + ';' + dirname(process.execPath), user: actual.readPaths().user }) };
    const oldEntry = realpathSync.native(join(old, 'openlogos.cmd'));
    expect(() => runUpgrade(version, blocked)).toThrow(
      '新 CMD 仍会命中 ' + oldEntry + '。已验证新版入口为："' + join(prefix, 'openlogos.cmd') + '" --version。',
    );
    expect(actual.readPaths().user).toEqual(original);

    const cwdEntry = join(folder, 'openlogos.cmd');
    writeFileSync(cwdEntry, '@echo off\r\necho 0.16.7\r\n');
    expect(() => runUpgrade(version, runtime)).toThrow(realpathSync.native(cwdEntry));
    expect(actual.readPaths().user).toEqual(original);
    console.log('Windows upgrade ST-S19-36: CMD ' + version + ', machine and current directory shadows reported | ' + result.entry);
  }, 180_000);
});
