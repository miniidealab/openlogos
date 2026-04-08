# 变更提案：fix-register-redirect

## 变更原因

**问题来源**：用户反馈 — 注册成功后界面没有自动跳转，用户停留在注册页且无法进行任何操作。

**根本原因**：`App.tsx` 中监听 `currentUser` 的 `useEffect` 条件写得过于严格，只在 `view === "loading"` 时才执行跳转，而注册成功后 `view` 已经是 `"register"`，导致跳转逻辑永远不触发：

```ts
// 问题代码（修复前）
if (currentUser && view === "loading") setView("tasks");
```

这与 S01 时序图 Step 16→17 的设计不符：注册成功后前端写入 Zustand Store，**应立即跳转到任务主界面**。

## 变更类型

**代码级修复**

本次变更不涉及需求、产品设计、时序图、API 规格或数据库结构的改动。Bug 原因是前端代码的条件判断遗漏了 `view === "register"` 分支，仅需修正代码逻辑即可。

## 变更范围

- 影响的需求文档：无（需求描述本身是正确的）
- 影响的功能规格：无
- 影响的业务场景：**S01 — 新用户注册并开始使用**（Step 16 → Step 17）
- 影响的 API：无（Tauri IPC 命令不变）
- 影响的 DB 表：无
- 影响的编排测试：`logos/resources/scenario/auth.json` — S01 正常流程编排（需确认 Step 16/17 的断言仍然有效）

## 变更概述

注册成功后，Rust 命令层返回 `UserSession`，React 前端将其写入 Zustand Store（`currentUser` 变为非空值），此时 `useEffect([currentUser])` 应触发视图跳转到 `"tasks"`。

然而，原代码在判断条件中额外要求 `view === "loading"`，而注册完成时 `view` 的值是 `"register"`，条件不成立，跳转被跳过。用户因此停留在注册页，且注册后的页面没有提供任何导航出口，形成死锁。

**修复方案**：将条件扩展为覆盖所有"未登录"视图状态：

```ts
// 修复后
if (currentUser && (view === "loading" || view === "register" || view === "login")) {
  setView("tasks");
}
if (!currentUser && (view === "tasks" || view === "settings")) {
  setView("login");
}
```

此修复同时保证登录成功（S02）后也能正常跳转，属于防御性加固。

**已完成状态**：本次代码修复已在发现 Bug 后紧急应用（因当时处于首轮开发调试阶段，未经提案流程），本提案为补录性质，用于保持变更可追溯。
