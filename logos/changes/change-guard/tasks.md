# 任务拆解：变更 Guard 机制

## T1：Guard 文件生命周期（P0）
- `cli/src/commands/change.ts`：创建变更时写入 `logos/.openlogos-guard`
- `cli/src/commands/archive.ts`：归档变更时删除 `logos/.openlogos-guard`
- 状态：☐

## T2：SessionStart Hook 增强（P0）
- `plugin/bin/openlogos-phase`：lifecycle=active 时检测 guard 文件，输出对应提示
- 状态：☐

## T3：AGENTS.md/CLAUDE.md 声明机制（P1）
- `cli/src/commands/init.ts`：升级 active lifecycle 的变更管理段落
- 增加结构化声明要求 + bug 发现行为约束
- 同步更新 Cursor policy mdc
- 状态：☐

## T4：测试 + 发布
- 更新测试验证 guard 文件的创建和删除
- 全量测试
- 版本号 0.5.1 → 0.5.2
- 状态：☐
