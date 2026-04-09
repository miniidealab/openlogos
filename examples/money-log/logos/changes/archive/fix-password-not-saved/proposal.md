# 变更提案：fix-password-not-saved

## 变更原因

Bug 反馈：用户在设置页面设置密码锁后，再次打开 App 输入密码进入设置页面，发现密码锁仍然是未设置状态。

## 变更类型

- [x] 代码级（Bug 修复）

## 变更范围

- 影响的核心文件：
  - src/main/index.js (IPC handler for setPassword)
  - src/renderer/pages/SettingsPage.tsx (设置密码调用)

## 变更概述

**问题根因**：设置密码后，`password_enabled` 和 `password_hash` 可能没有正确保存到数据库，或者数据库初始化时被重置。

**修复方案**：
1. 在 IPC handler 添加日志用于调试
2. 在前端添加结果日志
3. 确保 database.init() 不会覆盖已保存的密码设置

需要用户运行 `npm run dev` 并在 DevTools 控制台查看日志定位具体原因。