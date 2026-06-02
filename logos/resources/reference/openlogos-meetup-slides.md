---
theme: default
background: https://cover.sli.dev
title: AI 时代的软件研发方法论：用 OpenLogos 终结 Vibe Coding
info: |
  OpenLogos Meetup 分享
  openlogos.ai
class: text-center
highlighter: shiki
drawings:
  persist: false
transition: slide-left
mdc: true
---

# AI 时代的软件研发方法论

## 用 OpenLogos 终结 Vibe Coding

<div class="pt-12">
  <span class="text-gray-400">openlogos.ai</span>
</div>

---
layout: center
---

# 先问个问题

你最近一次让 AI 写代码，是这样开始的吗？

<v-click>

```
"帮我写个用户登录功能"
```

</v-click>

<v-click>

<div class="mt-8 text-2xl">
然后祈祷它猜对你的意思 🙏
</div>

</v-click>

---
layout: two-cols
---

# 这就是 Vibe Coding

<v-clicks>

- AI 生成代码很快
- 但需求是 AI 猜的
- 文档？没有
- 下次改动？全靠记忆
- 出了 Bug？不知道谁改的

</v-clicks>

::right::

<div class="pl-8 pt-4">

```
用户: 帮我加个权限控制

AI: 好的！我来帮你加...
    [生成了 200 行代码]

用户: 这不是我要的...

AI: 明白了！我来修改...
    [又生成了 150 行代码]

用户: 还是不对...
```

<v-click>

<div class="mt-6 text-orange-400 text-lg font-bold">
项目越大，越失控
</div>

</v-click>

</div>

---
layout: center
---

# 根本原因

<div class="text-3xl mt-8 mb-8">
不是 prompt 写得不好
</div>

<v-click>

<div class="text-xl text-gray-400">
而是 AI 根本没有足够的上下文来做判断
</div>

</v-click>

<v-clicks>

<div class="mt-12 grid grid-cols-3 gap-8 text-center">
  <div class="border border-red-400 rounded p-4">
    <div class="text-red-400 text-4xl mb-2">❓</div>
    <div>为什么要做<br><span class="text-gray-400 text-sm">需求背景</span></div>
  </div>
  <div class="border border-red-400 rounded p-4">
    <div class="text-red-400 text-4xl mb-2">❓</div>
    <div>做成什么样<br><span class="text-gray-400 text-sm">产品设计</span></div>
  </div>
  <div class="border border-red-400 rounded p-4">
    <div class="text-red-400 text-4xl mb-2">❓</div>
    <div>怎么验证对不对<br><span class="text-gray-400 text-sm">测试规格</span></div>
  </div>
</div>

</v-clicks>

---
layout: center
---

# 解法

<div class="text-5xl font-bold mt-8 mb-4">
文档即上下文
</div>

<v-click>

<div class="text-xl text-gray-400 mt-4">
把研发过程中该有的文档补全<br>
AI 就有了判断依据
</div>

</v-click>

<v-click>

<div class="mt-12 text-2xl">
这就是 <span class="text-green-400 font-bold">OpenLogos</span> 的核心思路
</div>

</v-click>

---

# 什么是 OpenLogos

<div class="text-lg text-gray-400 mb-8">一套面向 AI 时代的开源软件研发方法论</div>

<v-clicks>

<div class="grid grid-cols-2 gap-6">
  <div class="border border-gray-600 rounded-lg p-6">
    <div class="text-2xl mb-2">🎯 核心原则</div>
    <div class="text-lg font-bold text-green-400">AI 负责执行，人负责判断</div>
    <div class="text-gray-400 mt-2 text-sm">AI 是执行者，不是决策者</div>
  </div>
  <div class="border border-gray-600 rounded-lg p-6">
    <div class="text-2xl mb-2">📐 方法论骨架</div>
    <div class="text-lg font-bold text-blue-400">WHY → WHAT → HOW</div>
    <div class="text-gray-400 mt-2 text-sm">三层推进，层层有产出物</div>
  </div>
  <div class="border border-gray-600 rounded-lg p-6">
    <div class="text-2xl mb-2">🔧 工具链</div>
    <div class="text-lg font-bold text-yellow-400">CLI + Skills + 规范</div>
    <div class="text-gray-400 mt-2 text-sm">约束 AI 行为的具体机制</div>
  </div>
  <div class="border border-gray-600 rounded-lg p-6">
    <div class="text-2xl mb-2">🔄 变更管理</div>
    <div class="text-lg font-bold text-purple-400">提案 → 合并 → 验收</div>
    <div class="text-gray-400 mt-2 text-sm">每次迭代有据可查</div>
  </div>
</div>

</v-clicks>

---
layout: center
---

# WHY → WHAT → HOW

<div class="mt-8">

```
Phase 1: WHY  ── 需求文档
                  场景 + 验收条件 (GIVEN/WHEN/THEN)
                  ↓
Phase 2: WHAT ── 产品设计
                  功能规格 + HTML 原型
                  ↓
Phase 3: HOW  ── 架构 → 时序图 → API/DB
                  → 测试用例 → 代码 → 验收
```

</div>

<v-click>

<div class="mt-8 text-center">
<span class="text-gray-400">每层的产出物，是下一层的输入</span><br>
<span class="text-green-400 font-bold">上下文是累积的，不是每次从零猜测</span>
</div>

</v-click>

---

# 场景驱动：一条线贯穿

以「用户注册」为例，看一个场景 S01 如何贯穿全流程

<div class="mt-6 overflow-x-auto">

| 阶段 | 产出 | AI 做什么 |
|------|------|----------|
| Phase 1 | S01 验收条件：GIVEN 邮箱格式正确 WHEN 提交注册... | prd-writer Skill |
| Phase 2 | 注册页面规格 + 原型 | product-designer Skill |
| Phase 3-1 | S01 时序图：Client → Server → DB | scenario-architect Skill |
| Phase 3-2 | POST /users API 规格 + users 表 DDL | api-designer + db-designer |
| Phase 3-4 | UT-S01-01 ~ UT-S01-06 测试用例 | test-writer Skill |
| Phase 3-5 | 业务代码 + 测试代码 | code-implementor Skill |
| Gate 3.6 | `openlogos verify` → PASS | 自动验收 |

</div>

<v-click>

<div class="mt-4 text-center text-green-400 font-bold">
同一个场景 ID S01，从需求到验收，全程可追溯
</div>

</v-click>

---
layout: center
---

# 质量门禁

<div class="text-gray-400 mb-8">每个阶段结束有自动化检查，不通过不能进下一阶段</div>

<div class="grid grid-cols-3 gap-4 text-center">
  <div class="border border-gray-600 rounded p-4">
    <div class="text-3xl mb-2">Gate 1</div>
    <div class="text-sm text-gray-400">所有 P0 场景<br>都有验收条件</div>
  </div>
  <div class="border border-gray-600 rounded p-4">
    <div class="text-3xl mb-2">Gate 2</div>
    <div class="text-sm text-gray-400">产品设计覆盖<br>所有核心场景</div>
  </div>
  <div class="border border-yellow-400 rounded p-4 bg-yellow-400/10">
    <div class="text-3xl mb-2">Gate 3.6</div>
    <div class="text-sm text-yellow-400 font-bold">openlogos verify<br>测试 100% 通过</div>
  </div>
</div>

<v-click>

<div class="mt-8">

```bash
$ openlogos verify

  定义用例：  131 个（71 UT + 60 ST）
  执行用例：  444 个
  ✅ 通过：   444
  覆盖度：   100%

✅ Gate 3.6：PASS
```

</div>

</v-click>

---

# 变更管理：launched 之后怎么迭代

项目上线后，每次修改都走提案流程，**变更可追溯**

<div class="mt-6">

```
openlogos change add-payment-feature
        ↓
    填写 proposal.md（为什么改、改什么、影响范围）
        ↓
    产出 delta 文件（变更的规格增量）
        ↓
    openlogos merge   ← 人类确认点
        ↓
    实现代码 + 测试
        ↓
    openlogos verify  ← 人类确认点
        ↓
    openlogos archive ← 变更存档，全程可追溯
```

</div>

---
layout: two-cols
---

# 我们踩的坑

## AI 不按规矩来

<v-clicks>

- CLAUDE.md 写了变更管理规则
- SessionStart hook 每次注入提醒
- AI 表示：「知道了」

<div class="mt-4 text-orange-400">然后继续直接改代码 🙃</div>

</v-clicks>

<v-click>

<div class="mt-8">

### 根本原因

提醒 ≠ 约束

AI 可以「无视」文字规则

</div>

</v-click>

::right::

<div class="pl-8">

<v-click>

### 解法：PreToolUse Hook

```bash
# .claude/settings.json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit|Write|Bash",
      "hooks": [{
        "type": "command",
        "command": ".claude/openlogos/bin/guard-check"
      }]
    }]
  }
}
```

</v-click>

<v-click>

```
# 没有提案时，AI 想改文件：

⛔ 变更管理拦截
项目处于 launched 生命周期，
但没有活跃的变更提案。

请先运行 openlogos change <slug>
```

<div class="text-green-400 font-bold mt-4">从「提醒」升级为「拦截」</div>

</v-click>

</div>

---

# OpenLogos 工具链

<div class="grid grid-cols-3 gap-6 mt-6">

<div>

### CLI 命令

```bash
openlogos init      # 新项目
openlogos adopt     # 已有项目
openlogos change    # 创建提案
openlogos merge     # 合并规格
openlogos verify    # 验收测试
openlogos smoke     # 部署验证
openlogos status    # 查看进度
```

</div>

<div>

### AI Skills（16 个）

```
prd-writer
product-designer
architecture-designer
scenario-architect
api-designer
db-designer
deployment-designer
test-writer
code-implementor
change-writer
...
```

</div>

<div>

### 规范文档

```
spec/workflow.md
spec/change-management.md
spec/pretooluse-guard.md
spec/test-results.md
spec/directory-convention.md
...
```

<div class="mt-4 text-gray-400 text-sm">
AI 的行为边界<br>都写在这里
</div>

</div>

</div>

---
layout: two-cols
---

# 上手有多快

### 新项目

```bash
npm install -g @miniidealab/openlogos

openlogos init my-project
# 选择语言 + AI 工具
# 目录结构、Skills、规范
# 全部自动生成

# 然后告诉 AI：
# "帮我写需求文档"
```

<div class="mt-4 text-green-400">从 Phase 1 开始，规规矩矩推进</div>

::right::

<div class="pl-8">

### 已有项目

```bash
# 项目根目录执行
openlogos adopt
# 选择语言 + AI 工具
# lifecycle 直接 launched
# 变更管理立即生效

# 然后：
openlogos change add-baseline-docs
# 逐步补充文档基线
```

<div class="mt-4 text-green-400">不打断现有开发节奏<br>按迭代节奏逐步补文档</div>

</div>

---
layout: center
---

# 你能带走什么

<div class="grid grid-cols-2 gap-8 mt-8 text-left">

<v-clicks>

<div class="border border-green-400/50 rounded-lg p-6">
  <div class="text-green-400 font-bold text-lg mb-2">🎯 理解根本原因</div>
  <div class="text-gray-300">Vibe Coding 的问题不是 prompt 不好，<br>而是 AI 缺少判断所需的上下文</div>
</div>

<div class="border border-blue-400/50 rounded-lg p-6">
  <div class="text-blue-400 font-bold text-lg mb-2">📐 三层模型</div>
  <div class="text-gray-300">每个阶段该产出什么<br>AI 该做什么、人该确认什么</div>
</div>

<div class="border border-yellow-400/50 rounded-lg p-6">
  <div class="text-yellow-400 font-bold text-lg mb-2">🔒 约束 AI 行为</div>
  <div class="text-gray-300">从「文字规则」升级到「工具拦截」<br>让 AI 物理上无法越界</div>
</div>

<div class="border border-purple-400/50 rounded-lg p-6">
  <div class="text-purple-400 font-bold text-lg mb-2">🚀 立即落地</div>
  <div class="text-gray-300">两行命令就能接入<br>新项目 / 已有项目都可以</div>
</div>

</v-clicks>

</div>

---
layout: center
class: text-center
---

# 开始

<div class="mt-8">

```bash
npm install -g @miniidealab/openlogos
openlogos adopt   # 已有项目，两分钟接入
```

</div>

<div class="mt-12 grid grid-cols-3 gap-8 text-center">
  <div>
    <div class="text-gray-400 text-sm mb-1">官网</div>
    <div class="font-bold">openlogos.ai</div>
  </div>
  <div>
    <div class="text-gray-400 text-sm mb-1">GitHub</div>
    <div class="font-bold">miniidealab/openlogos</div>
  </div>
  <div>
    <div class="text-gray-400 text-sm mb-1">npm</div>
    <div class="font-bold">@miniidealab/openlogos</div>
  </div>
</div>

<div class="mt-12 text-4xl font-bold">
Q & A
</div>

---
layout: center
---

# 附：Slidev 使用说明

```bash
# 安装 slidev
npm install -g @slidev/cli

# 在 logos/resources/reference/ 目录下运行
cd logos/resources/reference
slidev openlogos-meetup-slides.md

# 导出 PDF
slidev export openlogos-meetup-slides.md --format pdf

# 导出静态 HTML
slidev build openlogos-meetup-slides.md
```

> 主题可选：`default` / `seriph` / `apple-basic` / `bricks`
> 修改第一行的 `theme: default` 即可切换
