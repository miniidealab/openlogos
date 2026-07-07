---
title: Flow Specification
description: The orchestratable development-flow data model — subflows, nodes, gates, loops, fan-out, when predicates, overlays, and the built-in initial/launched templates.
---

The Flow specification defines the **data model** behind OpenLogos's orchestratable development flow: how a single flow file describes the nodes, subflows, gates, loops, and completion predicates of a development process.

**Division of labour with the [Workflow](/specs/workflow) spec:**

- **Workflow** = the *concept / methodology* layer: WHY → WHAT → HOW, scenarios as the trace chain. It answers "why is the flow shaped this way".
- **Flow** (this spec) = the *data-model* layer: field contracts and enumerations. It answers "how do I write a flow file".

A flow file is the machine-readable expression of the Workflow methodology; the two never conflict.

## Positioning: Passive Derivation (Architecture A)

The flow engine is **passive**. OpenLogos reads the flow file plus the file system and **derives** "where are we now, what should run next". It does **not** spawn agents, run scripts, or supervise processes — real execution is delegated to the host (Claude Code / a human / CI). OpenLogos is "the score and the conductor", not "the musician's hands".

A **unified loop model** underpins everything: a linear node is just a degenerate loop with `max_iters: 1` whose convergence condition is "the output exists".

## File Location

| Role | Path | Notes |
|------|------|-------|
| Built-in template source | `spec/flow/initial.yaml`, `spec/flow/launched.yaml` | The single product source; ships with the CLI |
| Project instance | `logos/flow/*.yaml` | Materialised per-project via overlay; the file name *is* the flow id |

One flow = one file. The file name (without extension) is the flow id (`initial` / `launched` / custom). Project instances may `extends:` a built-in template and only write the diff (see [Template Inheritance](#template-inheritance-overlay--extends)).

## Top-Level Structure

```yaml
version: 1                      # flow file schema version (integer)
flow: initial                   # flow id (matches the file name)
extends: builtin:initial@v1     # optional overlay baseline + version
subflows:                       # ordered list of subflows (the flow body)
  - id: why
    name: WHY Requirements
    nodes: [ ... ]              # ordered node list
    loop: { ... }              # optional
    gate: { ... }              # optional
```

The flow body is an **ordered list of subflows**; each subflow holds an **ordered list of nodes**. Node ids are **globally unique** within a flow (overlays address nodes by id).

## Node Fields

```yaml
- id: scenario-modeling         # required, unique within the flow
  name: Scenario Sequencing     # required, display name
  skill: scenario-architect     # optional Skill bound to the node
  working_agent: null           # optional opaque worker-agent label
  review_agent: null            # optional opaque reviewer-agent label
  when: null                    # optional predicate; if false the node is skipped
  for_each: scenarios           # optional fan-out dimension
  produces: <path or pattern>   # output location; contains variables when fan-out
  coverage_threshold: null      # optional; fan-out aggregate threshold 0 < x <= 1
  done_when: dir_nonempty        # completion predicate
  fail_when: null               # optional failure/blocking predicate → failed
  pre_script: null              # optional pre-hook plugin
  post_script: null             # optional post-hook plugin
```

- `working_agent` / `review_agent` are **opaque labels**: OpenLogos never validates or schedules them; how they map to real agents is up to the host engine.
- `skill` is the recommended Skill for the node; `next` surfaces it as part of the instruction handed to the host.
- `coverage_threshold` is legal **only on `done_when: all_present` fan-out nodes**; when unset it equals full coverage. It must be omitted (never materialised as `null`) when absent.

## Subflows and Gates

```yaml
- id: deliver
  name: Deliver
  nodes: [ {id: deploy, ...}, {id: smoke, ...} ]
  gate:
    type: human                 # none | human | cmd (reserved)
    position: entry             # entry | exit (default exit)
    skippable: false            # may an auto-mode run skip this human gate?
```

A subflow may also carry `when`: if false the **entire subflow is skipped** (all nodes marked skipped). For example, launched's `spec` subflow uses `when: delta_required`, so a pure-code proposal (no `[delta]`) skips delta authoring. It does **not** skip spec completion entirely: a code proposal with no delta must still run `openlogos merge <slug>` as a no-op spec-complete step that writes `SPEC_MERGED`.

**`gate.position`** decides *when* the gate fires:

- `exit` (default) — fires after all nodes in the subflow complete, before the next subflow.
- `entry` — fires before the subflow's first node. Used for high-risk pre-confirmation (e.g. confirm *before* deploy, not after deploy+smoke both ran).

**`gate.type`:**

- `none` — no gate, flows straight through.
- `human` — a human confirmation point; `next` outputs "needs human confirmation" and does not auto-advance.
- `cmd` — *reserved*; gate by a command's exit code.

### Skippable Gates and Auto Mode

`gate.skippable: true|false` declares whether a human gate **may be auto-skipped**. The host decides whether to enter **auto mode** (e.g. `openlogos next --auto`):

- In auto mode, a `skippable: true` gate is treated as passed and released.
- A `skippable: false` gate **stays blocked even under auto** — it guards high-risk actions such as production deployment.
- Every auto-skip **leaves a trail**: an append-only `GATE_AUTO_PASSED` audit line (with gate id + timestamp) is written to the active proposal directory.

**`--auto` is a standing, run-scoped authorization**: choosing it authorizes the whole proposal chain to run to completion unattended. Beyond releasing `skippable: true` flow gates, `--auto` also carries standing authority to run the CLI stamp/publish steps that come *after code is already green* — `verify` / `smoke` / `archive` / `git push`.

**Hard red line (never released, in any mode including `--auto`):** the unconverged-code exit gate `gate:<subflow>:loop-exhausted` — code that hit the iteration ceiling without passing tests. Auto mode blocks here exactly like manual mode: **never publish unverified code**.

## Loop (Subflow Iteration)

```yaml
loop:
  until: code_slices_green      # tests_green | code_slices_green
  max_iters: 30                 # builtin launched default 30; others stay 1
```

- **Linear node = degenerate loop**: no `loop` or `max_iters: 1`; converges when the output exists.
- **`until` enum:**
  - `tests_green` — converges when the last verify run is green (ledger last line `result == "pass"`).
  - `code_slices_green` — converges when `section_complete:code ∧ tests_green`: every `[code]` slice in `tasks.md` is checked **and** the last verify run is green. Empty `[code]` (docs/delta-only proposals) degenerates to `tests_green`.
- **`max_iters > 1` = real iteration** — an actor-critic loop: the worker agent edits, tests are the reward signal, another round runs until convergence or `max_iters`, after which it escalates to a gate.
- Convergence rides on **objective numeric signals** (tests green / slices all-checked ∧ tests green), never on a reviewer agent's subjective judgment.
- The iteration count comes from the `LOOP_ITERS` ledger appended by `openlogos verify`; machine fields `loop_state` / `slice_state` are documented in [CLI JSON Output](/specs/cli-json-output).

**Reaching the ceiling = a loop-exhausted human gate.** When `iteration >= max_iters && !converged`, derivation produces the subflow's exit gate `gate:<subflow>:loop-exhausted`. Its `skippable` defaults to `false`; it may be opted into `true` only via the overlay `set-loop` `exhausted_gate.skippable` field (a high-risk, off-by-default choice).

## Fan-Out (`for_each` + `produces` Interpolation)

```yaml
- id: test-cases
  skill: test-writer
  for_each: scenarios           # scenarios | modules | <named list>
  produces: "logos/resources/test/{module}-{scenario}-test-cases.md"
  done_when: all_present        # done only when every instance has its output
```

- The `for_each` set is **resolved dynamically at evaluation time** (e.g. `scenarios` grows with `scenario_counter`) — never snapshotted. Its scope is the **current module**.
- `{module}` / `{scenario}` variables interpolate per instance; matching uses **exact glob** (not fragile substring inclusion).
- `done_when: all_present` derives a coverage object `{ total, covered, missing }` for status/watch.
- Optional `coverage_threshold` (float, `0 < x <= 1`) relaxes "done" to `covered / total >= threshold`. Omitted = `all_present` (100%). It is legal **only** on a complete fan-out node (`all_present` + `for_each` + non-empty `produces`); otherwise `FLOW_SCHEMA_INVALID`.

## `when` (Conditional Nodes)

`when` evaluates a simple predicate over known context flags; if false the node does not participate (the declarative successor to today's `skip_phases`).

| Flag | Meaning | Derivation |
|------|---------|------------|
| `bootstrap` | Module bootstrap mode | `module.bootstrap`; `adopted` skips prd/product-design/architecture |
| `api_enabled` | Has an API | `not skip_phases.includes('api')` |
| `db_enabled` | Has a database | `not skip_phases.includes('database')` |
| `scenario_enabled` | Does orchestration testing | `not skip_phases.includes('scenario')` |
| `deployment_required` | Needs deployment | source varies by flow (see below) |
| `smoke_required` | Needs smoke | source varies by flow (see below) |
| `delta_required` | Proposal carries spec changes | `tasks.md` has a `[delta]` section |
| `code_required` | Proposal will produce code | `tasks.md` has a non-empty `[code]` section |

**`deployment_required` / `smoke_required` sources differ by flow:**

- **initial** — module-level defaults (`module.deployment_required` unless skipped; `module.smoke_required` treated as true unless explicitly false).
- **launched** — must take the **proposal-level** decision from `resolveProposalDeploymentDecision()` (proposal.md deployment impact + `[deploy]` section). It must **not** fall back to module defaults, or a proposal declaring "no deployment" would wrongly enter deploy.

Expression forms: `flag` / `not flag` / `flag != value`.

## `done_when` Predicate Vocabulary

| Predicate | Meaning |
|-----------|---------|
| `dir_nonempty` | Target directory non-empty (filtered by `{module}-` prefix when multi-module) |
| `file:<path>` | The named file exists |
| `marker:<NAME>` | A marker file exists under the proposal dir (e.g. `VERIFY_PASS`) |
| `any_present:[A,B,...]` | Any listed marker/file exists (legacy-marker compatible) |
| `all_present` | Fan-out: every instance's `produces` is ready; `coverage_threshold` may relax it |
| `proposal_package_filled` | Both proposal.md and tasks.md filled out of template |
| `section_complete:<tag>` | The named tasks.md section (e.g. `delta`/`code`) is fully checked or absent |
| `tasks_delta_filled` | `tasks.md` `[delta]`/`[deploy]` filled out of template (used by `write-tasks`) |
| `tasks_code_filled` | `tasks.md` `[code]` section filled out of template — slices written, all unchecked (used by `plan-slices`) |
| `archived` | The proposal has been archived |
| `cmd:<command>` | Command exits 0 (overlay-add nodes + the launched verify/deploy/smoke gates) |

**`fail_when`** shares the same vocabulary but marks the node **failed** (not done). `fail_when` takes priority over `done_when` — a node hitting both is judged failed. Failed nodes do not advance; `next` outputs "fix and retry".

## Template Inheritance (overlay / extends)

Project instances use `extends` to reference a built-in template and write only the diff — via an **overlay**, not a full copy, so the methodology can evolve centrally.

```yaml
version: 1
flow: initial
extends: builtin:initial@v1      # baseline + content version (@vN for upgrade conflict detection)
overlay:
  - op: skip                     # skip a node (equivalent to when:false)
    target: orchestration-test
  - op: modify                   # deep-merge only the given fields (id may not be overridden)
    target: code
    set: { review_agent: my-code-reviewer }
  - op: add                      # insert a new node
    after: code                  # after | before, relative to a node id
    node: { id: lint, name: Lint, skill: linter, done_when: "file:logos/resources/verify/LINT_PASS" }
  - op: reorder                  # move a node
    target: smoke
    after: deploy
  - op: set-loop                 # override a subflow's loop
    subflow: implement
    set: { max_iters: 3 }        # set allows max_iters / until / exhausted_gate only
```

- The operation set is narrowed to five: `skip` / `add` / `modify` / `reorder` (node-level) + `set-loop` (subflow loop).
- Addressing is by **node id** (strategic-merge). `op:modify` may not override `id`.
- Built-in templates carry a content version (`builtin:initial@v1`); a mismatch between an overlay's `@vN` and the loader's internal version map raises `FLOW_VERSION_MISMATCH`.
- `openlogos flow show --resolved` outputs the merged (baseline + overlay) effective flow for debuggability.
- `op:add` nodes must carry an **evaluable** completion predicate; because initial has no proposal directory, initial overlay-add nodes must use `file:` / `dir_nonempty`, not `marker:` / `section_complete:*`.

## The Two Built-in Templates

### `initial` — First-Development Waterfall

A faithful 1:1 mapping of the 13-segment phase waterfall (WHY → WHAT → HOW → implement → deliver), behaviour unchanged:

- **why** → `prd` (Gate 1, skippable)
- **what** → `product-design` (Gate 2, skippable)
- **how-design** → `architecture`, `scenario-modeling` (fan-out), `api-design`, `db-design`, `deployment-design`, `test-cases` (fan-out), `orchestration-test`
- **implement** → `code`, `verify` (loop reserved, `max_iters: 1`)
- **deliver** → `deploy`, `smoke` (entry human gate, `skippable: false`)

### `launched` — Change-Lifecycle Flow (7 Subflows)

The change flow was redesigned: the old single `propose` segment became **plan → spec → merge → slice → implement → deliver → close**.

| Subflow | Nodes | Gate | Notes |
|---------|-------|------|-------|
| **plan** | `write-proposal`, `write-tasks` | human, skippable (`plan-exit`) | Approve the plan; `write-tasks` produces `[delta]`/`[deploy]` only |
| **spec** | `write-delta` | human, skippable (`spec-exit`) | `when: delta_required`; review delta + authorize merge |
| **merge** | `generate-merge-prompt`, `apply-merge` | none | Delta proposals generate/apply merge prompts; pure-code proposals use no-delta `openlogos merge` to write `SPEC_MERGED` |
| **slice** | `plan-slices` (skill: slice-planner) | human, skippable (`slice-exit`) | `when: code_required`; splits `[code]` slices post-merge |
| **implement** | `code`, `verify` | none | Slice loop active by default (`until: code_slices_green, max_iters: 30`) |
| **deliver** | `deploy`, `smoke` | human, entry, **skippable** (`deliver-entry`) | Proposal-level deployment decision |
| **close** | `archive` | none | — |

Key redesign points:

- The `[code]` slice split is **stripped out of the plan segment** into an independent `slice` subflow that runs *after* merge — so slices are cut against the **merged spec and real test IDs**, not against a draft.
- Pure-code proposals have no document delta, but they still need a traceable spec-complete state. Before `plan-slices`, `SPEC_MERGED` (or `MERGED`) must exist; without it `status`/`next` return `spec-complete-required`, not `plan-slices`.
- After spec-complete, a code proposal without real `UT-*` / `ST-*` / `SMOKE-*` IDs returns `test-id-required`. `plan-slices` must not run against placeholder or missing test IDs.
- The `implement` subflow **activates the slice loop by default** (hence `loop_state` / `slice_state` are always present under launched).
- The `deliver` entry gate is `skippable: true`: an unattended `--auto` run can release it (the deploy target may be a test environment); manual mode still stops for confirmation.

## Derivation Semantics (Passive A)

| Command | Semantics |
|---------|-----------|
| `openlogos status` | Derives each node's `done`/`active`/`skipped`/`failed`/`pending` from the **resolved** flow; fan-out emits coverage. `cmd:` nodes are **not executed** → `pending` |
| `openlogos next` | Outputs the active node + its skill + a ready prompt; human gates output "needs confirmation". Evaluates at most **one** `cmd:` per call (budget 1) |
| `openlogos next --auto` | Auto-releases gates **at the resolved current node/gate position**; only releases a `skippable:true` gate once the flow truly reaches that gate boundary, writing `GATE_AUTO_PASSED` |
| `openlogos watch` | Streams the derived state (real-time status); `cmd:` nodes not executed → `pending` |
| `openlogos flow show [--resolved]` | Shows the flow; `--resolved` outputs the overlay-merged effective flow |

Core algorithm: traverse subflow → node in order; `when`-false → skipped; a node is `done` per `done_when` (fan-out via `all_present` + coverage); the current node is the first non-done, non-skipped node (`failed` if `fail_when` hits); gates fire per `position`. A loop's `converged` overrides its nodes' own `done_when` — an unconverged loop **must not advance** to later subflows even if `verify`'s `done_when` (e.g. initial's acceptance-report file, written on both PASS and FAIL) is satisfied.

The machine contracts for these derivations — `loop_state`, `slice_state`, `plan_state`, `next_node`, `overlay_nodes`, `current_node`, `cmd_gate`, `GATE_AUTO_PASSED` — are specified in [CLI JSON Output](/specs/cli-json-output).
