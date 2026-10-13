---
title: PreToolUse Guard
description: How the OpenLogos write guard decides which AI writes need a change proposal — protected content, the Bash / PowerShell post-execution check, recovery, non-exemptable paths, and how each AI host is wired.
---

The OpenLogos guard turns the change-management rule — *no code or spec changes on a launched project without a change proposal* — from a reminder into a tool-level check. It runs as hooks inside the AI host, before (and for shell commands, also after) the AI writes files or runs commands.

This page summarizes the user-facing behavior. The normative definition is `logos/spec/pretooluse-guard.md` (deployed into your project by `init` / `sync`).

## When the guard applies

| Project state | Behavior |
|---|---|
| All modules `initial` | Writes are allowed. Two exceptions: guard's own state under `logos/.openlogos-runtime/` is never writable by tools, and protection-scope changes (`openlogos ignore` / `openlogos exempt` with `add` or `remove`) still need host approval. |
| `launched`, active proposal (`logos/.openlogos-guard` exists) | You may only change things within the proposal's scope. The guard allows writes, with one narrowing in the plan stage: until the plan is approved (`PLAN_APPROVED`), the only delta that may be written is a GUI prototype under `deltas/prd/2-product-design/2-page-design/*.html`. ZCode, Qoder, and WorkBuddy additionally narrow writes by the proposal's current step (`proposal_step`). |
| `launched`, no active proposal | Only **content that goes into version control** is protected (see below). Writes to ignored dependencies, build output, logs, and caches do not need a proposal. Protected writes are blocked, or — for shell commands — reported after execution. |

Create a proposal with `openlogos change <slug>`; that writes the guard file and opens the proposal scope. `openlogos archive <slug>` closes it.

## What counts as protected

When the project is launched, has no active proposal, and the git criterion is in effect (the project root is inside a git work tree, `git` and `node` are available, and the post-check engine is deployed), each target path is checked in this order — the first match wins:

| # | Path | Result |
|---|---|---|
| 1 | Outside the project root | Not protected |
| 2 | Guard's own state: `logos/.openlogos-runtime/` | Protected, cannot be exempted; tool writes are always blocked |
| 3 | Protection-scope sources: every `.gitignore` (any level), `.git/info/exclude`, an in-project `core.excludesFile`, `logos/logos.config.json` | Protected, cannot be exempted |
| 4 | git metadata (the `.git/` directory) | Protected, cannot be exempted |
| 5 | Built-in whitelist — e.g. `logos/changes/`, `logos/logos-project.yaml`, `logos/skills/`, `logos/spec/`, `AGENTS.md`, `CLAUDE.md`, `README*`, host directories written by `sync` (`.claude/`, `.cursor/`, `.opencode/`, `.codex-plugin/`) | Not protected |
| 6 | `guard.exempt` entries (default: `logos/resources/reference/` and `logos/resources/verify/baseline-seed-runs/*/staging/`) | Not protected |
| 7 | Anything under `logos/resources/` | Protected, even if git ignores it |
| 8 | Tracked by git | Protected (including force-added files inside ignored directories) |
| 9 | Ignored by git and untracked | Not protected |
| 10 | Everything else (new files that are neither tracked nor ignored) | Protected |

Steps 2–4 come before the whitelist and `guard.exempt`, so they stay protected even inside a whitelisted or exempt directory (for example `.claude/.gitignore` or `docs/.gitignore` when `docs/` is exempt). With an active proposal, the protection-scope sources and git metadata can be changed like any other in-scope file; `logos/.openlogos-runtime/` stays blocked in every state.

To change what is protected, use [`openlogos ignore` / `openlogos exempt`](/cli/ignore-exempt) — never by editing `.gitignore` or `logos/logos.config.json` directly.

## Edit / Write tools: checked before the write

`Edit`, `Write`, `MultiEdit`, and `NotebookEdit` are checked before they run. A protected target is blocked; the message names the path, why it is protected (tracked file, new unignored file, spec directory, ignore-rule source, git metadata), and the next step — create a proposal with `openlogos change <slug>`. If the target is a dependency or build directory, the message also suggests `openlogos ignore add <pattern>`, which itself needs host approval.

## Bash / PowerShell: light pre-check + content-level comparison after execution

Shell commands cannot be judged reliably from their text, so with the git criterion in effect the guard:

1. **Pre-checks lightly.** Commands are split on `&&`, `||`, `;`, and `|` outside quotes. If a write target can be determined (a redirect target, or a path argument of `rm` / `cp` / `mv` / `mkdir` / `touch` / `chmod` / `chown` and their PowerShell equivalents) and it is protected, the command is blocked before it runs. Targets that cannot be determined (variables, command substitution, globs, `node -e`, scripts, `find -delete`, …) no longer block by themselves.
2. **Takes a snapshot** of protected content before the command runs (read-only commands such as `ls`, `cat`, `git status` may skip it).
3. **Compares content after execution.** When the command finishes, the post-check engine compares the protected content byte for byte with the snapshot. Any unproposed change is reported back to the AI with:
   - the changed files and the type of each change (added / deleted / type changed / content changed);
   - who caused it — this command, or "possibly a background command or a manual edit by the user, ask the user";
   - a recovery command for each recoverable file;
   - the next step: roll the changes back or open a proposal first. Changes that cannot be attributed to this command come with "ask the user, do not roll back on your own".

The recovery command restores one path from the snapshot:

```bash
node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" restore <record_id> -- <path>
```

(on Cursor the engine is `.cursor/hooks/openlogos-guard-post.cjs`). Restore refuses to run if the file has changed again since the report, so it never overwrites later edits. Files larger than 5 MiB or unreadable at snapshot time are reported as "cannot be restored automatically". The guard never restores anything by itself.

**Standalone `git` / `openlogos` calls are exempt.** A command whose every segment (split on `&&`, `||`, `;`) is a `git`, `openlogos`, or `cd` call is not reported — this covers `git checkout`, `git pull`, `git reset --hard`, `openlogos sync`, and so on. Mixing them with other commands (for example `openlogos sync && node script.js`) removes the exemption; the feedback then suggests splitting the call.

## Non-git projects and fallback

If the git criterion is not in effect — the project is not a git repository, `git` or `node` is missing, the post-check engine is missing, or the snapshot cannot be taken — the guard falls back to fail-closed rules: a safe-command whitelist, write-pattern detection, path extraction, and blocking whenever a write target cannot be resolved. There is no post-execution check in this mode.

Compound commands are judged **segment by segment**: every segment must pass. `ls && rm -rf src` and `true; rm src/x` are blocked even though `ls` and `true` are harmless. Relative write targets after `cd` / `pushd` are resolved against the effective working directory within the `&&` chain; when that directory becomes uncertain (a variable `cd`, `cd -`, or a chain broken by `;`, `||`, `|`, `&`), any later write segment is blocked. If the fallback was caused by a missing engine, the message tells you to run `openlogos sync`.

## Changing the protection scope needs host approval

`openlogos ignore add|remove` and `openlogos exempt add|remove` change what the guard protects, so they are restricted in every lifecycle and proposal state (`list` is not). They must be run as a standalone call (a `cd` prefix is allowed); compound forms are blocked.

- **Claude Code** — in the `default` or `acceptEdits` permission mode, the guard asks the host to show its native approval prompt for that exact call. In other modes (`bypassPermissions`, `dontAsk`, `auto`, `plan`) or non-interactive runs the host would not prompt, so the call is blocked; run it yourself in the terminal with `! <command>`, or switch to the default permission mode.
- **Cursor** — `beforeShellExecution` returns `ask`; if the host cannot guarantee an approval prompt, the call is denied.
- **ZCode / Qoder / WorkBuddy** — no native approval is wired. On a launched project these shell commands are blocked like any other non-read-only command; run them yourself in a terminal.
- Agreement typed in the chat never counts as approval, and `openlogos next --auto` does not cover protection-scope changes.

## Paths that can never be exempted

No `guard.exempt` entry and no whitelist can release these:

- every `.gitignore`, at any level;
- `.git/info/exclude` (and an in-project `core.excludesFile`);
- `logos/logos.config.json`;
- git metadata (`.git/` and paths under it);
- guard's own state, `logos/.openlogos-runtime/`.

`openlogos exempt add` rejects such entries, and hand-written invalid entries in the config are skipped with a warning.

## Hook points by host

| Host | Hook points | Guard strength |
|---|---|---|
| **Claude Code** | `SessionStart` (phase context and pending reports); `PreToolUse` on `Edit\|Write\|MultiEdit\|NotebookEdit\|Bash\|PowerShell`; `PostToolUse` on `Bash\|PowerShell\|BashOutput\|TaskOutput\|KillShell\|TaskStop`; `PostToolUseFailure` on `Bash\|PowerShell`; `Stop` | Full: edits are blocked beforehand, shell commands get the pre-check plus the post-execution comparison, protection-scope changes go through native approval |
| **Cursor** (IDE and `cursor-agent` CLI) | `.cursor/hooks.json`: `sessionStart`, `beforeShellExecution` (light pre-check + snapshot), `afterShellExecution` (post-check), `afterFileEdit` (after-the-fact report) | Partial: OpenLogos does not wire `preToolUse`, so file edits are only reported after they happen, never blocked beforehand. Protected content is judged the same way as on Claude Code |
| **ZCode / Qoder / WorkBuddy** | Plugin `hooks/hooks.json`: `SessionStart` and `PreToolUse` | Conservative PreToolUse hard guard: on a launched project, shell commands outside a small read-only set are blocked, and file writes are narrowed by `proposal_step` (only `proposal.md` / `tasks.md` while planning, only `deltas/**` and `tasks.md` while writing deltas). No git criterion and no post-execution check |
| **Codex / OpenCode** | Session context only | No write interception |

`init`, `adopt`, `sync`, and `launch` deploy and refresh these hooks. After upgrading the CLI, run `openlogos sync` in every project, otherwise it keeps the old guard — see [Upgrading from 0.13.x](/getting-started/upgrade-from-0-13).

## Known limits

- The post-check runs after the write: the content has already changed and must be rolled back from the report. Restore works until git garbage-collects the stored objects (two weeks by default).
- Background tasks the host never reports as finished keep their records open; changes during that time are reported once as "ask the user".
- Content that is ignored by git, untracked, outside `logos/resources/`, and not a non-exemptable path is unprotected by design.
- The guard protects against accidental or habitual overreach by an AI, not against an agent that deliberately works around it.

## Related

- [`openlogos ignore` / `openlogos exempt`](/cli/ignore-exempt) — manage the protection scope
- [`openlogos change`](/cli/change) — open a proposal
- [`openlogos sync`](/cli/sync) — redeploy guard scripts and hooks
- [Cursor Plugin](/specs/cursor-plugin) — Cursor asset layout and hooks
- [Change Management](/specs/change-management) — the Delta workflow the guard enforces
