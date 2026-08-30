---
description: Generate an AI-ready prompt to rebuild logos-project.yaml resource_index with file-content-based descriptions
---

Generate a structured prompt that lets AI read actual file contents and write high-quality descriptions into `logos-project.yaml`.

1. Run `openlogos index` in the project root directory.
2. If the `openlogos` CLI is not found, tell the user to install it:
   ```
   npm install -g @miniidealab/openlogos
   ```
3. After the command completes, `logos/index-prompt.md` will be generated.
4. Tell the user: "Read `logos/index-prompt.md` and execute the instructions" — the AI will read each file's content and directly update `logos/logos-project.yaml`'s `resource_index` field.
