# 实现任务

> **变更类型**：代码级修复  
> **关联场景**：S01（注册流程 Step 16→17）  
> **状态说明**：代码修复已紧急完成，本任务清单为补录确认事项

---

## Phase 1: 文档变更

- 无需更新（需求文档、功能规格、时序图均已正确描述目标行为）

---

## Phase 2: 设计变更

- 无需更新（原型、API YAML、DB DDL 均不受影响）

---

## Phase 3: 代码与验收

- [x] 修复 `flowtask/src/App.tsx` 中 `useEffect([currentUser])` 的跳转条件
  - 将 `if (currentUser && view === "loading")` 扩展为覆盖 `"loading" | "register" | "login"` 三种状态
- [ ] 确认 S01 编排测试（`logos/resources/scenario/auth.json`）中 Step 16/17 的断言仍然有效
- [ ] 重新运行编排测试，确认 S01 正常流程通过
- [ ] 运行 `openlogos verify` 确认三层验收结果全部为 pass
- [ ] 运行 `openlogos merge fix-register-redirect` 归档本次变更
