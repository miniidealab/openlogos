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

test("parse: launch with no arg is valid (optionalModuleId)", () => {
  const res = parseOpenLogosCommand("/openlogos:launch");
  assert.equal(res.ok, true);
  assert.deepEqual(res.cliArgs, ["launch"]);
});

test("parse: launch with valid module-id is valid", () => {
  const res = parseOpenLogosCommand("/openlogos:launch core");
  assert.equal(res.ok, true);
  assert.deepEqual(res.cliArgs, ["launch", "core"]);
});

test("parse: launch with invalid module-id is rejected", () => {
  const res = parseOpenLogosCommand("/openlogos:launch Bad_Name");
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_ARG_INVALID");
});

test("parse: launch with two args is rejected", () => {
  const res = parseOpenLogosCommand("/openlogos:launch core payment");
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_ARG_INVALID");
});

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("template: openlogos-launch.md uses $ARGUMENTS not {{module-id}}", () => {
  const content = readFileSync(
    join(__dirname, "..", "template", "commands", "openlogos-launch.md"),
    "utf-8"
  );
  assert.ok(!content.includes("{{module-id}}"), "must not contain {{module-id}}");
  assert.ok(content.includes("$ARGUMENTS"), "must contain $ARGUMENTS");
});
