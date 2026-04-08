import test from "node:test";
import assert from "node:assert/strict";
import { createHooks } from "../src/hooks.js";

test("hooks: session.created injects summary", async () => {
  const hooks = createHooks(
    { directory: process.cwd() },
    async () => ({ ok: true, code: "OK", stdout: "Phase 1", stderr: "" })
  );
  const output = { context: [] };
  await hooks["session.created"]({}, output);
  assert.equal(output.context.length, 1);
  assert.match(output.context[0], /Phase 1/);
});

test("hooks: command execute routes parsed command", async () => {
  const calls = [];
  const hooks = createHooks(
    { directory: process.cwd() },
    async (args) => {
      calls.push(args);
      return { ok: true, code: "OK", stdout: "done", stderr: "" };
    }
  );
  const output = {};
  await hooks["tui.command.execute"]({ command: "/openlogos:status" }, output);
  assert.deepEqual(calls[0], ["status"]);
  assert.match(output.message, /执行成功/);
});

test("hooks: invalid args return arg error", async () => {
  const hooks = createHooks({ directory: process.cwd() }, async () => {
    throw new Error("should not call executor");
  });
  const output = {};
  await hooks["tui.command.execute"]({ command: "/openlogos:change BAD_slug" }, output);
  assert.match(output.message, /参数错误/);
});
