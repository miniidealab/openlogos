---
title: code-reviewer
description: 对照完整的 OpenLogos 规格链审查代码合规性。
---

通过对照完整的 OpenLogos 规格链（API YAML、时序图 EX 情况、DB DDL）进行系统性验证来审查 AI 生成的代码，确保代码与设计文档完全一致、覆盖所有异常路径并满足安全要求。

## Phase 与触发条件

- **Phase**：Phase 3 — HOW（实现），Step 4 之后
- **触发条件**：
  - 用户请求代码审查
  - 用户提到「代码审计」「代码审查」
  - AI 刚生成代码，需要质量验证
  - 编排测试失败后需要定位问题

## 前置条件

- API 规格位于 `logos/resources/api/`
- 带 EX 情况的时序图位于 `logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- DB DDL 位于 `logos/resources/database/`
- 待审查的代码可访问

对于非 API 项目，可跳过 API 一致性检查；专注于时序图覆盖度与异常处理。

## 它做了什么

1. **YAML 有效性预检查** —— 继续之前先验证所有 `logos/resources/api/*.yaml` 语法有效
2. **API 一致性审查** —— 逐个端点将代码与 API YAML 对比
3. **异常处理覆盖度** —— 将所有 EX 情况映射到代码中的错误处理
4. **DB 操作审查** —— 验证代码符合 DDL 设计
5. **安全审查** —— 检查认证、授权、输入校验
6. **结构化报告** —— 按严重程度分类输出发现

## 审查维度

### API 一致性

| 检查 | 严重程度 |
|-------|----------|
| 路由路径匹配 YAML `paths` | Critical |
| HTTP 方法匹配 | Critical |
| 请求体读取所有必填字段 | Critical |
| 字段校验（type、format、minLength） | Warning |
| 响应字段与类型匹配 | Critical |
| HTTP 状态码匹配 | Critical |
| 错误响应格式 `{ code, message }` | Warning |

### 异常处理

- 每个 EX 情况都有对应的代码分支
- 返回正确的 HTTP 状态码与错误码
- 没有「被静默吞掉的异常」（空 catch 块）
- 外部服务调用有超时与错误处理
- 代码中存在但时序图中没有的异常处理 → 可能需要更新时序图

### DB 操作

- 表名与列名匹配 DDL（无拼写错误、大小写差异）
- 值类型匹配 DDL 定义（如 INTEGER 金额用分而非元）
- NOT NULL 字段始终有值；UNIQUE 字段有冲突处理
- 多表写入包裹在事务中

### 安全

| 检查 | 严重程度 |
|-------|----------|
| 处理前进行认证验证 | Critical |
| 用户只能访问自己的数据 | Critical |
| 输入校验（类型、长度限制） | Critical |
| 响应中无敏感数据（密码、堆栈跟踪） | Critical |
| 参数化查询（无 SQL 字符串拼接） | Critical |
| 关键端点上的限流 | Warning |

## 报告格式

发现按以下类别分类：

- **Critical** —— 继续前必须修复
- **Warning** —— 建议修复但不阻塞交付
- **Info** —— 供后续改进的建议

每条发现包含：规格来源引用、问题描述与修复建议。

## 产出

审查报告直接在对话中输出（不写入文件），以总结与后续步骤建议结尾。

## 最佳实践

- **一致性优先** —— 大多数生产 bug 源自代码与规格之间的细微差异
- **异常处理是重点** —— 大多数 bug 发生在异常路径
- **审查前先跑测试** —— 用失败的测试用例定位问题，再逐行读代码
- **关注补偿逻辑** —— 多步写入中途失败而无回滚，是最常被遗漏的 Critical 问题

## 相关 Skill

- 上一步：[`code-implementor`](/zh/skills/code-implementor) —— 忠于规格生成代码（Phase 3 Step 4）
- 修复问题：[`change-writer`](/zh/skills/change-writer) —— 为修复创建变更提案
