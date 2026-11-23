---
title: "验收历史查询"
description: "按运行 ID 查询验收与冒烟记录。"
---

进入执行的 verify 或 smoke 运行可生成结构化历史。用 `openlogos history list --kind smoke --slug <slug> --result fail --format json` 按条件倒序查看，用 `openlogos history show <run_id> --format json` 查询单次结果及证据路径。`--module` 按模块筛选，`--limit` 默认 20。

中央索引位于 `logos/resources/verify/history/`；有活跃提案时，完整记录随提案归档。克隆只有索引时仍可查结构化结论，缺失证据会标为不可用。

提案历史默认含报告和自由文本。运行前设 `verify.history.raw_in_proposal: false`，可将新历史中的原文留在本机运行目录。现有共用报告与结果路径照常独立写入。
