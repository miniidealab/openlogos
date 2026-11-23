---
title: "知识录入与查询"
description: "录入、检索和校验企业知识。"
---

无需立案时，用 `openlogos knowledge apply <候选目录>` 校验并录入一批材料。候选放在项目根外，含 Markdown 条目，原文可放在 `sources/` 下。校验失败整批拒绝，录入中断后可用 `--recover` 恢复。

用 `openlogos knowledge list --module core --format json` 按模块筛选，用 `knowledge show K01` 读取条目，用 `knowledge refs K01-R1` 反查引用场景。`knowledge index` 重建索引，`knowledge check` 只读诊断。

首次录入可初始化 `TAGS.md`，也可显式执行 `knowledge apply --init-tags`。录入与提案变更的适用场景见[企业知识](/zh/concepts/enterprise-knowledge/)。
