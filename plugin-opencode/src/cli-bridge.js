import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 15000;

// Windows 上 npm 全局入口为 openlogos.cmd 包装，Node ≥ 18.20 / 20.12 不带 shell 时无法 spawn（架构 §五十二 52.5 第 4 条）。
// win32 以 shell 方式调用并逐个引用参数：先按 MSVCRT 规则加双引号，再对 cmd 元字符做两层 ^ 转义
// （外层 cmd 解析一次、.cmd 包装内 %* 展开后再解析一次）。POSIX 维持直接 spawn("openlogos", args)。
const WIN_CMD_META_RE = /([()\][%!^"`<>&|;, *?])/g;

export function quoteWindowsShellArg(arg) {
  let value = String(arg);
  value = value.replace(/(\\*)"/g, '$1$1\\"');
  value = value.replace(/(\\*)$/, "$1$1");
  value = `"${value}"`;
  value = value.replace(WIN_CMD_META_RE, "^$1");
  return value.replace(WIN_CMD_META_RE, "^$1");
}

export function buildOpenLogosSpawn(cliArgs, platform = process.platform) {
  if (platform === "win32") {
    return { command: ["openlogos", ...cliArgs.map(quoteWindowsShellArg)].join(" "), args: [], shell: true };
  }
  return { command: "openlogos", args: cliArgs, shell: false };
}

export async function ensureProjectInitialized(cwd) {
  try {
    await access(join(cwd, "logos", "logos.config.json"), constants.F_OK);
    return { ok: true };
  } catch {
    return { ok: false, code: "E_PROJECT_NOT_INIT", message: "项目尚未初始化 OpenLogos（缺少 logos/logos.config.json）" };
  }
}

export async function runOpenLogosCommand(cliArgs, options = {}) {
  const cwd = options.cwd || process.cwd();
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  const initCheckTargets = new Set(["status", "next", "sync", "change", "merge", "archive", "verify", "launch"]);
  if (initCheckTargets.has(cliArgs[0])) {
    const initState = await ensureProjectInitialized(cwd);
    if (!initState.ok) return initState;
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const spawnImpl = options.spawnImpl || spawn;
    const spec = buildOpenLogosSpawn(cliArgs, options.platform || process.platform);
    const child = spec.shell
      ? spawnImpl(spec.command, spec.args, { cwd, env: process.env, shell: true })
      : spawnImpl(spec.command, spec.args, { cwd, env: process.env });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        ok: false,
        code: "E_CMD_TIMEOUT",
        message: `命令超时（>${timeoutMs}ms）`,
        stdout,
        stderr
      });
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        resolve({
          ok: false,
          code: "E_CLI_NOT_FOUND",
          message: "未找到 openlogos 命令，请先安装 CLI",
          stdout,
          stderr
        });
        return;
      }
      resolve({
        ok: false,
        code: "E_CMD_FAILED",
        message: err.message,
        stdout,
        stderr
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, code: "OK", stdout, stderr });
        return;
      }
      resolve({
        ok: false,
        code: "E_CMD_FAILED",
        message: `命令退出码: ${code}`,
        stdout,
        stderr
      });
    });
  });
}
