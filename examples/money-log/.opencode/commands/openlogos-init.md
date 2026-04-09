---
description: "OpenLogos — init reminder (prefer terminal + flags) / 初始化说明（建议用终端）"
---

**不要在 OpenCode 内用交互式 `openlogos init`**（非 TTY 会要求 `--locale`）。

若项目尚未初始化，请用户在**系统终端**、空目录或新项目根执行：

```bash
openlogos init --locale zh --ai-tool opencode [项目名]
```

英文环境将 `zh` 改为 `en`。初始化完成后再在本目录启动 `opencode`。
