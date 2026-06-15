---
title: prd-writer
description: 编写带 GIVEN/WHEN/THEN 验收标准的场景驱动需求文档。
---

协助编写场景驱动的需求文档 —— 从用户痛点出发，识别核心业务场景，并为每个场景定义 GIVEN/WHEN/THEN 验收标准。场景编号会贯穿后续所有阶段。

## Phase 与触发条件

- **Phase**：Phase 1 — WHY（需求）
- **触发条件**：
  - 用户请求编写需求文档、PRD，或讨论产品定位
  - 用户提到「Phase 1」「需求层」或「WHY」
  - 项目处于需求分析阶段

## 它做了什么

1. 引导产品定位与目标用户画像
2. 提取带因果链的用户痛点（`P01`、`P02`……）
3. 从痛点中识别并定义业务场景（`S01`、`S02`……）
4. 为每个场景编写 GIVEN/WHEN/THEN 验收标准
5. 为场景排定优先级并识别约束
6. 生成完整的需求文档

## 执行步骤

### Step 1：理解产品定位

确认一句话定位、目标用户画像与核心目标。

### Step 2：提取用户痛点

每个痛点都有一条因果链：因为[原因] → 导致[痛点] → 造成[后果]。痛点编号为 `P01`、`P02`……以便场景溯源。

### Step 3：识别并定义场景

场景是**完整的用户行为路径** —— 而非单次 API 调用。每个场景描述由谁触发、经过哪些步骤、达成什么业务结果。场景编号为 `S01`、`S02`……且该编号会贯穿 Phase 2 与 Phase 3。

#### 场景粒度自检

每个场景在继续之前必须通过 4 项检验：

1. **单 API 检验**：能用 1 次 API 调用完成吗？ → 不是场景，合并它
2. **CRUD 检验**：是否只是对单个实体的增/查/改/删？ → 粒度过细，按用户目标重新组织
3. **业务价值检验**：用户完成后是否获得真正的价值？ → 如果只是「写入/读取了数据」，合并它
4. **步骤数检验**：主路径是否包含 ≥3 个用户可感知的步骤？ → 更少则过细

### Step 4：编写验收标准

每个 P0/P1 场景都必须有 ≥1 个正常 + ≥1 个异常验收标准：

```markdown
##### Normal: Complete registration flow
- **GIVEN** the user has not registered and is on the registration page
- **WHEN** the user fills in a valid email and password (≥8 chars) and clicks "Sign Up"
- **THEN** the system creates an account, sends a verification email

##### Exception: Email already registered
- **GIVEN** the email test@example.com is already registered
- **WHEN** the user attempts to register with that email
- **THEN** the page displays "This email is already registered"
```

### Step 5：识别约束与边界

技术约束、资源约束，以及本阶段的「不做」清单。

### Step 6：组装文档

标准结构：产品背景 → 痛点 → 场景总览 → 场景详情 → 约束。

## 产出

| 文件 | 位置 |
|------|----------|
| 需求文档 | `logos/resources/prd/1-product-requirements/` |
| 命名规范 | `{sequence}-{english-name}.md` |

## 最佳实践

- **场景 ≠ 功能 ≠ API** —— 场景是一条完整的用户行为路径；单个功能可能包含多个场景
- **场景编号一旦分配便永不复用** —— 即使被废弃的场景也保留其编号
- **如果写不出 GIVEN/WHEN/THEN，说明该场景尚未想清楚**
- **「不做」清单最难写** —— 克制是最重要的技能

## 相关 Skill

- 上一步：[`project-init`](/zh/skills/project-init) —— 初始化项目
- 下一步：[`product-designer`](/zh/skills/product-designer) —— 创建产品设计规格
