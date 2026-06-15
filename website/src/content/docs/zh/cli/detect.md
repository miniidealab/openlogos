---
title: "openlogos detect"
description: 显示 OpenLogos CLI 版本以及当前项目的检测信息。
---

打印轻量级的环境和项目元数据。这对于诊断、工具集成以及确认当前使用的 CLI 版本非常有用。

## 命令格式

```bash
openlogos detect [--format json]
```

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--format json` | 输出结构化 JSON。 |

## 报告内容

- OpenLogos CLI 版本
- Node.js 版本
- 在 OpenLogos 项目内运行时，输出项目名称、locale、lifecycle、描述以及源码根目录
- 在项目外运行时，输出清晰的 "No OpenLogos project found" 提示

## 示例

```bash
openlogos detect
```

```
OpenLogos CLI v0.10.3
Node.js v20.11.1

Project detected:
   Name:        my-project
   Locale:      en
   Lifecycle:   launched
```

## 相关命令

- [`status`](/zh/cli/status) — 项目阶段与提案状态
- [`next`](/zh/cli/next) — 单条下一步操作
