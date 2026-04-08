# S03: 用户按分类整理任务 — 测试用例

> 来源场景：S03-category-management.md
> 关联 API：categories.yaml → create_category, delete_category
> 关联 DB：categories 表、tasks 表
> 更新时间：2026/04/07

---

## 一、单元测试用例

### 1.1 分类名称字段校验（来源：categories.yaml → create_category → name）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S03-01 | 分类名称为空时拒绝创建 | `name: minLength: 1` | 已登录 | `name: ""` | 错误：分类名称不能为空 |
| UT-S03-02 | 分类名称长度恰好 1 字符（下边界合法） | `name: minLength: 1` | 已登录 | `name: "A"` | 校验通过 |
| UT-S03-03 | 分类名称长度恰好 20 字符（上边界合法） | `name: maxLength: 20` | 已登录 | `name: "A" * 20` | 校验通过 |
| UT-S03-04 | 分类名称长度 21 字符（超出上边界） | `name: maxLength: 20` | 已登录 | `name: "A" * 21` | 错误：分类名称不能超过 20 字符 |

### 1.2 DB 约束（来源：schema.sql → categories 表）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S03-05 | 同一用户下分类名唯一约束 | `categories: UNIQUE(user_id, name)` | 已登录；categories 表已有 `user_id=1, name="工作"` | `create_category({ user_id:1, name:"工作" })` | 错误码 `CATEGORY_EXISTS` |
| UT-S03-06 | 不同用户可以有同名分类 | `categories: UNIQUE(user_id, name)` | 用户 A 已有分类 `name="工作"` | 用户 B 创建 `name="工作"` | 创建成功，不违反约束 |
| UT-S03-07 | 分类 user_id 外键约束：引用不存在的用户 | `categories: user_id FK users.id` | 无 | `user_id: 99999` | DB 外键约束错误 |
| UT-S03-08 | 删除分类后关联任务的 category_id 自动置 NULL | `tasks: category_id ON DELETE SET NULL` | categories 表有 `id=1`；tasks 表有 2 条 `category_id=1` 的任务 | 删除 `category_id=1` | tasks 表中 2 条记录的 `category_id` 变为 NULL，任务记录保留 |
| UT-S03-09 | 删除用户时其下所有分类跟随删除 | `categories: user_id ON DELETE CASCADE` | users 表有 `id=1`；categories 表有 3 条 `user_id=1` 的分类 | 删除 `user_id=1` | categories 表中 3 条记录全部删除 |

### 1.3 客户端重复检测（来源：S03.1 Step 4 业务规则）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S03-10 | 前端 Zustand Store 中已有同名分类时拦截 | EX-4.2 客户端预检 | Zustand Store `categories` 中已有 `name="工作"` | 输入 `name="工作"` 点击"添加" | 前端显示"该分类名称已存在"；不调用 `create_category` |
| UT-S03-11 | 前端 Zustand Store 中无同名分类时通过 | EX-4.2 客户端预检 | Zustand Store `categories` 中无 `name="生活"` | 输入 `name="生活"` | 校验通过，调用 `create_category` |

---

## 二、场景测试用例

### 2.1 主路径：创建分类

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S03-01 | 成功创建一个新分类 | S03.1 Step 1→10 | 已登录；categories 表无 `name="工作"` | 1. 点击"管理分类" → 2. 输入 `name="工作"` → 3. 点击"添加" → 4. 调用 `create_category({ user_id, name:"工作" })` | 1. categories 表新增一条记录，`name="工作"` 2. Zustand Store `categories` 数组新增该分类 3. 弹窗列表、侧边栏、任务面板分类下拉同步更新 |

### 2.2 主路径：按分类筛选任务（纯前端）

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S03-02 | 点击分类，任务列表按分类过滤 | S03.2 Step 1→3 | 已登录；Zustand Store 有 3 条任务，其中 2 条 `category_id=1`（工作），1 条 `category_id=null` | 点击侧边栏"工作"分类 | 1. Zustand Store `currentCategory = 1` 2. 任务列表只显示 2 条 `category_id=1` 的任务 3. 侧边栏"工作"高亮 4. 不调用任何 Tauri 命令 |
| ST-S03-03 | 点击"全部"，恢复显示所有任务 | S03.2 Step 4→6 | 已登录；当前筛选"工作"分类 | 点击侧边栏"全部" | 1. Zustand Store `currentCategory = null` 2. 任务列表显示全部 3 条任务 3. "全部"高亮 |

### 2.3 主路径：删除分类

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S03-04 | 删除无任务的分类 | S03.3 Step 1→10 | 已登录；categories 表有 `id=1, name="工作"`；该分类下无任务 | 1. 点击分类"×"按钮 → 2. 确认对话框显示"确认删除分类？" → 3. 点击"确认" → 4. 调用 `delete_category({ category_id:1 })` | 1. categories 表中 `id=1` 记录已删除 2. Zustand Store `categories` 数组中该分类已移除 3. 侧边栏和弹窗列表更新 |
| ST-S03-05 | 删除有任务的分类，任务变为无分类 | S03.3 Step 1→10 | 已登录；categories 表有 `id=1`；tasks 表有 2 条 `category_id=1` 的任务 | 1. 点击分类"×"按钮 → 2. 确认对话框显示"该分类下有 2 个任务，删除后这些任务将变为未分类，是否继续？" → 3. 点击"确认" → 4. 调用 `delete_category({ category_id:1 })` | 1. categories 表中 `id=1` 记录已删除 2. tasks 表中 2 条任务的 `category_id` 变为 NULL（DB ON DELETE SET NULL） 3. Zustand Store 中这 2 条任务的 `category_id` 置为 null 4. 若当前正在筛选该分类，自动切换回"全部" |
| ST-S03-06 | 取消删除分类 | S03.3 Step 1→2 | 已登录；categories 表有 `id=1` | 1. 点击分类"×"按钮 → 2. 确认对话框出现 → 3. 点击"取消" | 1. 不调用 `delete_category` 2. categories 表记录不变 3. 对话框关闭 |

### 2.4 异常路径

| ID | 描述 | 覆盖 EX | 前置条件 | 触发条件 | 预期结果 |
|----|------|--------|---------|---------|---------|
| ST-S03-07 | 分类名称为空，前端拦截 | EX-4.1 (S03.1) | 已登录，分类管理弹窗已打开 | 输入框为空，点击"添加" | 1. 不调用 `create_category` 2. 输入框下方显示"分类名称不能为空" |
| ST-S03-08 | 分类名称重复，前端拦截 | EX-4.2 (S03.1) | 已登录；Zustand Store 中已有 `name="工作"` | 输入 `name="工作"`，点击"添加" | 1. 不调用 `create_category` 2. 显示"该分类名称已存在" |
| ST-S03-09 | 分类名称重复，DB 层兜底拦截 | EX-6.1 (S03.1) | 已登录；DB 中已有 `user_id=1, name="工作"`（客户端 Store 未同步） | 调用 `create_category({ user_id:1, name:"工作" })` | 1. 返回错误码 `CATEGORY_EXISTS` 2. 前端显示"该分类名称已存在" 3. categories 表无新增记录 |
| ST-S03-10 | 删除不存在的分类（并发场景） | EX-6.1 (S03.3) | 分类已被其他操作删除 | 调用 `delete_category({ category_id:999 })`，DB 返回 `affected_rows=0` | 1. 返回错误码 `CATEGORY_NOT_FOUND` 2. 前端静默处理，从 Store 中移除该分类 3. 最终状态一致 |

---

## 三、覆盖度校验

- [x] Phase 1 正常验收条件（创建分类）：ST-S03-01 覆盖
- [x] Phase 1 正常验收条件（按分类筛选）：ST-S03-02 / ST-S03-03 覆盖
- [x] Phase 1 正常验收条件（删除分类）：ST-S03-04 / ST-S03-05 覆盖
- [x] Phase 1 异常验收条件（分类名称为空）：ST-S03-07 覆盖
- [x] Phase 1 异常验收条件（分类名称重复）：ST-S03-08 / ST-S03-09 覆盖
- [x] EX-4.1（名称为空）：ST-S03-07 覆盖
- [x] EX-4.2（名称重复，客户端）：ST-S03-08 覆盖
- [x] EX-6.1（DB 唯一约束）：ST-S03-09 覆盖
- [x] EX-6.1（删除不存在分类）：ST-S03-10 覆盖
- [x] API `required` 字段（create_category: user_id, name）：UT-S03-01 覆盖
- [x] DB `UNIQUE(user_id, name)` 约束：UT-S03-05 / UT-S03-06 覆盖
- [x] DB `ON DELETE SET NULL`（分类删除后任务保留）：UT-S03-08 / ST-S03-05 覆盖
- [x] 筛选为纯前端操作（无 Tauri 命令调用）：ST-S03-02 / ST-S03-03 覆盖

---

## 四、验收条件追溯

| AC ID | 验收条件（来源：Phase 1 S03） | 覆盖用例 |
|-------|---------------------------|---------|
| S03-AC-01 | 正常：创建新分类，分类出现在侧边栏和任务面板下拉中 | ST-S03-01 |
| S03-AC-02 | 正常：点击分类，任务列表只显示该分类下的任务 | ST-S03-02 |
| S03-AC-03 | 正常：点击"全部"，恢复显示所有任务 | ST-S03-03 |
| S03-AC-04 | 正常：删除无任务的分类，分类从列表消失 | ST-S03-04 |
| S03-AC-05 | 正常：删除有任务的分类，任务变为无分类，任务本身保留 | ST-S03-05, UT-S03-08 |
| S03-AC-06 | 正常：取消删除，分类保留 | ST-S03-06 |
| S03-AC-07 | 异常：分类名称为空，显示"分类名称不能为空" | ST-S03-07, UT-S03-01 |
| S03-AC-08 | 异常：分类名称已存在，显示"该分类名称已存在" | ST-S03-08, ST-S03-09, UT-S03-05 |
