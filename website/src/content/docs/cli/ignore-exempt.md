---
title: "openlogos ignore / exempt"
description: Manage the guard's protection scope — which paths stay out of version control (.gitignore managed block) and which committed paths need no change proposal.
---

Two commands decide what the [write guard](/specs/pretooluse-guard) protects on a launched project:

- `openlogos ignore` manages paths that should **not go into version control** — dependency folders, build output, caches. It maintains `guard.unversioned` in `logos/logos.config.json` and renders those entries into the OpenLogos managed block of `.gitignore`. Because git then ignores them, the guard no longer protects them.
- `openlogos exempt` manages **committed paths that need no change proposal**. It maintains `guard.exempt` in `logos/logos.config.json`. Files under these paths are still tracked and committed normally; writing them just doesn't require `openlogos change`.

## Synopsis

```bash
openlogos ignore add <pattern...>
openlogos ignore remove <pattern...>
openlogos ignore list [--format json]

openlogos exempt add <path...>
openlogos exempt remove <path...>
openlogos exempt list [--format json]
```

Run them from the project root (the directory that contains `logos/logos.config.json`).

## ignore vs exempt

| | `openlogos ignore` | `openlogos exempt` |
|---|---|---|
| Config field | `guard.unversioned` | `guard.exempt` |
| Effect on git | Written to the `.gitignore` managed block — the paths stop being versioned | None — the paths stay tracked and committed |
| Effect on the guard | Ignored, untracked paths are not protected | Writes under these paths need no proposal |
| Typical use | `node_modules/`, `dist/`, `.cache/`, generated reports | Reference material, scratch docs you still want in git |
| Built-in default | Always contains `logos/.openlogos-runtime/` (fixed) | `logos/resources/reference/`, `logos/resources/verify/baseline-seed-runs/*/staging/` and `logos/environments.yaml` |

## Approval: add and remove need the host's native prompt

`add` and `remove` change what the guard protects. When an AI runs them, the guard treats them as restricted commands in every lifecycle and proposal state:

- They must be a standalone call (a `cd <dir> &&` prefix is allowed). Combined with any other command, they are blocked.
- **Claude Code**, permission mode `default` or `acceptEdits`: the host shows its own approval prompt for that exact call; the command runs only if you approve.
- Other permission modes (`bypassPermissions`, `dontAsk`, `auto`, `plan`) or non-interactive runs: the call is blocked, because the host would not prompt. Run it yourself — in Claude Code type `! openlogos ignore add dist/` — or switch to the default permission mode and retry.
- **Cursor**: `beforeShellExecution` asks for approval; if the host cannot guarantee a prompt, the call is denied.
- ZCode, Qoder, and WorkBuddy have no native approval wired; run the command in your own terminal.

Agreement typed in the chat never counts as approval, and `openlogos next --auto` does not cover these commands. The CLI itself does not prompt: run in your own terminal, it simply executes.

`list` is read-only and never restricted.

## Behavior

### `ignore add` / `ignore remove`

1. All patterns are validated first. If any one is invalid, nothing is written.
2. `guard.unversioned` in `logos/logos.config.json` is updated.
3. The `.gitignore` managed block is re-rendered (the file is created if it does not exist). Content outside the block is never changed. If writing `.gitignore` fails, the config change is rolled back.
4. After `add`, if files that are **already tracked** match a new pattern, they are listed. They stay in version control and remain protected. `openlogos` never runs `git rm` for you; it prints the command to run yourself:

```
⚠ 2 tracked file(s) match "dist/". They stay in version control and remain protected by guard:
    dist/app.js
    dist/app.css
  To stop tracking them, run this yourself (openlogos does not run it):
    git --literal-pathspecs rm --cached -- 'dist/app.js' 'dist/app.css'
```

With more than 20 matching files, the full list is written to `logos/.openlogos-runtime/untrack-<timestamp>.lst` and the printed command reads it with `--pathspec-from-file`.

The managed block looks like this:

```text
# >>> openlogos managed >>>
# 由 openlogos 维护，请用 `openlogos ignore` 修改；区块外内容不会被改动
logos/.openlogos-runtime/
dist/
# <<< openlogos managed <<<
```

`logos/.openlogos-runtime/` is a fixed entry: adding it is a no-op, removing it is an error. Outside a git repository, `ignore add` still writes the config and block, and notes that the guard's version-control criterion is not in effect.

**Pattern rules:** standard `.gitignore` patterns, one per argument; not empty, single line, no NUL, must not start with `#` or `!`, and must not contain a `..` segment.

### `exempt add` / `exempt remove`

1. All paths are validated first; any invalid one means nothing is written.
2. If `guard.exempt` is absent, the built-in defaults are first written out as an explicit list so they can be edited.
3. `guard.exempt` is updated. Removing every entry writes an explicit empty list `[]`, which also turns the built-in defaults off.

**Path rules:**

- project-relative, `/` as separator;
- a trailing `/` means the directory itself and everything below it; without it, the entry matches that one file;
- `*` must take a whole path segment and matches exactly one segment (e.g. `logos/resources/verify/baseline-seed-runs/*/staging/`);
- rejected: empty, `/`, a lone `*`, absolute paths, `.` / `..` / empty segments, `\`.

### Paths that can never be exempted

`exempt add` rejects, and the guard ignores, any entry that would release:

- any `.gitignore` (at any level);
- `.git/` or anything under it (including `.git/info/exclude`);
- `logos/logos.config.json`;
- `logos/.openlogos-runtime/` (guard's own state).

These stay protected even inside an exempt directory: exempting `docs/` does not exempt `docs/.gitignore`.

### The environment registry `logos/environments.yaml`

The [environment registry](/specs/environments) is operations config, not business logic, so `logos/environments.yaml` is a built-in default exemption: editing it needs no proposal. Two caveats:

- **Explicit `guard.exempt` lists do not pick up new defaults.** A project that already wrote `guard.exempt` out (for example by an earlier `exempt add`) does not get this entry automatically. Run `openlogos exempt add logos/environments.yaml` if you want it.
- **A gated registry is never exempt.** As soon as the file contains a `promote_from` or `require_approval` field name (or any backslash character, which the guard treats conservatively), it becomes the source of deployment gate policy: neither the built-in default nor `guard.exempt` applies, and an active proposal is not a reason to allow it either. An AI's direct edits, shell writes, moves and deletes of the file go through the host's native approval — approved by you in interactive mode, blocked otherwise. A registry without gate fields keeps the exemption.

Deploy scripts and workflows referenced by the registry's `deploy` entries are ordinary tracked files and stay protected, so changing what a deployment actually executes still needs a proposal.

### `list`

Prints the current entries. For `exempt`, built-in defaults that have not been written to the config are marked `(default)`.

```
$ openlogos exempt list
Exempt from change proposals (guard.exempt):
  logos/resources/reference/                                (default)
  logos/resources/verify/baseline-seed-runs/*/staging/      (default)
  logos/environments.yaml                                   (default)
```

With `--format json`, the output is a JSON envelope; each entry has a `value` and a `source` (`config` or `default`):

```json
{
  "command": "exempt list",
  "version": "0.16.7",
  "timestamp": "2026-10-17T08:00:00.000Z",
  "data": {
    "entries": [
      { "value": "logos/resources/reference/", "source": "default" },
      { "value": "logos/resources/verify/baseline-seed-runs/*/staging/", "source": "default" },
      { "value": "logos/environments.yaml", "source": "default" }
    ]
  }
}
```

`ignore list --format json` has the same shape; its entries always have `source: "config"`.

## Examples

```bash
# Keep build output out of version control
openlogos ignore add dist/ coverage/

# Stop ignoring a path again
openlogos ignore remove coverage/

# Let the AI edit a scratch folder without opening a proposal (still committed)
openlogos exempt add docs/notes/

# Inspect the current scope
openlogos ignore list
openlogos exempt list --format json
```

## Errors

All errors exit with code 1 and write nothing.

| Error | Cause | Fix |
|---|---|---|
| `logos/logos.config.json not found.` | Not in the project root, or not initialized | `cd` to the project root, or run `openlogos init` |
| `logos/logos.config.json is not valid JSON` | Config file is broken | Fix the JSON by hand |
| `guard.<field> contains an invalid entry` | An existing entry in the config is invalid | Fix or remove that entry by hand |
| `Invalid ignore pattern` / `Invalid exempt path` | An argument breaks the rules above | Correct the argument |
| `Missing pattern.` / `Missing path.` | `add` / `remove` without arguments | Pass at least one value |
| `The openlogos managed block in .gitignore is corrupted` | Markers of the managed block were edited | Repair the block markers by hand |
| `Failed to write <file> … Changes were rolled back.` | Disk write failed | Check permissions and retry |

## Related

- [PreToolUse Guard](/specs/pretooluse-guard) — how protected content is decided
- [`openlogos sync`](/cli/sync) — re-renders the `.gitignore` managed block from the config
- [`openlogos init`](/cli/init) / [`openlogos adopt`](/cli/adopt) — suggest ignore entries for the detected tech stack
