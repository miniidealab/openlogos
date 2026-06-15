---
title: "ui-ux-pro-max"
description: "全面的 UI/UX 设计智能，覆盖 67 种风格、96 套调色板、57 组字体配对、25 种图表类型，横跨 13 种技术栈。"
---

面向 Web 与移动应用的全面设计指南。包含 67 种风格、96 套调色板、57 组字体配对、99 条 UX 准则以及横跨 13 种技术栈的 25 种图表类型。提供基于优先级的建议，帮助构建无障碍、高性能、视觉精致的界面。

> 此 Skill 取自 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT 许可）。

## 触发条件

- 用户请求设计 UI 组件或页面
- 用户需要调色板或排版建议
- 用户请求对现有代码进行 UX 审查
- Phase 2（产品设计）进行中且产品是 GUI 类（Web / 移动 / 桌面）
- `product-designer` Skill 在视觉设计决策时自动调用它

## 核心能力

### 设计动作

`plan` · `build` · `create` · `design` · `implement` · `review` · `fix` · `improve` · `optimize` · `enhance` · `refactor` · `check`

### 项目类型

Website · Landing page · Dashboard · Admin panel · E-commerce · SaaS · Portfolio · Blog · Mobile app

### UI 元素

Button · Modal · Navbar · Sidebar · Card · Table · Form · Chart

### 技术栈（13 种）

React · Next.js · Vue · Nuxt · Svelte · SvelteKit · SwiftUI · React Native · Flutter · Tailwind CSS · shadcn/ui · HTML/CSS · Astro

## 按优先级划分的规则类别

| 优先级 | 类别 | 影响 |
|----------|----------|--------|
| 1 | 无障碍 | CRITICAL |
| 2 | 触控与交互 | CRITICAL |
| 3 | 性能 | HIGH |
| 4 | 布局与响应式 | HIGH |
| 5 | 排版与色彩 | MEDIUM |
| 6 | 动画 | MEDIUM |
| 7 | 风格选择 | MEDIUM |
| 8 | 图表与数据 | LOW |

## 关键准则

### 无障碍（CRITICAL）

- 正常文本最低 4.5:1 的色彩对比度
- 所有可交互元素都有可见的聚焦环
- 有意义的图片配描述性 alt 文本
- 纯图标按钮使用 `aria-label`
- Tab 顺序与视觉顺序一致
- 表单标签带 `for` 属性

### 触控与交互（CRITICAL）

- 最小 44×44px 触控目标
- 主要交互使用点击/轻触（而非仅 hover）
- 异步操作期间禁用按钮
- 在问题源附近给出清晰的错误消息
- 可点击元素上设 `cursor: pointer`

### 性能（HIGH）

- 图片使用 WebP、`srcset` 与懒加载
- 动画前检查 `prefers-reduced-motion`
- 为异步内容预留空间，防止布局抖动

### 布局与响应式（HIGH）

- `viewport` meta：`width=device-width, initial-scale=1`
- 移动优先的断点
- 使用 `min()` / `clamp()` 的弹性网格

## 风格数据库（67 种风格）

包含：Glassmorphism · Claymorphism · Minimalism · Brutalism · Neumorphism · Bento Grid · Dark Mode · Skeuomorphism · Flat Design · Material Design · 以及另外 57 种。

每个风格条目包含：描述、CSS 属性、最适合的项目类型与示例代码。

## 调色板（96 套）

按情绪组织：Professional · Creative · Playful · Serious · Warm · Cool · Neutral · Bold。

每套调色板包含：主色、辅色、强调色、背景色与文本色，附 hex 值与 WCAG 对比度校验。

## 字体配对（57 组）

精选的标题 + 正文组合，附 Google Fonts 链接、回退字体栈与推荐使用场景。

## 图表类型（25 种）

Bar · Line · Pie · Donut · Area · Scatter · Radar · Treemap · Heatmap · Sankey · 以及另外 15 种。

每种图表类型包含：何时使用、数据要求、无障碍说明与各技术栈的库推荐。

## 与 OpenLogos 的集成

在 Phase 2（产品设计）期间，当 `product-designer` Skill 遇到 GUI 类产品时：

1. `product-designer` 在视觉决策时自动引用 `ui-ux-pro-max`
2. 风格、调色板与排版选择记录在功能规格中
3. 这些选择作为设计约束带入 Phase 3 的代码生成

## 相关 Skill

- [`product-designer`](/zh/skills/product-designer) —— 在 Phase 2 为 GUI 产品调用此 Skill
- [`code-implementor`](/zh/skills/code-implementor) —— 生成前端代码时应用这些设计决策
