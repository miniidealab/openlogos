---
title: CLI JSON Output
description: Structured JSON output specification for OpenLogos CLI commands (status, next, verify, smoke, detect, module list).
---

OpenLogos CLI supports `--format json` on five command families — `status`, `next`, `verify`, `smoke`, `detect`, and `module list` — producing structured JSON for programmatic consumption by external tools like RunLogos.

## Common Conventions

- **Trigger**: Append `--format json` to any supported command
- **Output target**: JSON goes to **stdout**; errors go to **stderr**
- **Format**: Compact single-line JSON (no indentation), suitable for piping
- **Exit codes**: Same as human-readable mode
- **Encoding**: UTF-8
- **Field naming**: `snake_case`

## Envelope Structure

All commands share a common envelope:

```json
{
  "command": "<command-name>",
  "version": "<cli-version>",
  "timestamp": "<ISO-8601>",
  "data": { ... }
}
```

Where `command` is one of: `"status"`, `"next"`, `"verify"`, `"smoke"`, `"detect"`, `"module list"`.

## detect

```bash
openlogos detect --format json
```

Returns CLI version, Node.js version, and project detection information:

```json
{
  "cli": {
    "version": "0.10.3",
    "node_version": "v22.0.0"
  },
  "project": {
    "name": "my-project",
    "locale": "zh",
    "lifecycle": "launched",
    "modules": [
      { "id": "core", "name": "核心功能", "lifecycle": "launched" }
    ],
    "description": "项目描述",
    "source_roots": { "src": ["src"], "test": ["test"] }
  },
  "yaml_diagnostics": null
}
```

`project` is `null` when run outside an OpenLogos project.

## status

```bash
openlogos status --format json
```

Returns phase progress, module state, active proposals, and suggestions:

| Key field | Description |
|-----------|-------------|
| `phases[]` | All 13 phases with `key`, `label`, `done`, `skipped`, `files` |
| `modules[]` | Per-module lifecycle, current phase, phase progress, active change, suggestion |
| `modules[].active_change` | Proposal step, task progress, deployment decision, conflict detection |
| `current_phase` | First incomplete phase key (or `null` if all done) |
| `lifecycle` | Project lifecycle derived from module states |
| `yaml_diagnostics` | Parse recovery status if YAML has issues |

### Proposal steps

The `proposal_step` field tracks change proposal lifecycle:

| Step | Meaning |
|------|---------|
| `writing` | Proposal/tasks still has template placeholders |
| `delta-writing` | Proposal filled; delta tasks not all checked |
| `ready-to-merge` | All delta tasks checked |
| `merge-generated` | `openlogos merge` has run |
| `coding` | Specs merged; code tasks not all checked |
| `ready-to-verify` | All code tasks checked |
| `verify-passed` | `openlogos verify` passed |
| `verify-failed` | `openlogos verify` failed |
| `ready-to-deploy` | Verify passed, deployment pending |
| `deploy-done` | Deployment executed |
| `ready-to-smoke` | Deployment done, smoke pending |
| `smoke-passed` | `openlogos smoke` passed |
| `smoke-failed` | `openlogos smoke` failed |

## verify

```bash
openlogos verify --format json
```

Returns test verification results with three-layer validation:

| Key field | Description |
|-----------|-------------|
| `summary` | Defined/executed/passed/failed/skipped/uncovered counts and percentages |
| `gate` | `result` ("PASS"/"FAIL") and `reason` |
| `failed_cases[]` | ID and error for each failure |
| `checklist` | Design-time coverage validation status |
| `ac_trace` | Acceptance criteria traceability status |
| `pre_run` | Pre-run execution mode, commands, result paths, diagnostics |
| `sandbox` | Sandbox isolation mode, status, diagnostics |

### Pre-run modes

| Mode | Description |
|------|-------------|
| `none` | No pre-run command configured |
| `pre_run_command` | Single `verify.pre_run_command` executed |
| `two_phase` | `regression_command` + `incremental_command` with last-write-wins merge |

### Gate failure reasons

| Reason | Description |
|--------|-------------|
| `failed_cases` | One or more test cases failed |
| `incomplete_coverage` | Some defined cases have no result |
| `checklist_incomplete` | Design-time coverage checklist not fully checked |
| `ac_trace_incomplete` | Acceptance criteria traceability not fully passed |

## smoke

```bash
openlogos smoke --format json
openlogos smoke --env staging --format json
```

Returns post-deployment smoke verification results:

| Key field | Description |
|-----------|-------------|
| `environment` | Target environment (from `--env` flag, or `null`) |
| `summary` | Same structure as verify summary |
| `gate` | Gate 3.8 result and reason |
| `sandbox` | Sandbox execution status |
| `report_path` | Generated smoke report path |
| `result_path` | Smoke results JSONL path |

## module list

```bash
openlogos module list --format json
```

Returns the module registry:

```json
{
  "modules": [
    { "id": "core", "name": "核心功能", "lifecycle": "launched" },
    { "id": "payment", "name": "支付模块", "lifecycle": "initial" }
  ]
}
```

## Error envelope

When a command fails, JSON mode outputs an error envelope to **stderr**:

```json
{
  "command": "<command-name>",
  "version": "<cli-version>",
  "timestamp": "<ISO-8601>",
  "error": {
    "code": "PROJECT_NOT_INITIALIZED",
    "message": "logos/logos.config.json not found."
  }
}
```

| Error code | Description |
|------------|-------------|
| `PROJECT_NOT_INITIALIZED` | Not in an OpenLogos project |
| `NO_TEST_RESULTS` | Test results JSONL file not found |
| `NO_TEST_CASES` | No test case spec files found |
| `NO_SMOKE_RESULTS` | Smoke results JSONL file not found |
| `NO_SMOKE_CASES` | No smoke case spec files found |

## Usage examples

```bash
# Check gate result in scripts
openlogos verify --format json | jq '.data.gate.result'

# Get current phase
openlogos status --format json | jq '.data.current_phase'

# List module lifecycles
openlogos module list --format json | jq '.data.modules[] | {id, lifecycle}'

# Conditional check
if openlogos verify --format json 2>/dev/null | jq -e '.data.gate.result == "PASS"' > /dev/null; then
  echo "All tests passed!"
fi
```
