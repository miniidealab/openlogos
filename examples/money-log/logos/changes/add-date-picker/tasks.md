# 实现任务

## Phase 1: 文档变更（跳过）

> 说明：此为前端 UI 增强 + 后端参数扩展，现有 API 已支持 remark 字段，无需更新需求和设计文档。

## Phase 2: 设计变更（跳过）

> 说明：使用现有 API 和数据库字段，无需更新设计文档。

## Phase 3: 编排与代码

### 3.1 后端修改
- [x] database.js: saveRecord 方法增加可选的 created_at 参数
- [x] index.js: IPC handler records:save 接收 created_at 参数

### 3.2 前端修改
- [x] AccountingPage.tsx: 添加日期选择器（默认当天）
- [x] 调用 saveRecord 时传递 created_at 参数

### 3.3 验收
- [x] 运行 `npm test` 确认测试通过 (56/56)
- [ ] 运行 `npm run dev` 手动验证

---

## 变更状态

| 任务 | 状态 |
|------|------|
| proposal.md | ✅ 已填写 |
| tasks.md | ✅ 已填写 |
| 代码实现 | ✅ 已完成 |
| 测试通过 | ✅ 56/56 |
