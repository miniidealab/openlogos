---
title: "openlogos watch"
description: Stream the live derived dev-flow state (the real-time version of status).
---

Poll the same derivation source as `status` and turn the one-shot snapshot into a live stream. It is the real-time version of `status`: on startup it emits one initial snapshot, then emits a single event only when the derived state actually changes (loop, slice, `next_node`, proposal step, phase). Read-only — it never writes files, advances state, or produces side effects.

## Synopsis

```bash
openlogos watch [--interval <seconds>] [--module <id>] [--format json]
```

Must be run from the project root. Exit with Ctrl-C (SIGINT) — it stops cleanly.

## Options

| Option | Description |
|--------|-------------|
| `--interval <seconds>` | Polling interval. Defaults to `2` seconds. |
| `--module <id>` | Focus the stream on one module. |
| `--format json` | Emit one JSON envelope per event instead of the text summary. |

## What it does

- Emits an initial `snapshot` event (`seq=0`), then a `change` event (incrementing `seq`) whenever the derived data differs from the previous tick
- Change detection is a deep comparison (JSON equivalence) of adjacent ticks
- Each JSON payload carries `seq`, `event` (`snapshot` | `change`), `module` and the full `status` derivation
- Encounters a `cmd:` node without executing it — the node state stays `pending` (only `next` evaluates `cmd:` predicates)
- On a flow configuration error (`FlowError`) it prints the error envelope and stops polling rather than spinning on a broken flow

## Example

```bash
openlogos watch --interval 5 --format json
```

```json
{"command":"watch","ok":true,"data":{"seq":0,"event":"snapshot","module":null,"status":{ ... }}}
```

## Related commands

- [`status`](/cli/status) — One-shot dashboard snapshot
- [`next`](/cli/next) — Show the single most actionable next step
- [`flow show`](/cli/flow-show) — Show the resolved orchestration
