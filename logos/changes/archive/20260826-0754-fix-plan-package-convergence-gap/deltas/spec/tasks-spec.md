## ADDED — Plan Package tasks 三态与 scaffold 合同

### launched 初始模板

需要规格与代码的 launched change 初始 tasks 形态为：

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 更新需求文档的场景和验收条件
- [ ] 更新产品设计文档的功能规格

## [code] 代码实现
```

`[delta]` 行是必须由 change-writer 替换的 scaffold；`[code]` 是代码必需锚点，不得生成 `实现代码变更` 或其它 checkbox。纯规格 change 删除 `[code]`；纯代码 change 保留空 `[code]` 并走 no-delta spec-complete。

### 三个独立谓词

| 谓词 | 适用阶段 | 完成条件 |
|---|---|---|
| `tasks_plan_filled` | plan | `[delta]/[deploy]` 无模板残留、目标唯一、部署决定一致 |
| `tasks_code_required` | plan 及以后 | proposal/tasks/delta 表明需业务代码、测试、runner、reporter 或 UI/driver 实现 |
| `tasks_code_slices_filled` | spec-complete 后 | `[code]` 至少一个真实切片，非模板占位，引用真实测试 ID |

### 非法状态与修复

- plan 阶段 `[code]` 出现 checkbox：`tasks_code_entry_before_spec_complete`，删除条目但保留代码必需标题。
- 代码必需但缺 `[code]`：`tasks_code_section_missing`，补空标题。
- plan scaffold 行未替换：模板残留，plan 不 ready。
- merge 后空 `[code]`：不是 plan 失败，而是 `plan-slices` 尚未完成。

### 兼容

旧格式 tasks 的 post-plan 前沿保持历史兼容；仍在 writing 的 launched change 按新合同诊断。只读命令不执行 auto-reset；既有 merge/slice auto-reset 边界不变。
