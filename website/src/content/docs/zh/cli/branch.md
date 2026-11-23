---
title: "分支命令"
description: "检查并同步主分支，处理生成文件冲突。"
---

运行 `openlogos branch status --format json` 查看当前分支、主分支、共同起点与领先/落后数。运行 `openlogos branch sync --base <ref> --format json` 合并该本地引用并处理符合规则的生成文件冲突。两者都支持 `--base`。

主分支依次从 `--base`、`branch_sync.base_branch` 或本地记录的远端默认分支解析。如需更新引用，请先更新后再同步。此命令不会拉取、推送或创建分支。

代码和规格冲突由使用者解决。继续前查看状态和剩余冲突。详见[分支同步规则](/zh/specs/branch-sync/)。
