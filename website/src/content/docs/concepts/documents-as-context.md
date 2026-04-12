---
title: Documents as Context
description: "Every decision lives in a document — reviewable, reproducible, cumulative. AI reads the docs, not your mind."
---

In "Vibe Coding," AI's context is a black box — you don't know what it assumed. In OpenLogos, every decision lives in a document. The same prompt with the same documents yields consistent results, regardless of which AI tool or team member runs it.

## The problem: black-box context

When you tell AI "build a login feature" without documents:

- **Requirements?** Guessing.
- **UI design?** Guessing.
- **API structure?** Guessing.
- **Edge cases?** Guessing.

Output varies wildly. Every session starts from zero. Decisions are lost.

When you provide structured documents (requirements → design → API spec → test cases), AI reads them all and produces consistent, traceable output.

## The `logos/` directory

Everything lives in a structured directory under `logos/`. Each phase's output becomes the next phase's input — all in human-readable formats:

```
logos/
├── logos.config.json                        # Project config
├── logos-project.yaml                       # AI collaboration index
├── resources/
│   ├── prd/
│   │   ├── 1-product-requirements/          # Phase 1 · WHY
│   │   ├── 2-product-design/                # Phase 2 · WHAT
│   │   │   ├── 1-feature-specs/
│   │   │   └── 2-page-design/
│   │   └── 3-technical-plan/                # Phase 3 · HOW
│   │       ├── 1-architecture/
│   │       └── 2-scenario-implementation/
│   ├── api/                                 # OpenAPI YAML specs
│   ├── database/                            # SQL DDL / schema
│   ├── test/                                # Test case specs (Markdown)
│   ├── scenario/                            # API orchestration tests (JSON)
│   └── verify/                              # Acceptance reports
├── changes/                                 # Delta change proposals
│   ├── <slug>/                              # Active proposal
│   │   ├── proposal.md                      # Impact analysis + summary
│   │   ├── tasks.md                         # Phase-based task checklist
│   │   └── deltas/                          # Changed artifacts per task
│   │       ├── prd/
│   │       ├── api/
│   │       ├── database/
│   │       └── scenario/
│   └── archive/                             # Completed proposals
├── skills/                                  # AI Skills (SKILL.md per skill)
│   ├── prd-writer/
│   ├── product-designer/
│   ├── scenario-architect/
│   ├── api-designer/
│   ├── db-designer/
│   ├── test-writer/
│   ├── code-implementor/
│   ├── code-reviewer/
│   ├── change-writer/
│   ├── merge-executor/
│   └── ...                                  # 13 built-in skills
└── spec/                                    # Methodology specifications
```

See [Project Structure](/specs/project-structure) for the full specification.

## Three properties

| Property | Description |
|----------|-------------|
| **Reviewable** | Every piece of information AI uses is in Markdown, YAML, or JSON. You can read, audit, and correct any assumption before code is generated. |
| **Reproducible** | Same documents → same context → consistent AI output. Switch AI tools, switch team members — the result stays predictable. |
| **Cumulative** | Documents are project knowledge assets. Decisions never get lost. New team members read the docs and understand the full history — no tribal knowledge needed. |

## AGENTS.md — the AI navigator

When AI opens your project, it reads `AGENTS.md` first. This file acts as a GPS:

| Function | Description |
|----------|-------------|
| Phase detection | Scans `logos/resources/` to find current phase |
| Next step | Suggests what to do next based on what's missing |
| Active skills | Lists which AI Skills to load for each task |
| Rules | "Never write code without design docs" — enforced automatically |

The AI doesn't need you to explain the project every time. It reads the docs, detects the phase, loads the right Skill, and gets to work — with full context.

## Format choices

| Artifact | Format | Rationale |
|----------|--------|-----------|
| Requirements, design | Markdown | Human-readable, version-controllable, AI-friendly |
| API specs | OpenAPI YAML | Industry standard, tooling ecosystem |
| DB schema | SQL DDL or YAML | Direct database compatibility |
| Test results | JSONL | Streamable, language-agnostic |
| Config | JSON | Machine-parseable, schema-validatable |

All formats are plain text — `git diff` shows exactly what changed.

---

*See also: [Interactive deep dive — Documents as Context](/deep-dive/documents-as-context) →*
