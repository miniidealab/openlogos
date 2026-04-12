---
title: architecture-designer
description: Design system architecture, select technology stack, and define deployment topology.
---

Before diving into per-scenario technical implementation, establish the project's technical global view — system architecture, technology selection, deployment topology, and non-functional constraints. Ensures that subsequent sequence diagrams, API designs, and code generation all proceed under consistent architectural constraints.

## Phase & Trigger

- **Phase**: Phase 3 — HOW (Implementation), Step 0
- **Trigger conditions**:
  - User requests technical architecture design or technology selection
  - User mentions "Phase 3 Step 0", "architecture design", "technical plan"
  - Phase 2 product design is complete

## Prerequisites

- Requirements documents exist (`logos/resources/prd/1-product-requirements/`)
- Product design documents exist (`logos/resources/prd/2-product-design/`)

## What It Does

1. Read Phase 1/2 documents to understand the full product picture
2. Recommend suitable system architecture based on product complexity
3. Provide selection rationale and alternative comparisons for each technology choice
4. Draw system architecture diagrams (Mermaid) and deployment topology diagrams
5. Define non-functional constraints (performance, security, scalability)
6. Catalog external dependencies and define test strategies for each
7. Update `tech_stack` and `external_dependencies` in `logos-project.yaml`

## Architecture by Complexity

| Complexity | Pattern | Example |
|-----------|---------|---------|
| Simple | Monolith + single database | Personal SaaS, utility products |
| Medium | Frontend-backend separation + monolith backend | Team SaaS, multi-role systems |
| Complex | Microservices / modular monolith | High-concurrency, multi-platform |

## Technology Selection Format

Each technology dimension includes a selection, rationale, and alternatives:

```markdown
| Dimension | Selection | Rationale | Alternatives |
|-----------|-----------|-----------|-------------|
| Language | TypeScript | Unified frontend/backend, type safety | Go (when performance is priority) |
| Frontend | Next.js 15 | SSR + RSC, mature ecosystem | Astro (content sites) |
| Backend | Hono | Lightweight, edge-first, native TS | Express (ecosystem) |
| Database | PostgreSQL | Feature-rich, JSONB, RLS | MySQL (simple scenarios) |
```

## External Dependencies & Test Strategies

All external service dependencies (email, payment, OAuth, etc.) must have test strategies defined at the architecture phase:

| Strategy | Description | Typical Scenario |
|----------|-------------|-----------------|
| `test-api` | Test environment provides a backdoor API | Email/SMS verification codes |
| `fixed-value` | Specific test data uses fixed values | Fixed verification code for test phones |
| `env-disable` | Environment variable disables the feature | CAPTCHA, slider verification |
| `mock-callback` | Orchestration calls a simulated callback | Payment callbacks, Webhooks |
| `mock-service` | Local mock service as replacement | OAuth Provider |

These strategies are written to `external_dependencies` in `logos-project.yaml` and consumed by the [`test-orchestrator`](/skills/test-orchestrator) Skill.

## Outputs

| File | Location |
|------|----------|
| Architecture overview | `logos/resources/prd/3-technical-plan/1-architecture/01-architecture-overview.md` |
| Updated config | `logos-project.yaml` (`tech_stack`, `external_dependencies`) |

## Best Practices

- **Don't over-engineer** — for a solo developer, monolith + PostgreSQL + Vercel is sufficient
- **Selection rationale > selection itself** — documenting "why" is more valuable than "what"
- **Architecture diagrams are prerequisites for sequence diagrams** — system components become participants in subsequent diagrams
- **`tech_stack` is the AI's anchor** — subsequent AI code generation reads it from `logos-project.yaml`
- **Test strategies must be decided now** — if deferred to orchestration testing, backdoor APIs are often missing

## Related Skills

- Previous: [`product-designer`](/skills/product-designer) — create product design
- Next: [`scenario-architect`](/skills/scenario-architect) — expand scenarios into sequence diagrams
