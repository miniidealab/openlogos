const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PREFIX = "/openlogos:";

export const COMMAND_MAP = {
  status: { cli: ["status"], args: "none" },
  // 当前 CLI 尚无 next 子命令，先映射到 status 以兼容对话习惯
  next: { cli: ["status"], args: "none" },
  sync: { cli: ["sync"], args: "none" },
  verify: { cli: ["verify"], args: "none" },
  launch: { cli: ["launch"], args: "optionalModuleId" },
  init: { cli: ["init"], args: "optionalName" },
  change: { cli: ["change"], args: "requiredSlug" },
  merge: { cli: ["merge"], args: "requiredSlug" },
  archive: { cli: ["archive"], args: "requiredSlug" },
  index: { cli: ["index"], args: "none" }
};

export function parseOpenLogosCommand(rawCommand) {
  const cmd = (rawCommand || "").trim();
  if (!cmd.startsWith(PREFIX)) {
    return { matched: false };
  }

  const body = cmd.slice(PREFIX.length).trim();
  if (!body) {
    return {
      matched: true,
      ok: false,
      code: "E_ARG_INVALID",
      message: "缺少子命令，例如 /openlogos:status"
    };
  }

  const [name, ...rest] = body.split(/\s+/);
  const spec = COMMAND_MAP[name];
  if (!spec) {
    return {
      matched: true,
      ok: false,
      code: "E_ARG_INVALID",
      message: `未知子命令: ${name}`
    };
  }

  if (spec.args === "none" && rest.length > 0) {
    return {
      matched: true,
      ok: false,
      code: "E_ARG_INVALID",
      message: `${name} 不接受参数`
    };
  }

  if (spec.args === "requiredSlug") {
    if (rest.length !== 1 || !SLUG_RE.test(rest[0])) {
      return {
        matched: true,
        ok: false,
        code: "E_ARG_INVALID",
        message: `${name} 需要合法 slug（小写字母/数字/连字符）`
      };
    }
    return { matched: true, ok: true, cliArgs: [...spec.cli, rest[0]], name };
  }

  if (spec.args === "optionalModuleId") {
    if (rest.length > 1) {
      return {
        matched: true,
        ok: false,
        code: "E_ARG_INVALID",
        message: `${name} 只接受 0 或 1 个参数（module-id）`
      };
    }
    if (rest.length === 1 && !SLUG_RE.test(rest[0])) {
      return {
        matched: true,
        ok: false,
        code: "E_ARG_INVALID",
        message: `${name} 的 module-id 必须为合法 slug（小写字母/数字/连字符）`
      };
    }
    return { matched: true, ok: true, cliArgs: [...spec.cli, ...rest], name };
  }

  if (spec.args === "optionalName") {
    if (rest.length > 1) {
      return {
        matched: true,
        ok: false,
        code: "E_ARG_INVALID",
        message: "init 只接受 0 或 1 个参数"
      };
    }
    return { matched: true, ok: true, cliArgs: [...spec.cli, ...rest], name };
  }

  return { matched: true, ok: true, cliArgs: [...spec.cli], name };
}
