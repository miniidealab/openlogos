---
title: "openlogos index"
description: 生成用于重建 logos-project.yaml resource_index 的 AI 提示词。
---

生成 `logos/index-prompt.md`，这是一份提示词，用于请求 AI 助手根据实际文件内容重建或改进 `logos-project.yaml` 中的 `resource_index`。

## 命令格式

```bash
openlogos index
```

必须在项目根目录下运行。

## 功能说明

1. 读取 `logos/logos.config.json`
2. 扫描已配置的文档目录，排除 `changes`
3. 扫描根目录的 `spec/` 和 `skills/*/SKILL.md`
4. 读取每个候选文件的前 80 行
5. 写入 `logos/index-prompt.md`

该命令不会直接编辑 `logos-project.yaml`，而是准备一份可供审阅的 AI 提示词，让助手能够结合文件内容上下文来更新描述。

## 输出示例

```
Scanning project files for index generation...

  Found 35 files to index.
  ✓ Generated: logos/index-prompt.md

Next step:
  Tell your AI assistant: "Read logos/index-prompt.md and execute the instructions"
```

## 相关命令

- [`sync`](/zh/cli/sync) — 自动回填缺失的资源索引条目
- [`status`](/zh/cli/status) — 查看项目状态
