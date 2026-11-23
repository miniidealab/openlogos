'use strict';

const { spawnSync } = require('node:child_process');
const { lstatSync, realpathSync } = require('node:fs');
const { win32: path } = require('node:path');

const registry = 'https://registry.npmjs.org/';
const name = '@miniidealab/openlogos';

function installArgs(version, prefix) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error('请传入公告中的版本号，例如 0.16.22。');
  }
  return ['install', '-g', name + '@' + version, '--prefix', prefix, '--registry=' + registry,
    '--@miniidealab:registry=' + registry, '--prefer-online'];
}

function comparablePath(value, realPath) {
  let resolved = value.trim().replace(/^"|"$/g, '');
  if (realPath && path.isAbsolute(resolved)) {
    // 新 CMD 可能把 npm prefix 的 8.3 短路径显示为长路径。
    try { resolved = realPath(resolved); } catch { /* 不存在或不可访问的 Path 项保留原有比较方式。 */ }
  }
  return path.normalize(resolved).replace(/[\\/]+$/, '').toLowerCase();
}

function promoteUserPath(raw, prefix, expand, realPath) {
  const parts = raw ? raw.split(';') : [];
  const expected = comparablePath(prefix, realPath);
  const kept = parts.filter(item => comparablePath(expand(item), realPath) !== expected);
  return [prefix, ...kept].join(';');
}

function runUpgrade(version, system) {
  installArgs(version, '');
  const npm = system.npmPath();
  const prefix = system.runShim(npm, ['prefix', '-g']).trim();
  if (!path.isAbsolute(prefix) || /[;\r\n]/.test(prefix)) {
    throw new Error('npm 返回了无效的全局安装目录。');
  }
  system.runShim(npm, installArgs(version, prefix));
  const target = path.join(prefix, 'openlogos.cmd');
  if (system.runShim(target, ['--version']).trim() !== version) {
    throw new Error('npm 安装后目标入口版本不符：' + target);
  }

  const original = system.readPaths();
  const expectedEntry = comparablePath(target, system.realPath);
  const verify = (state) => {
    const tail = state.user.kind === 'ExpandString' ? system.expand(state.user.value ?? '') : state.user.value ?? '';
    const effective = [system.expand(state.machine ?? ''), tail].filter(Boolean).join(';');
    const entry = system.findEntry(effective);
    const ok = Boolean(entry && comparablePath(entry, system.realPath) === expectedEntry
      && system.commandVersion(effective).trim() === version);
    return { entry, ok };
  };

  const before = verify(original);
  if (before.ok) return { version, target, entry: before.entry, pathChanged: false };

  const kind = original.user.kind ?? 'ExpandString';
  const expand = kind === 'ExpandString' ? system.expand : value => value;
  const user = { value: promoteUserPath(original.user.value, prefix, expand, system.realPath), kind };
  const projected = verify({ ...original, user });
  if (!projected.ok) {
    throw new Error('新 CMD 仍会命中 ' + (projected.entry ?? '未知入口')
      + '。已验证新版入口为："' + target + '" --version。');
  }

  system.writeUserPath(original.user, user);
  try {
    const after = verify(system.readPaths());
    if (!after.ok) throw new Error('已保存的用户 Path 未能切换入口：' + (after.entry ?? '未知入口'));
    system.notify();
    return { version, target, entry: after.entry, pathChanged: true };
  } catch (error) {
    try {
      system.writeUserPath(user, original.user);
      system.notify();
    } catch (rollback) {
      throw new Error(error.message + '。还原用户 Path 时遇到错误：' + rollback.message, { cause: error });
    }
    throw error;
  }
}

const readPathDefinition = `
function Read-Path($key) {
  if ($null -ne $key -and ($key.GetValueNames() -contains 'Path')) {
    return @{value=$key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames'); kind=$key.GetValueKind('Path').ToString()}
  }
  return @{value=$null; kind=$null}
}`;

function windowsOperations(registrySubkey = 'Environment', cwd = process.cwd()) {
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const cmd = path.join(system32, 'cmd.exe');
  const ps = path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const environment = new Map(Object.entries(process.env).map(([key, value]) => [key.toLowerCase(), value]));

  function invoke(file, args, env = process.env) {
    const result = spawnSync(file, args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 240_000 });
    if (result.error || result.status !== 0) {
      const cause = result.error?.message ?? (result.stderr || result.stdout || '退出码 ' + result.status).trim();
      throw new Error(path.basename(file) + ' 执行失败：' + cause);
    }
    return result.stdout ?? '';
  }

  function powerShell(script, extra = {}) {
    const source = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);\n" + script;
    const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')];
    return invoke(ps, args, { ...process.env, OPENLOGOS_UPGRADE_REGISTRY_SUBKEY: registrySubkey, ...extra });
  }

  function withPath(value) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
    env.Path = value;
    return env;
  }

  function findCommand(name, value, extensions) {
    const directories = value.split(';').filter(Boolean);
    if (!environment.has('nodefaultcurrentdirectoryinexepath')) directories.unshift(cwd);
    // 直接读取文件系统中的路径，避免命令输出的 Windows 代码页损坏非 ASCII 目录名。
    for (const directory of directories) {
      const base = path.resolve(cwd, directory.trim().replace(/^"|"$/g, ''));
      for (const extension of extensions) {
        const candidate = path.join(base, name + extension);
        const entry = lstatSync(candidate, { throwIfNoEntry: false });
        if (!entry?.isFile() && !entry?.isSymbolicLink()) continue;
        try { return realpathSync.native(candidate); } catch { return candidate; }
      }
    }
    return null;
  }

  return {
    realPath: realpathSync.native,
    npmPath() {
      const npm = findCommand('npm', environment.get('path') ?? '', ['.cmd']);
      if (!npm) throw new Error('找不到 npm.cmd，请确认当前窗口可以运行 npm。');
      return npm;
    },
    runShim(entry, args) {
      return powerShell(`
$arguments = ConvertFrom-Json -InputObject $env:OPENLOGOS_UPGRADE_ARGS
& $env:OPENLOGOS_UPGRADE_ENTRY @arguments
exit $LASTEXITCODE`, { OPENLOGOS_UPGRADE_ENTRY: entry, OPENLOGOS_UPGRADE_ARGS: JSON.stringify(args) });
    },
    expand(value) {
      return value.replace(/%([^%]+)%/g, (token, key) => environment.get(key.toLowerCase()) ?? token);
    },
    readPaths() {
      return JSON.parse(powerShell(readPathDefinition + `
$machine = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')
$user = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:OPENLOGOS_UPGRADE_REGISTRY_SUBKEY)
@{machine=(Read-Path $machine).value; user=(Read-Path $user)} | ConvertTo-Json -Compress
`));
    },
    writeUserPath(expected, replacement) {
      powerShell(readPathDefinition + `
$expected = ConvertFrom-Json $env:OPENLOGOS_UPGRADE_EXPECTED
$replacement = ConvertFrom-Json $env:OPENLOGOS_UPGRADE_REPLACEMENT
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($env:OPENLOGOS_UPGRADE_REGISTRY_SUBKEY)
try {
  $actual = Read-Path $key
  if ($actual.kind -cne $expected.kind -or $actual.value -cne $expected.value) { throw 'User Path changed concurrently.' }
  if ($null -eq $replacement.kind) { $key.DeleteValue('Path', $false) }
  else { $key.SetValue('Path', $replacement.value, $replacement.kind) }
} finally { $key.Dispose() }
`, { OPENLOGOS_UPGRADE_EXPECTED: JSON.stringify(expected), OPENLOGOS_UPGRADE_REPLACEMENT: JSON.stringify(replacement) });
    },
    findEntry(value) {
      const extensions = (environment.get('pathext') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
      return findCommand('openlogos', value, extensions);
    },
    commandVersion(value) {
      return invoke(cmd, ['/d', '/c', 'openlogos', '--version'], withPath(value));
    },
    notify() {
      powerShell(`
Add-Type -Namespace OpenLogos -Name UpgradeEnvironment -MemberDefinition '[DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,string s,uint f,uint t,out UIntPtr r);'
$result = [UIntPtr]::Zero
[void][OpenLogos.UpgradeEnvironment]::SendMessageTimeout([IntPtr]65535,26,[UIntPtr]::Zero,'Environment',2,1000,[ref]$result)
`);
    },
  };
}

module.exports = { installArgs, promoteUserPath, runUpgrade, windowsOperations };

if (require.main === module) {
  try {
    if (process.platform !== 'win32') throw new Error('此升级脚本适用于 Windows。');
    const result = runUpgrade(process.argv[2], windowsOperations());
    console.log('OpenLogos ' + result.version + ' 已安装。新 CMD 入口：' + result.entry);
    if (result.pathChanged) console.log('用户 Path 已更新，请从开始菜单重新打开 CMD。');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
