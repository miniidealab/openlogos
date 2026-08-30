---
description: "OpenLogos — launch a module into change-management mode / 将模块切换到变更管理阶段"
---

在项目根执行：

!`openlogos launch $ARGUMENTS`

（若项目只有一个模块，可不传参数，CLI 自动识别；多模块时需传 module-id，例如 `/openlogos-launch core`。）

向用户解释：
- 指定模块的 `lifecycle` 已切换为 `launched`
- 后续对该模块的修改必须先通过 `openlogos change <slug>` 创建变更提案
- 使用 `change` / `merge` / `archive` 工作流推进迭代
