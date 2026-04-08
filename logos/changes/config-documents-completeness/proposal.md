# 变更提案：logos.config.json documents 配置补全

## 变更背景

`logos.config.json` 的 `documents` 字段定义了 RunLogos 可识别的文档模块。当前 `openlogos init` 生成的配置只包含 `resources/` 下的 6 个模块（prd、api、test、scenario、database、verify），**缺少 `changes` 目录**：

| 缺失目录 | 影响 |
|----------|------|
| `./changes` | RunLogos 无法读取变更提案、proposal.md、tasks.md |

这导致 RunLogos 用户在浏览项目时看不到变更管理的入口。

> **注**：`logos/spec/` 目录是方法论内部规范文件，与业务无关，不需要在 RunLogos 中展示给用户，因此不纳入本次变更。

## 变更目标

1. 在 `createLogosConfig()` 中补充 `changes` 文档模块
2. 同步更新 `logos.config.schema.json` 的 examples 部分
3. `openlogos sync` 对已有项目补写缺失的 documents 条目（增量补全，不覆盖用户自定义配置）

## 变更内容

### 新增 documents 条目

```json
{
  "changes": {
    "label": { "en": "Change Proposals", "zh": "变更提案" },
    "path": "./changes",
    "pattern": "**/*.{md,json}"
  }
}
```

### sync 增量补全逻辑

`openlogos sync` 读取已有 config，检查 `documents` 中是否缺少 `changes` key：
- 缺少 → 补写该条目并保存
- 已存在 → 不覆盖（尊重用户可能的自定义路径）

## 影响范围

| 组件 | 变更 |
|------|------|
| `cli/src/commands/init.ts` | `createLogosConfig()` 新增 changes |
| `cli/src/commands/sync.ts` | 增量补全 documents 缺失条目 |
| `spec/logos.config.schema.json` | examples 更新 |
| `cli/test/s01-init.test.ts` | 验证新 documents 条目 |
| `cli/test/s08-sync.test.ts` | 验证增量补全 |
