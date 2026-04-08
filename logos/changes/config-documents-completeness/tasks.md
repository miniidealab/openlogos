# 任务拆解：logos.config.json documents 配置补全

## T1：createLogosConfig 补充 changes
- `cli/src/commands/init.ts`：在 `documents` 对象中添加 changes 条目
- 状态：☐

## T2：sync 增量补全
- `cli/src/commands/sync.ts`：读取现有 config，检测 documents 是否缺少 changes key，补写并保存
- 状态：☐

## T3：更新 schema
- `spec/logos.config.schema.json`：examples 部分补充 changes
- 状态：☐

## T4：测试 + 发布
- 更新 s01-init / s08-sync 测试
- 全量测试通过
- 版本号 0.5.2 → 0.5.3
- 状态：☐
