# S02: 用户登录并管理当日任务 — 测试用例

> 来源场景：S02-login-and-tasks.md
> 关联 API：auth.yaml → login；tasks.yaml → create_task, update_task, update_task_status, delete_task
> 关联 DB：users 表、tasks 表
> 更新时间：2026/04/07

---

## 一、单元测试用例

### 1.1 登录字段校验（来源：auth.yaml → login）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S02-01 | 用户名为空时拒绝登录 | `username: required` | 无 | `username: ""` | 错误：用户名不能为空 |
| UT-S02-02 | 密码为空时拒绝登录 | `password: required` | 无 | `password: ""` | 错误：密码不能为空 |
| UT-S02-03 | 用户名不存在时返回统一错误码 | EX-10.1 | users 表无该用户 | `username: "notexist"` | 错误码 `INVALID_CREDENTIALS` |
| UT-S02-04 | 密码错误时返回统一错误码（不区分用户名/密码错误） | EX-11.1 | users 表有 `username="xiaoli"` | `password: "WrongPass"` | 错误码 `INVALID_CREDENTIALS` |

### 1.2 任务名称字段校验（来源：tasks.yaml → create_task / update_task → name）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S02-05 | 任务名称为空时拒绝创建 | `name: minLength: 1` | 已登录 | `name: ""` | 错误：任务名称不能为空 |
| UT-S02-06 | 任务名称长度恰好 1 字符（下边界合法） | `name: minLength: 1` | 已登录 | `name: "A"` | 校验通过 |
| UT-S02-07 | 任务名称长度恰好 100 字符（上边界合法） | `name: maxLength: 100` | 已登录 | `name: "A" * 100` | 校验通过 |
| UT-S02-08 | 任务名称长度 101 字符（超出上边界） | `name: maxLength: 100` | 已登录 | `name: "A" * 101` | 错误：任务名称不能超过 100 字符 |

### 1.3 任务备注字段校验（来源：tasks.yaml → create_task → note）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S02-09 | 备注为 null 时合法（可选字段） | `note: nullable: true` | 已登录 | `note: null` | 校验通过 |
| UT-S02-10 | 备注长度恰好 500 字符（上边界合法） | `note: maxLength: 500` | 已登录 | `note: "A" * 500` | 校验通过 |
| UT-S02-11 | 备注长度 501 字符（超出上边界） | `note: maxLength: 500` | 已登录 | `note: "A" * 501` | 错误：备注不能超过 500 字符 |

### 1.4 DB 约束（来源：schema.sql → tasks 表）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S02-12 | 任务 done 字段默认值为 0 | `tasks: done DEFAULT 0` | 已登录 | 创建任务不传 done 字段 | `done = 0` |
| UT-S02-13 | 任务 done 字段只接受 0 或 1 | `tasks: done CHECK(done IN (0,1))` | 已登录 | `done: 2` | DB CHECK 约束错误 |
| UT-S02-14 | 任务 user_id 外键约束：引用不存在的用户 | `tasks: user_id FK users.id` | 无 | `user_id: 99999` | DB 外键约束错误 |
| UT-S02-15 | 任务 category_id 可为 NULL | `tasks: category_id nullable` | 已登录 | `category_id: null` | 创建成功，`category_id = null` |
| UT-S02-16 | 删除任务时 WHERE 包含 user_id 防止越权 | Step S02.3c Step 5 安全要求 | 已登录用户 A 和用户 B 各有任务 | 用户 A 尝试删除用户 B 的任务 | 删除失败，`affected_rows = 0` |

### 1.5 update_task_status 字段校验（来源：tasks.yaml → update_task_status）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S02-17 | done=true 标记任务完成 | `update_task_status: done: boolean` | 已有未完成任务 | `{ task_id, done: true }` | DB 中 `done = 1`，`updated_at` 已更新 |
| UT-S02-18 | done=false 取消任务完成 | `update_task_status: done: boolean` | 已有已完成任务 | `{ task_id, done: false }` | DB 中 `done = 0`，`updated_at` 已更新 |

---

## 二、场景测试用例

### 2.1 主路径：登录成功

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S02-01 | 已有账号，登录成功并加载任务列表 | S02.1 Step 1→16 | users 表有 `username="xiaoli"`；tasks 表有 2 条未完成任务 | 1. 调用 `check_has_user` → 2. 返回 `has_user: true` → 3. 渲染登录页 → 4. 输入正确用户名密码 → 5. 调用 `login` → 6. 返回 `{ user_id, username, tasks, categories }` → 7. 写入 Zustand Store → 8. 跳转主界面 | 1. 前端 Zustand Store 中 `currentUser.username = "xiaoli"` 2. `tasks` 数组包含 2 条记录 3. 页面显示任务列表 |

### 2.2 主路径：创建任务

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S02-02 | 创建一条有分类和备注的任务 | S02.2 Step 1→10 | 已登录；categories 表有 `id=1, name="工作"` | 1. 点击"+"按钮 → 2. 输入 `name="完成周报"`, `category_id=1`, `note="本周进展"` → 3. 点击"保存" → 4. 调用 `create_task` | 1. tasks 表新增一条记录，`name="完成周报"`, `category_id=1`, `done=0` 2. Zustand Store `tasks` 数组头部新增该任务 3. 面板关闭，任务卡片出现在列表顶部 |
| ST-S02-03 | 创建一条无分类无备注的任务 | S02.2 Step 1→10 | 已登录 | 1. 输入 `name="买牛奶"`, 不选分类, 不填备注 → 2. 调用 `create_task` | tasks 表新增记录，`category_id=null`, `note=null`, `done=0` |

### 2.3 主路径：完成 / 编辑 / 删除任务

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S02-04 | 标记任务为已完成 | S02.3a Step 1→7 | 已登录；tasks 表有 `id=1, done=0` | 1. 点击任务勾选框 → 2. 调用 `update_task_status({ task_id:1, done:true })` | 1. DB 中 `done=1`，`updated_at` 已更新 2. Zustand Store 中该任务 `done=true` 3. 任务卡片显示删除线，移至"已完成"区域 |
| ST-S02-05 | 取消任务完成状态 | S02.3a Step 1→7 | 已登录；tasks 表有 `id=1, done=1` | 1. 点击已完成任务勾选框 → 2. 调用 `update_task_status({ task_id:1, done:false })` | DB 中 `done=0`；任务移回未完成列表 |
| ST-S02-06 | 编辑任务名称和备注 | S02.3b Step 1→10 | 已登录；tasks 表有 `id=1, name="旧名称"` | 1. 点击任务卡片 → 2. 修改 `name="新名称"`, `note="新备注"` → 3. 调用 `update_task` | 1. DB 中 `name="新名称"`, `note="新备注"`, `updated_at` 已更新 2. 任务卡片显示新内容 |
| ST-S02-07 | 删除任务（含确认对话框） | S02.3c Step 1→9 | 已登录；tasks 表有 `id=1` | 1. 悬停任务卡片 → 2. 点击删除图标 → 3. 确认对话框出现 → 4. 点击"确认删除" → 5. 调用 `delete_task({ task_id:1 })` | 1. tasks 表中 `id=1` 记录已删除 2. Zustand Store `tasks` 数组中该任务已移除 3. 任务卡片从界面消失 |
| ST-S02-08 | 取消删除任务 | S02.3c Step 1→2 | 已登录；tasks 表有 `id=1` | 1. 点击删除图标 → 2. 确认对话框出现 → 3. 点击"取消" | 1. 不调用 `delete_task` 2. tasks 表记录不变 3. 对话框关闭，任务卡片保留 |

### 2.4 异常路径

| ID | 描述 | 覆盖 EX | 前置条件 | 触发条件 | 预期结果 |
|----|------|--------|---------|---------|---------|
| ST-S02-09 | 登录时用户名不存在 | EX-10.1 (S02.1) | users 表无该用户 | 调用 `login({ username:"notexist", password:"Pass1234" })` | 1. 返回错误码 `INVALID_CREDENTIALS` 2. 前端显示"用户名或密码错误" 3. 密码框清空，不跳转页面 |
| ST-S02-10 | 登录时密码错误 | EX-11.1 (S02.1) | users 表有 `username="xiaoli"` | 调用 `login({ username:"xiaoli", password:"WrongPass" })` | 1. 返回错误码 `INVALID_CREDENTIALS` 2. 前端显示"用户名或密码错误" 3. 密码框清空，不跳转页面 |
| ST-S02-11 | 创建任务时名称为空，前端拦截 | EX-4.1 (S02.2) | 已登录，新建任务面板已打开 | 任务名称为空，点击"保存" | 1. 不调用 `create_task` 2. 名称输入框下方显示"任务名称不能为空" 3. 面板保持打开 |
| ST-S02-12 | 创建任务时 DB 写入失败 | EX-6.1 (S02.2) | 已登录，模拟 DB INSERT 失败 | 调用 `create_task`，DB 层抛出写入异常 | 1. 返回错误码 `DB_WRITE_ERROR` 2. 面板内显示"保存失败，请重试" 3. tasks 表无新增记录 |
| ST-S02-13 | 删除任务时任务已不存在（并发场景） | EX-6.1 (S02.3c) | 已登录，任务已被其他操作删除 | 调用 `delete_task({ task_id:999 })`，DB 返回 `affected_rows=0` | 1. 返回错误码 `TASK_NOT_FOUND` 2. 前端静默处理，从 Store 中移除该任务 3. 最终状态一致 |

---

## 三、覆盖度校验

- [x] Phase 1 正常验收条件（登录）：ST-S02-01 覆盖
- [x] Phase 1 正常验收条件（创建任务）：ST-S02-02 / ST-S02-03 覆盖
- [x] Phase 1 正常验收条件（完成/编辑/删除任务）：ST-S02-04 ~ ST-S02-07 覆盖
- [x] Phase 1 异常验收条件（用户名/密码错误）：ST-S02-09 / ST-S02-10 覆盖
- [x] EX-10.1 / EX-11.1（登录失败）：ST-S02-09 / ST-S02-10 覆盖
- [x] EX-4.1（任务名称为空）：ST-S02-11 覆盖
- [x] EX-6.1（任务写入/删除失败）：ST-S02-12 / ST-S02-13 覆盖
- [x] API `required` 字段（login: username, password）：UT-S02-01 / UT-S02-02 覆盖
- [x] API `required` 字段（create_task: name）：UT-S02-05 覆盖
- [x] DB `done CHECK(0,1)` 约束：UT-S02-13 覆盖
- [x] DB `user_id FK` 约束：UT-S02-14 覆盖
- [x] 越权删除防护：UT-S02-16 覆盖

---

## 四、验收条件追溯

| AC ID | 验收条件（来源：Phase 1 S02） | 覆盖用例 |
|-------|---------------------------|---------|
| S02-AC-01 | 正常：已有账号，输入正确用户名密码，登录成功跳转主界面，显示任务列表 | ST-S02-01 |
| S02-AC-02 | 正常：点击"+"创建任务，填写名称（必填）、分类（可选）、备注（可选），保存后出现在列表顶部 | ST-S02-02, ST-S02-03 |
| S02-AC-03 | 正常：点击任务勾选框，任务标记为完成，显示删除线并移至已完成区域 | ST-S02-04 |
| S02-AC-04 | 正常：点击已完成任务勾选框，取消完成状态，任务移回未完成列表 | ST-S02-05 |
| S02-AC-05 | 正常：点击任务卡片，编辑内容后保存，卡片显示更新后内容 | ST-S02-06 |
| S02-AC-06 | 正常：点击删除图标，确认后任务从列表消失 | ST-S02-07 |
| S02-AC-07 | 正常：点击取消，任务不被删除 | ST-S02-08 |
| S02-AC-08 | 异常：用户名或密码错误，显示"用户名或密码错误"，密码框清空 | ST-S02-09, ST-S02-10, UT-S02-03, UT-S02-04 |
| S02-AC-09 | 异常：任务名称为空，显示"任务名称不能为空"，请求不提交 | ST-S02-11, UT-S02-05 |
