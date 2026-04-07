---
description: Initialize a new OpenLogos project with directory structure, config files, and AI instruction files
---

Initialize a new OpenLogos project in the current directory.

**Before running the command, you MUST ask the user two questions:**

1. **Language / 语言**: Ask the user to choose:
   - `en` — English (default)
   - `zh` — 中文

2. **AI Tool**: Ask the user which AI tool they are using:
   - `cursor` — Cursor IDE (default)
   - `claude-code` — Claude Code CLI
   - `other` — Other AI tools

Wait for the user to answer both questions before proceeding.

**Then run the init command with explicit flags:**

```
openlogos init --locale <LOCALE> --ai-tool <AI_TOOL> $ARGUMENTS
```

- Replace `<LOCALE>` with the user's language choice (`en` or `zh`).
- Replace `<AI_TOOL>` with the user's AI tool choice (`cursor`, `claude-code`, or `other`).
- If `$ARGUMENTS` is not empty, append it as the project name.

If the `openlogos` CLI is not found, tell the user to install it first:
```
npm install -g @miniidealab/openlogos
```
Then run the init command again with the flags.

After init completes, remind the user that the OpenLogos plugin is already installed and they can start working immediately with `/openlogos:next`.
