# 任务拆解：SQLite 结构化注释约定

## Phase 1：Skill 更新（db-designer）

### T1-1：更新中文 Skill
- 文件：`skills/db-designer/SKILL.md`
- 变更点：
  - Step 3 的 SQLite 示例改用 `-- @comment` 格式
  - Step 7 输出规范添加 SQLite 注释约定说明
  - 输出规范中补充 SQLite 行（现有只有 PostgreSQL 和 MySQL）
  - 方言差异速查表增加 SQLite 列，含注释语法行
- 状态：☐

### T1-2：更新英文 Skill
- 文件：`skills/db-designer/SKILL.en.md`
- 变更点：与 T1-1 对应的英文版
- 状态：☐

### T1-3：重新构建 Plugin Skills
- 命令：`bash scripts/build-plugin-skills.sh`
- 将更新后的 Skill 同步到 `plugin/skills/db-designer/`
- 状态：☐

## Phase 2：CLI 解析器

### T2-1：实现 `parseSqlComments()` 函数
- 文件：`cli/src/lib/sql-comments.ts`（新建）
- 功能：
  - 输入：SQL 文件内容（字符串）
  - 输出：`SchemaMetadata` 对象（表名、表注释、字段名、字段注释）
  - 解析规则：见 proposal.md 解析规则章节
- 状态：☐

### T2-2：编写单元测试
- 文件：`cli/src/lib/__tests__/sql-comments.test.ts`（新建）
- 覆盖场景：
  - 基本字段注释解析
  - 多行 `-- @comment` 拼接
  - 表注释解析
  - 空行断开关联
  - 约束行（FOREIGN KEY）不消费注释
  - 无注释的字段返回 `undefined`
  - 混合有注释和无注释的字段
  - 多张表解析
- 状态：☐

### T2-3：导出公共 API
- 文件：`cli/src/index.ts` 或新建 `cli/src/lib/index.ts`
- 将 `parseSqlComments` 作为 CLI 工具的可编程 API 导出（供未来命令使用）
- 状态：☐

## Phase 3：验证

### T3-1：用 taskflow-api 的 schema.sql 做端到端验证
- 将 `examples/taskflow-api/logos/resources/database/schema.sql` 改为新格式
- 运行解析器确认输出正确
- 状态：☐

### T3-2：运行全量测试
- `cd cli && npm test`
- 确认无回归
- 状态：☐

## 依赖关系

```
T1-1 → T1-2 → T1-3 (Skill 更新流水线)
T2-1 → T2-2 → T2-3 (CLI 解析器流水线)
T1-3 + T2-3 → T3-1 → T3-2 (验证)
```

两条流水线可并行推进。
