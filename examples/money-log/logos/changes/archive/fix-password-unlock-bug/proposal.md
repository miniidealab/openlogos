# 变更提案：fix-password-unlock-bug

## 变更原因

Bug 反馈：用户输入正确密码后，页面仍然停留在密码输入界面，无法进入主页面。

## 变更类型

- [x] 代码级（Bug 修复）

## 变更范围

- 影响的核心文件：
  - src/renderer/stores/appStore.ts (checkPasswordEnabled 函数)
  - src/renderer/pages/LockPage.tsx (密码验证后状态更新)

## 变更概述

**问题根因**：
1. `checkPasswordEnabled` 函数没有 try-catch 保护，当 Electron API 未准备好时会抛出异常
2. LockPage 调用 `checkPasswordEnabled()` 后没有等待状态更新完成，页面不会重新渲染

**修复方案**：
1. 在 `checkPasswordEnabled` 添加 try-catch 错误处理
2. 移除 LockPage 中对 `checkPasswordEnabled` 的依赖，验证成功后直接触发状态更新
3. 使用 `useStore.getState().checkPasswordEnabled()` 确保状态同步更新