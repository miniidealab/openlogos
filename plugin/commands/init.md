---
description: Initialize a new OpenLogos project with directory structure, config files, and AI instruction files
---

Initialize a new OpenLogos project in the current directory.

1. Run `openlogos init $ARGUMENTS` in the current working directory.
2. If `$ARGUMENTS` is not empty, use it as the project name.
3. If the `openlogos` CLI is not found, tell the user to install it first:
   ```
   npm install -g @miniidealab/openlogos
   ```
   Then run `openlogos init` again. The init command requires interactive prompts (language selection, AI tool selection) that only the CLI can handle.
4. After init completes, remind the user that the OpenLogos plugin is already installed and they can start working immediately with `/openlogos:next`.
