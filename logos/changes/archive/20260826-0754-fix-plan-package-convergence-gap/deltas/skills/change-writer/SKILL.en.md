## ADDED — Authoritative Plan Package Scaffold and Delivery Gate

> This section supersedes earlier examples that populate `[code]` during plan authoring. It shares the same machine contract as the Chinese source.

### Preserve the CLI scaffold

Read the CLI-created `proposal.md` and `tasks.md` before editing. Preserve canonical headings, section order, and machine-readable blocks; replace placeholders in place. Extra design sections are allowed, but they never replace canonical reason/type/scope/deployment/summary/clarification sections.

### Keep `[code]` empty during plan

For a code-required change, retain an empty `## [code] Code Implementation` heading and write no checkbox below it. Real code slices are produced only after spec-complete by slice-planner using merged specifications and real test IDs. Remove the exact legacy template line `- [ ] Implement code changes` if present.

### Read back and verify twice

After writing, read the actual files from disk and run from the project root:

```bash
openlogos change-lint --slug <slug> --format json
openlogos next --format json
```

Report “ready for approval” only when lint exits 0 with `data.pass=true`, and next reports `plan_state.plan_ready=true` plus `proposal_step=ready-to-delta`. Consume every structured issue and repair the pointed artifact in the same producer run. Never infer completion from prose or checkbox counts.

### Delta and authorization boundary

After explicit plan approval, execute only `[delta]` tasks. Read every written Delta back, check off the matching task, and rerun change-lint to exit 0. Do not run merge without separate explicit authorization.

### Managed asset versioning

If the project sync stamp has an older Plan contract or managed-asset hash than the CLI package, require `openlogos sync` and a new Agent session. Never treat different Skill bytes under the same semver as equivalent, and never overwrite project-owned Skills.
