---
title: logos-project.yaml
description: Schema definition for the AI collaboration index file that provides global project context to AI tools.
---

`logos-project.yaml` is the AI collaboration index file for OpenLogos projects. It provides AI assistants with global project context — which key files to read, what tech stack is used, and what conventions to follow.

## File Location

```
logos/logos-project.yaml
```

## Schema Overview

```yaml
project:            # Project basics (required)
tech_stack:         # Technology stack (required)
external_dependencies:  # External service dependencies (optional)
resource_index:     # Resource file index (required)
conventions:        # Project conventions (optional)
```

## Field Definitions

### project

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Project name |
| `description` | string | Yes | One-line project description |
| `methodology` | string | No | Methodology followed (default: `"OpenLogos"`) |

### tech_stack

Free-form key-value pairs describing the project's technology stack. Recommended keys:

| Key | Description | Example |
|-----|-------------|---------|
| `framework` | Primary framework | `"Next.js 15"` |
| `language` | Primary language | `"TypeScript"` |
| `hosting` | Deployment platform | `"Cloudflare Pages"` |
| `database` | Database | `"Supabase (PostgreSQL)"` |
| `auth` | Authentication solution | `"Supabase Auth"` |

### external_dependencies

Array of external service dependencies with their testing strategies. Defined during the architecture design phase (Step 0), consumed by the test orchestration phase (Step 3b).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Dependency name (e.g., "Email Service", "CAPTCHA") |
| `provider` | string | Yes | Specific provider (e.g., "SendGrid", "reCAPTCHA") |
| `used_in` | array | Yes | Scenarios using this dependency (e.g., `["S01-User Registration"]`) |
| `test_strategy` | string | Yes | Testing strategy enum (see table below) |
| `test_config` | string | Yes | Testing strategy configuration details |

#### test_strategy Values

| Value | Description | Typical Use Case |
|-------|-------------|-----------------|
| `test-api` | Test environment provides backdoor API for verification codes/callbacks | Email/SMS verification codes |
| `fixed-value` | Specific test data uses fixed values | Test phone numbers with fixed verification codes |
| `env-disable` | Feature disabled via environment variable | CAPTCHAs, slider verification |
| `mock-callback` | Orchestration actively calls mock callback endpoints | Payment callbacks, Webhooks |
| `mock-service` | Local mock service replaces the real one | OAuth providers, third-party APIs |

### resource_index

Array of key resource files that AI should know about:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | File path relative to project root |
| `desc` | string | Yes | One-line description — tells AI when to read this file |

### conventions

Array of project conventions (string format). Each element is one convention rule.

## Complete Example

```yaml
project:
  name: "My SaaS Product"
  description: "A SaaS product built with OpenLogos methodology"
  methodology: "OpenLogos"

tech_stack:
  framework: "Next.js 15"
  language: "TypeScript"
  hosting: "Vercel"
  database: "Supabase (PostgreSQL)"
  auth: "Supabase Auth"
  payment: "Paddle"

external_dependencies:
  - name: "Email Service"
    provider: "SendGrid"
    used_in: ["S01-User Registration", "S03-Forgot Password"]
    test_strategy: "test-api"
    test_config: "GET /api/test/latest-email?to={email}"
  - name: "CAPTCHA"
    provider: "reCAPTCHA"
    used_in: ["S01-User Registration", "S02-Password Login"]
    test_strategy: "env-disable"
    test_config: "CAPTCHA_ENABLED=false"
  - name: "Payment Callback"
    provider: "Paddle"
    used_in: ["S05-Subscription Payment"]
    test_strategy: "mock-callback"
    test_config: "POST /api/test/simulate-payment-callback"

resource_index:
  - path: logos/resources/prd/1-product-requirements/01-requirements.md
    desc: Core product requirements. Read when dealing with product positioning, target users, or feature requirements.
  - path: logos/resources/prd/2-product-design/1-feature-specs/01-information-architecture.md
    desc: Information architecture document. Read when dealing with page structure or navigation design.
  - path: logos/resources/api/auth.yaml
    desc: Authentication API specs. Read when dealing with login, registration, or OAuth interfaces.
  - path: logos/resources/database/schema.sql
    desc: Complete database schema. Read when dealing with table structure, field design, or RLS policies.
  - path: logos/resources/scenario/user-auth.json
    desc: User auth scenario API orchestration. Read when dealing with auth flow verification.

conventions:
  - "All API paths start with /api/"
  - "Monetary amounts stored as INTEGER in cents"
  - "Time fields use TIMESTAMPTZ uniformly"
  - "Every change must create a logos/changes/ proposal first"
```

## Relationship with AGENTS.md

`logos-project.yaml` is the structured resource index; `AGENTS.md` is the natural language instruction file. They complement each other:

- `AGENTS.md` directs AI: "Read `logos/logos-project.yaml` first"
- `logos-project.yaml` tells AI: "These are the key files; here's when to read each one"
- `openlogos sync` updates `AGENTS.md` based on `logos-project.yaml` content

See [AGENTS.md Specification](/specs/agents-md) for the instruction file format.
