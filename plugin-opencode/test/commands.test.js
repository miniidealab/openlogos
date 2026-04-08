import test from "node:test";
import assert from "node:assert/strict";
import { parseOpenLogosCommand } from "../src/commands.js";

test("parse: unknown prefix is ignored", () => {
  const res = parseOpenLogosCommand("echo hello");
  assert.equal(res.matched, false);
});

test("parse: no-arg command", () => {
  const res = parseOpenLogosCommand("/openlogos:status");
  assert.equal(res.ok, true);
  assert.deepEqual(res.cliArgs, ["status"]);
});

test("parse: next maps to status for compatibility", () => {
  const res = parseOpenLogosCommand("/openlogos:next");
  assert.equal(res.ok, true);
  assert.deepEqual(res.cliArgs, ["status"]);
});

test("parse: required slug command", () => {
  const res = parseOpenLogosCommand("/openlogos:change add-opencode");
  assert.equal(res.ok, true);
  assert.deepEqual(res.cliArgs, ["change", "add-opencode"]);
});

test("parse: invalid slug rejected", () => {
  const res = parseOpenLogosCommand("/openlogos:change BAD_slug");
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_ARG_INVALID");
});

test("parse: init accepts zero or one arg", () => {
  const ok = parseOpenLogosCommand("/openlogos:init demo");
  const bad = parseOpenLogosCommand("/openlogos:init a b");
  assert.equal(ok.ok, true);
  assert.equal(bad.ok, false);
});
