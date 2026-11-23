---
title: "分支同步规则"
description: "branch_sync 的主分支选择与生成文件处置。"
---

每次调用按 `--base`、`branch_sync.base_branch`、本地记录的 `origin` 默认分支顺序解析主分支。`branch status` 只读，`branch sync` 执行本地合并。

生成文件处理规则对符合条件的共用验收结果等取主分支版本。可通过 `branch_sync.replace_paths` 追加 `logos/resources/verify/` 内符合条件的路径。受保护的基线运行、基线账本与部署报告继续按各自合并规则执行。

主分支新增的文件若被未跟踪或忽略的文件占用，命令可在合并前拒绝并报告路径。代码与规格冲突由使用者处理，命令不统一发号。
