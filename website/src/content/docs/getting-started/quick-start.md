---
title: Quick Start
description: Get up and running with OpenLogos in under 10 minutes.
---

## Prerequisites

- Node.js >= 18
- An AI coding tool (Cursor, Claude Code, OpenCode, or any tool that reads project files)

## Install

```bash
npm install -g @miniidea/openlogos
```

## Initialize a Project

```bash
openlogos init my-project
cd my-project
```

This creates the `logos/` directory structure with configuration files, AI Skills, and the `AGENTS.md` instruction file.

## Next Steps

Open the project in your AI coding tool and tell it: "Help me write the requirements document." The AI will read `AGENTS.md`, detect the current phase, and follow the appropriate Skill.
