---
title: "openlogos detect"
description: Show OpenLogos CLI version and current project detection information.
---

Print lightweight environment and project metadata. This is useful for diagnostics, tool integration, and confirming which CLI version is being used.

## Synopsis

```bash
openlogos detect [--format json]
```

## Options

| Option | Description |
|--------|-------------|
| `--format json` | Output structured JSON. |

## What it reports

- OpenLogos CLI version
- Node.js version
- Project name, locale, lifecycle, description, and source roots when run inside an OpenLogos project
- A clear "No OpenLogos project found" message when run outside a project

## Example

```bash
openlogos detect
```

```
OpenLogos CLI v0.9.22
Node.js v20.11.1

Project detected:
   Name:        my-project
   Locale:      en
   Lifecycle:   launched
```

## Related commands

- [`status`](/cli/status) — Project phase and proposal state
- [`next`](/cli/next) — Single next action
