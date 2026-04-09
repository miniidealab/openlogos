# 变更提案：fix-catagory-does-not-work

## 变更原因
用户反馈：新增分类按钮，按了没有反应。

具体排查：
- 检查 SettingsPage.tsx 中"新增分类"按钮的 onClick 事件绑定 → 代码正确
- 检查 preload.js 中 addCategory 暴露 → 已正确暴露
- 检查 main/index.js 中 categories:add handler → 已正确注册
- 检查 database.js 中 addCategory 方法 → 实现正常

可能原因：`prompt()` 在 Electron 环境中可能存在兼容性问题，或事件绑定存在边界情况。

## 变更类型
- [ ] 需求级
- [ ] 设计级
- [ ] 接口级
- [x] 代码级（Bug 修复）

## 变更范围
- 影响的业务场景：S03-管理支出分类
- 影响的代码文件：
  - src/renderer/pages/SettingsPage.tsx（"新增分类"按钮）

## 变更概述
**问题根因**：SettingsPage.tsx 中"新增分类"按钮使用 `prompt()` 实现，在 Electron 环境中可能存在兼容性问题。

**修复方案**：将 `prompt()` 替换为自定义 Modal 对话框，提供更好的用户体验和兼容性。

## 变更状态
- [x] proposal.md 已填写
- [x] tasks.md 已填写
- [x] 代码修复完成
- [x] 测试通过 (56/56)
