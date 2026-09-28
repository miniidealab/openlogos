import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PREFIX = "/openlogos:";

// Windows 上 npm 全局入口为 openlogos.cmd 包装，Node ≥ 18.20 / 20.12 不带 shell 时无法 spawn（架构 §五十二 52.5 第 4 条）。
// win32 以 shell 方式调用并逐个引用参数：先按 MSVCRT 规则加双引号，再对 cmd 元字符做两层 ^ 转义
// （外层 cmd 解析一次、.cmd 包装内 %* 展开后再解析一次）。POSIX 维持直接 spawn("openlogos", args)。
const WIN_CMD_META_RE = /([()\][%!^"`<>&|;, *?])/g;

function quoteWindowsShellArg(arg) {
  let value = String(arg);
  value = value.replace(/(\\*)"/g, '$1$1\\"');
  value = value.replace(/(\\*)$/, "$1$1");
  value = `"${value}"`;
  value = value.replace(WIN_CMD_META_RE, "^$1");
  return value.replace(WIN_CMD_META_RE, "^$1");
}

function buildOpenLogosSpawn(cliArgs, platform = process.platform) {
  if (platform === "win32") {
    return { command: ["openlogos", ...cliArgs.map(quoteWindowsShellArg)].join(" "), args: [], shell: true };
  }
  return { command: "openlogos", args: cliArgs, shell: false };
}

const COMMANDS = {
  status: { cli: ["status"], args: "none" },
  // CLI 暂无 next 子命令，先映射到 status
  next: { cli: ["status"], args: "none" },
  sync: { cli: ["sync"], args: "none" },
  verify: { cli: ["verify"], args: "none" },
  launch: { cli: ["launch"], args: "optionalModuleId" },
  init: { cli: ["init"], args: "optionalName" },
  change: { cli: ["change"], args: "requiredSlug" },
  merge: { cli: ["merge"], args: "requiredSlug" },
  archive: { cli: ["archive"], args: "requiredSlug" },
  index: { cli: ["index"], args: "none" },
};

function parse(raw) {
  const cmd = String(raw || "").trim();
  if (!cmd.startsWith(PREFIX)) return { matched: false };

  const body = cmd.slice(PREFIX.length).trim();
  if (!body) return { matched: true, ok: false, code: "E_ARG_INVALID", message: "缺少子命令" };

  const [name, ...rest] = body.split(/\s+/);
  const spec = COMMANDS[name];
  if (!spec) return { matched: true, ok: false, code: "E_ARG_INVALID", message: `未知子命令: ${name}` };

  if (spec.args === "none" && rest.length > 0) {
    return { matched: true, ok: false, code: "E_ARG_INVALID", message: `${name} 不接受参数` };
  }
  if (spec.args === "optionalModuleId") {
    if (rest.length > 1) {
      return { matched: true, ok: false, code: "E_ARG_INVALID", message: `${name} 只接受 0 或 1 个参数（module-id）` };
    }
    if (rest.length === 1 && !SLUG_RE.test(rest[0])) {
      return { matched: true, ok: false, code: "E_ARG_INVALID", message: `${name} 的 module-id 必须为合法 slug（小写字母/数字/连字符）` };
    }
    return { matched: true, ok: true, name, cliArgs: [...spec.cli, ...rest] };
  }
  if (spec.args === "optionalName" && rest.length > 1) {
    return { matched: true, ok: false, code: "E_ARG_INVALID", message: "init 最多接受 1 个参数" };
  }
  if (spec.args === "requiredSlug") {
    if (rest.length !== 1 || !SLUG_RE.test(rest[0])) {
      return { matched: true, ok: false, code: "E_ARG_INVALID", message: `${name} 需要合法 slug` };
    }
  }

  return { matched: true, ok: true, name, cliArgs: [...spec.cli, ...rest] };
}

async function ensureInitialized(cwd) {
  try {
    await access(join(cwd, "logos", "logos.config.json"), constants.F_OK);
    return { ok: true };
  } catch {
    return { ok: false, code: "E_PROJECT_NOT_INIT", message: "项目未初始化（缺少 logos/logos.config.json）" };
  }
}

function runOpenLogos(args, cwd, timeoutMs = 15000, deps = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const spawnImpl = deps.spawnImpl || spawn;
    const spec = buildOpenLogosSpawn(args, deps.platform || process.platform);
    const child = spec.shell
      ? spawnImpl(spec.command, spec.args, { cwd, env: process.env, shell: true })
      : spawnImpl(spec.command, spec.args, { cwd, env: process.env });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, code: "E_CMD_TIMEOUT", message: "命令超时", stdout, stderr });
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (err?.code === "ENOENT") {
        resolve({ ok: false, code: "E_CLI_NOT_FOUND", message: "未找到 openlogos 命令", stdout, stderr });
      } else {
        resolve({ ok: false, code: "E_CMD_FAILED", message: err?.message || "命令执行失败", stdout, stderr });
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, code: "OK", stdout, stderr });
      else resolve({ ok: false, code: "E_CMD_FAILED", message: `退出码 ${code}`, stdout, stderr });
    });
  });
}

function commandFromInput(input) {
  return input?.command || input?.value || input?.text || input?.args?.command || "";
}

function formatResult(res) {
  if (res.ok) return `OpenLogos 执行成功\n\n${String(res.stdout || "").trim()}`;
  const details = [res.message, String(res.stderr || "").trim(), String(res.stdout || "").trim()].filter(Boolean).join("\n");
  return `OpenLogos 执行失败（${res.code}）\n\n${details}`;
}

export const OpenLogosPlugin = async (ctx) => {
  return {
    async "session.created"(_input, output = {}) {
      const cwd = ctx?.directory || process.cwd();
      const check = await ensureInitialized(cwd);
      if (!check.ok) return;

      const res = await runOpenLogos(["status"], cwd, 8000);
      const summary = res.ok
        ? `当前 OpenLogos 状态：\n${String(res.stdout || "").trim()}`
        : `OpenLogos 状态注入失败（${res.code}）：${res.message}`;

      if (Array.isArray(output.context)) output.context.push(summary);
      if (typeof output.prompt === "string") output.prompt += `\n\n${summary}`;
      output.openlogos = { summary };
    },

    async "tui.command.execute"(input, output = {}) {
      const parsed = parse(commandFromInput(input));
      if (!parsed.matched) return;
      if (!parsed.ok) {
        output.message = `OpenLogos 参数错误（${parsed.code}）：${parsed.message}`;
        output.openlogos = { ok: false, code: parsed.code };
        return;
      }

      const cwd = ctx?.directory || process.cwd();
      const res = await runOpenLogos(parsed.cliArgs, cwd);
      output.message = formatResult(res);
      output.openlogos = { ok: res.ok, code: res.code, command: parsed.name };
    },
  };
};

// OpenCode 会把模块的每个导出当作插件初始化函数调用，内部工具只挂在插件函数上供测试使用，不另行导出。
OpenLogosPlugin.internals = { buildOpenLogosSpawn, quoteWindowsShellArg, runOpenLogos };

export default OpenLogosPlugin;
