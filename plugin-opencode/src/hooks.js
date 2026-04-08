import { parseOpenLogosCommand } from "./commands.js";
import { runOpenLogosCommand } from "./cli-bridge.js";

export function extractCommand(input) {
  if (!input) return "";
  return (
    input.command ||
    input.value ||
    input.text ||
    input.args?.command ||
    input.payload?.command ||
    ""
  );
}

export function formatResult(res) {
  if (res.ok) {
    return `OpenLogos 执行成功\n\n${(res.stdout || "").trim()}`;
  }
  const details = [res.message, res.stderr?.trim(), res.stdout?.trim()].filter(Boolean).join("\n");
  return `OpenLogos 执行失败（${res.code}）\n\n${details}`;
}

export function createHooks(ctx, execute = runOpenLogosCommand) {
  return {
    async "session.created"(_input, output = {}) {
      const cwd = ctx?.directory || process.cwd();
      const res = await execute(["status"], { cwd, timeoutMs: 8000 });
      const summary = res.ok
        ? `当前 OpenLogos 状态：\n${(res.stdout || "").trim()}`
        : `OpenLogos 状态注入失败（${res.code}）：${res.message}`;

      // 避免假设 output 结构，按存在字段进行附加
      if (Array.isArray(output.context)) output.context.push(summary);
      if (typeof output.prompt === "string") output.prompt += `\n\n${summary}`;
      output.openlogos = { summary };
    },

    async "tui.command.execute"(input, output = {}) {
      const cmd = extractCommand(input);
      const parsed = parseOpenLogosCommand(cmd);
      if (!parsed.matched) return;

      if (!parsed.ok) {
        output.message = `OpenLogos 参数错误（${parsed.code}）：${parsed.message}`;
        output.openlogos = { ok: false, code: parsed.code };
        return;
      }

      const cwd = ctx?.directory || process.cwd();
      const res = await execute(parsed.cliArgs, { cwd });
      output.message = formatResult(res);
      output.openlogos = { ok: res.ok, code: res.code, command: parsed.name };
    }
  };
}
