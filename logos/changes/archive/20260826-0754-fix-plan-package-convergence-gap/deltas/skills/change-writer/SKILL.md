## ADDED — Plan Package scaffold 保真与双重交付门（权威补充）

### canonical scaffold 保真

填写 proposal/tasks 前必须先读取 `openlogos change` 已生成的两个文件。保留 CLI scaffold 的 canonical 标题、section 顺序和机器区块，只替换占位正文；允许新增详细设计章节，但不得删除、改名、合并或翻译 canonical 章节。

### plan 阶段 `[code]` 红线

需要代码的 change 在 plan 阶段只保留空 `## [code]` 标题，不写任何 checkbox。真实切片仍由 merge 后 slice-planner 基于已合并规格与真实测试 ID 生成。CLI 初始模板若含旧行 `- [ ] 实现代码变更`，change-writer 必须删除该精确模板行并保留空标题。

### 写后读回

每次修改 proposal/tasks 或 Delta 后，必须从磁盘读回受影响片段；不得以内存草稿或工具成功消息代替实际字节。读回发现 canonical 标题、目标路径或 marker 漂移时立即修复。

### plan 交付双检查

proposal/tasks 完成后，在项目根依次运行：

```bash
openlogos change-lint --slug <slug> --format json
openlogos next --format json
```

只有 lint exit 0、`data.pass=true`，且 next 的活跃模块 `plan_state.plan_ready=true`、`proposal_step=ready-to-delta` 时，才能报告“方案待批准”。若 lint exit 2，逐条消费 issues/violations；若两命令结论不同，报告 OpenLogos 合同缺陷而非选择性相信其中一个。

### Delta 交付门保持

用户批准 plan 后只执行 `[delta]`；全部 Delta 落盘、逐项读回并勾选后重新运行 change-lint 到 exit 0。不得自动执行 merge，必须等待明确授权。

### 资产版本边界

检测到项目 sync stamp 的 Plan 合同版本或托管资产 hash 落后于 CLI 时，先提示运行 `openlogos sync` 并重开 Agent session。不得把同 semver 的不同 Skill 字节当作等价，也不得覆盖项目自有 Skill。
