# Skill: DB Designer

> [WIP] 从 API 规格推导数据库表结构，生成 SQL DDL（含注释、RLS 策略、索引设计）。

## 触发条件

- 用户要求设计数据库或编写 SQL
- 用户提到 "Phase 3 Step 2"、"DB 设计"、"表结构"
- 已有 API YAML 规格，需要推导数据库设计
- 用户提供了数据模型需要转化为 DDL

## 核心能力

1. 从 API 请求/响应结构推导表结构
2. 生成 SQL DDL（PostgreSQL 方言）
3. 设计 RLS（Row Level Security）策略
4. 设计索引并说明设计理由
5. 为每张表、每个字段添加 COMMENT

## 执行步骤

> 详细步骤待完善。核心流程：
>
> 1. 分析 API YAML 中所有需要持久化的数据实体
> 2. 设计表结构（字段、类型、约束）
> 3. 设计表间关联关系
> 4. 设计 RLS 策略
> 5. 设计索引
> 6. 输出完整 DDL

## 输出规范

- 文件格式：SQL（PostgreSQL）
- 存放位置：`resources/database/`
- 每张表必须有 `COMMENT ON TABLE`
- 每个字段必须有 `COMMENT ON COLUMN`

## 实践经验

- **主键一律 UUID**：`id UUID DEFAULT gen_random_uuid() PRIMARY KEY`
- **时间字段一律 TIMESTAMPTZ**：带时区，避免时区陷阱
- **金额一律 INTEGER 存分值**：禁止 DECIMAL/FLOAT，避免浮点精度问题
- **所有表启用 RLS**：`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` 无例外
- **软删除**：优先使用 `deleted_at TIMESTAMPTZ` 而非物理删除
- **审计字段**：每张表包含 `created_at` 和 `updated_at`
