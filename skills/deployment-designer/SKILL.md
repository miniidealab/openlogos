# Skill: Deployment Designer

> 在代码实现前输出完整部署方案：部署拓扑、环境配置、发布命令、数据迁移、回滚策略和部署后冒烟测试方案。该 Skill 是 Phase 3 Step 3 的执行入口。

## 触发条件

- 用户要求设计部署方案、发布方案或上线方案
- 用户提到 “Phase 3 Step 3”、“部署方案”、“deployment plan”
- API / DB 设计完成后，需要进入部署方案设计
- Initial 阶段准备进入测试设计前，`3-technical-plan/3-deployment/` 仍为空

## 前置依赖

1. `logos/resources/prd/3-technical-plan/1-architecture/` 中存在架构概要
2. `logos/resources/prd/3-technical-plan/2-scenario-implementation/` 中存在场景实现文档
3. API / DB 设计已完成，或对应模块在 `skip_phases` 中明确跳过
4. `logos/logos-project.yaml` 可读

## 核心能力

1. 从架构、API、DB 和技术栈中推导部署目标
2. 设计本地 / 测试 / 预发 / 生产环境部署拓扑
3. 明确环境变量、密钥来源、构建命令和发布命令
4. 定义数据迁移、初始化数据和回滚策略
5. 设计部署后检查清单
6. 设计 smoke 测试方案输入，供 `test-writer` 生成 `SMOKE-*` 用例
7. 更新 `logos-project.yaml` 的部署门禁信息

## 执行步骤

### Step 1: 读取上下文

必须读取：

- `logos/logos-project.yaml`
- 架构概要文档
- 场景实现文档
- API 规格（如存在）
- DB DDL（如存在）
- 现有部署方案（如存在）

重点确认：

- 项目是否需要部署
- 目标环境有哪些
- 是否存在远程服务、生产环境、密钥、域名、证书或数据迁移
- smoke 需要覆盖哪些最小链路

### Step 2: 判断部署门禁

默认规则：

- 软件项目默认需要部署方案
- 有运行环境的项目默认需要部署执行和 smoke
- 纯文档、纯规范、无需运行环境的库项目可声明 `deployment_required: false`

若用户选择无需部署，部署方案仍需写明原因和跳过条件。

### Step 3: 输出部署方案

默认文件：

`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`

文档结构：

```markdown
# core-01-deployment-plan

## 一、部署目标

## 二、部署拓扑

## 三、环境变量与密钥

## 四、构建与发布命令

## 五、数据迁移策略

## 六、回滚策略

## 七、部署后检查清单

## 八、冒烟测试方案

## 九、门禁结论
```

### Step 4: 设计 smoke 输入

在部署方案的“冒烟测试方案”中列出必须覆盖的 smoke 检查项：

- 健康检查
- 核心入口
- 数据库迁移
- 静态资源
- 配置与密钥
- 关键链路
- 日志与监控

具体 `SMOKE-*` 用例由 `test-writer` 输出到 `logos/resources/test/smoke/`。

### Step 5: 更新 logos-project.yaml

如模块需要部署，建议写入：

```yaml
deployment_gates:
  core:
    deployment_required: true
    smoke_required: true
    environments:
      - staging
```

并将部署方案加入 `resource_index`。

## 输出规范

- 部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 文档语言遵循项目 locale
- Mermaid 可用于部署拓扑图
- 不执行任何部署命令

## 人类确认点

本 Skill 只设计部署方案，不执行部署。部署执行必须等到：

1. 代码实现完成
2. `openlogos verify` 通过
3. 用户明确授权部署

## 推荐提示词

- `帮我设计部署方案`
- `按 Phase 3 Step 3 输出部署方案`
- `基于当前架构设计 staging 部署和 smoke 方案`
