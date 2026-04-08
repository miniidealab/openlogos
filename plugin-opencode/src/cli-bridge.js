import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 15000;

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
    const child = spawn("openlogos", cliArgs, { cwd, env: process.env });

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
