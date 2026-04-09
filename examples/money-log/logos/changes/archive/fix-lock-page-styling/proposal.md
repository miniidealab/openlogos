# 变更提案：fix-lock-page-styling

## 变更原因

窗口尺寸从 800x600 调整到 1200x1000 后，密码锁页面（LockPage）的布局显得过于拥挤和不协调。密码输入框、数字键盘、图标等元素都偏小，与大窗口尺寸不匹配，用户体验不佳。

## 变更类型

- [x] 代码级（UI 样式修复）

## 变更范围

- 影响的核心文件：src/renderer/pages/LockPage.tsx

## 变更概述

调整密码锁页面的元素尺寸，使其与更大的窗口尺寸匹配：

- 锁图标：w-20 h-20 → w-24 h-24，文字 4xl → 5xl
- 标题：text-3xl → text-4xl
- 密码圆点：w-3.5 h-3.5 → w-4 h-4
- 数字键盘：max-w-[280px] → w-80，py-5 → py-6，text-2xl → text-3xl
- 间距和 padding 也相应增大