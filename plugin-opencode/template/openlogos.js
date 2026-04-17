import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PREFIX = "/openlogos:";

const COMMANDS = {
  status: { cli: ["status"], args: "none" },
  // CLI 暂无 next 子命令，先映射到 status
  next: { cli: ["status"], args: "none" },
  sync: { cli: ["sync"], args: "none" },
  verify: { cli: ["verify"], args: "none" },
  launch: { cli: ["launch"], args: "none" },
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

function runOpenLogos(args, cwd, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("openlogos", args, { cwd, env: process.env });

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

export default OpenLogosPlugin;
