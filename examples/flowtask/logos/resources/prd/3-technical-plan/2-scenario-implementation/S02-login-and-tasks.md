# S02: 用户登录并管理当日任务 — 时序图

> Phase 1 优先级：P0
> 涉及页面：登录页 → 任务主界面（含任务面板）
> 参与方：用户 / React 前端 / Tauri Rust 命令层 / SQLite

本场景包含三个子场景：

- **S02.1** 用户登录
- **S02.2** 创建任务
- **S02.3** 完成 / 编辑 / 删除任务

---

## S02.1: 用户登录

### 时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as React 前端
    participant BE as Tauri Commands (Rust)
    participant DB as SQLite

    U->>FE: Step 1: 打开应用 — 触发应用启动
    FE->>BE: Step 2: invoke('check_has_user') — 查询本地是否存在账号
    BE->>DB: Step 3: SELECT COUNT(*) FROM users — 检查用户表
    DB-->>BE: Step 4: 返回 count > 0
    BE-->>FE: Step 5: 返回 { has_user: true }
    FE-->>U: Step 6: 渲染登录页面

    U->>FE: Step 7: 填写用户名和密码，点击"登录"
    FE->>BE: Step 8: invoke('login', { username, password }) — 发起登录命令
    BE->>DB: Step 9: SELECT id, username, password FROM users WHERE username = ? — 查询用户
    DB-->>BE: Step 10: 返回用户记录（含 password hash）
    Note over BE: 用户名不存在 → 见 EX-10.1

    BE->>BE: Step 11: bcrypt::verify(password, hash) — 验证密码
    Note over BE: 密码不匹配 → 见 EX-11.1

    BE->>DB: Step 12: SELECT id, name, category_id, note, done FROM tasks WHERE user_id = ? AND done = 0 — 加载未完成任务列表
    DB-->>BE: Step 13: 返回任务列表
    BE-->>FE: Step 14: 返回 { user_id, username, tasks }
    FE->>FE: Step 15: 写入 Zustand Store { currentUser, tasks } — 建立会话并初始化状态
    FE-->>U: Step 16: 跳转任务主界面，显示未完成任务列表
```

### 步骤说明

1. **用户**打开 FlowTask 桌面应用。
2. **React 前端**调用 `invoke('check_has_user')` 检测本地是否存在账号。
3. **Rust 命令层**查询 SQLite：`SELECT COUNT(*) FROM users`。
4. **SQLite** 返回 `count > 0`，本地有账号数据。
5. **Rust 命令层**返回 `{ has_user: true }`。
6. **React 前端**渲染登录页面。
7. **用户**填写用户名和密码，点击"登录"。
8. **React 前端**调用 `invoke('login', { username, password })`。
9. **Rust 命令层**按用户名查询用户记录。
10. **SQLite** 返回用户记录（含 bcrypt 哈希）。→ 见 EX-10.1（用户名不存在）
11. **Rust 命令层**调用 `bcrypt::verify` 验证密码。→ 见 EX-11.1（密码错误）
12. **Rust 命令层**顺带加载该用户的未完成任务列表（减少前端启动时的二次 invoke）。
13. **SQLite** 返回任务列表。
14. **Rust 命令层**将 `{ user_id, username, tasks }` 返回给前端。
15. **React 前端**写入 Zustand Store，完成会话初始化。
16. **React 前端**跳转任务主界面，渲染未完成任务列表。

### 异常用例

#### EX-10.1: 用户名不存在

- **触发条件**：Step 10 的 SELECT 查询返回空结果
- **期望响应**：Rust 命令层返回 `{ code: "INVALID_CREDENTIALS" }`（不区分用户名错误/密码错误，避免信息泄露）；前端在密码输入框下方显示"用户名或密码错误"，密码框清空，焦点回到密码框
- **副作用**：不创建会话，不跳转页面

#### EX-11.1: 密码验证失败

- **触发条件**：Step 11 的 `bcrypt::verify` 返回 false
- **期望响应**：同 EX-10.1，返回 `{ code: "INVALID_CREDENTIALS" }`；前端显示"用户名或密码错误"，密码框清空
- **副作用**：不创建会话，不跳转页面

---

## S02.2: 创建任务

### 时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as React 前端
    participant BE as Tauri Commands (Rust)
    participant DB as SQLite

    U->>FE: Step 1: 点击右下角"+"按钮 — 触发新建任务
    FE-->>U: Step 2: 右侧滑出新建任务面板，分类下拉已填充当前分类列表

    U->>FE: Step 3: 填写任务名称（必填）、选择分类（可选）、填写备注（可选），点击"保存"
    FE->>FE: Step 4: 表单校验 — 任务名称不能为空
    Note over FE: 名称为空 → 见 EX-4.1

    FE->>BE: Step 5: invoke('create_task', { user_id, name, category_id?, note? }) — 发起创建命令
    BE->>DB: Step 6: INSERT INTO tasks (user_id, category_id, name, note, done) VALUES (?, ?, ?, ?, 0)
    DB-->>BE: Step 7: 返回新任务 { id, name, category_id, note, done, created_at }
    Note over BE: 写入失败 → 见 EX-6.1

    BE-->>FE: Step 8: 返回新建任务记录
    FE->>FE: Step 9: 将新任务插入 Zustand Store tasks 列表顶部
    FE-->>U: Step 10: 面板关闭，任务卡片出现在列表顶部
```

### 步骤说明

1. **用户**点击任务主界面右下角"+"浮动按钮。
2. **React 前端**从右侧滑出新建任务面板；分类下拉从 Zustand Store 读取当前分类列表（无需额外 invoke）。
3. **用户**填写表单后点击"保存"。
4. **React 前端**校验任务名称不能为空。→ 见 EX-4.1
5. **React 前端**调用 `invoke('create_task', { user_id, name, category_id, note })`，`category_id` 为 null 表示无分类。
6. **Rust 命令层**执行 INSERT，`done` 字段默认为 0（未完成）。→ 见 EX-6.1（写入失败）
7. **SQLite** 返回新任务完整记录。
8. **Rust 命令层**将新任务返回给前端。
9. **React 前端**将新任务追加到 Zustand Store `tasks` 数组头部（不重新拉取全量列表）。
10. **React 前端**关闭面板，新任务卡片出现在列表顶部。

### 异常用例

#### EX-4.1: 任务名称为空

- **触发条件**：Step 4 校验时任务名称输入框为空字符串
- **期望响应**：任务名称输入框下方显示"任务名称不能为空"，输入框边框变红，面板不关闭
- **副作用**：不调用 `invoke('create_task')`

#### EX-6.1: 数据库写入失败

- **触发条件**：Step 6 的 INSERT 操作失败
- **期望响应**：Rust 命令层返回 `{ code: "DB_WRITE_ERROR" }`；前端在面板内显示"保存失败，请重试"
- **副作用**：任务未创建，面板保持打开

---

## S02.3: 完成 / 编辑 / 删除任务

### S02.3a: 标记任务完成

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as React 前端
    participant BE as Tauri Commands (Rust)
    participant DB as SQLite

    U->>FE: Step 1: 点击任务卡片左侧勾选框 — 切换完成状态
    FE->>BE: Step 2: invoke('update_task_status', { task_id, done: true }) — 更新完成状态
    BE->>DB: Step 3: UPDATE tasks SET done = 1, updated_at = datetime('now') WHERE id = ?
    DB-->>BE: Step 4: 返回更新成功
    BE-->>FE: Step 5: 返回 { task_id, done: true }
    FE->>FE: Step 6: 更新 Zustand Store 中对应任务的 done 字段
    FE-->>U: Step 7: 任务卡片显示删除线样式，移至列表底部"已完成"区域
```

**步骤说明：**

1. **用户**点击任务卡片左侧圆形勾选框。
2. **React 前端**调用 `invoke('update_task_status', { task_id, done: true })`。
3. **Rust 命令层**执行 `UPDATE tasks SET done = 1`，同步更新 `updated_at`。
4. **SQLite** 返回更新成功。
5. **Rust 命令层**返回 `{ task_id, done: true }` 给前端。
6. **React 前端**更新 Zustand Store 中对应任务对象的 `done` 字段（局部更新，不重拉列表）。
7. **React 前端**重新渲染，任务卡片显示删除线，移动至"已完成"区域。

> 点击已完成任务的勾选框可取消完成（`done: false`），流程完全对称，`done` 值取反即可。

---

### S02.3b: 编辑任务

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as React 前端
    participant BE as Tauri Commands (Rust)
    participant DB as SQLite

    U->>FE: Step 1: 点击任务卡片 — 触发编辑
    FE-->>U: Step 2: 右侧滑出编辑面板，预填当前任务数据（name, category, note）

    U->>FE: Step 3: 修改内容后点击"保存"
    FE->>FE: Step 4: 校验任务名称不能为空
    Note over FE: 名称为空 → 见 EX-4.1（同 S02.2）

    FE->>BE: Step 5: invoke('update_task', { task_id, name, category_id?, note? }) — 发起更新命令
    BE->>DB: Step 6: UPDATE tasks SET name=?, category_id=?, note=?, updated_at=datetime('now') WHERE id=?
    DB-->>BE: Step 7: 返回更新成功
    BE-->>FE: Step 8: 返回更新后的任务记录
    FE->>FE: Step 9: 更新 Zustand Store 中对应任务数据
    FE-->>U: Step 10: 面板关闭，任务卡片显示更新后内容
```

**步骤说明：**

1. **用户**点击任务卡片主体区域（非勾选框、非删除图标）。
2. **React 前端**从 Zustand Store 读取该任务数据，滑出编辑面板并预填字段。
3. **用户**修改内容后点击"保存"。
4. **React 前端**校验名称非空。→ 见 EX-4.1
5. **React 前端**调用 `invoke('update_task', { task_id, name, category_id, note })`。
6. **Rust 命令层**执行 UPDATE，同步更新 `updated_at`。
7. **SQLite** 返回成功。
8. **Rust 命令层**返回更新后的任务完整记录。
9. **React 前端**局部更新 Zustand Store 中该任务对象。
10. **React 前端**关闭面板，任务卡片呈现更新后的内容。

---

### S02.3c: 删除任务

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as React 前端
    participant BE as Tauri Commands (Rust)
    participant DB as SQLite

    U->>FE: Step 1: 鼠标悬停任务卡片，点击出现的删除图标
    FE-->>U: Step 2: 显示确认对话框"确认删除该任务？此操作不可恢复"

    U->>FE: Step 3: 点击"确认删除"
    FE->>BE: Step 4: invoke('delete_task', { task_id }) — 发起删除命令
    BE->>DB: Step 5: DELETE FROM tasks WHERE id = ? AND user_id = ? — 删除任务（含 user_id 校验）
    DB-->>BE: Step 6: 返回 affected_rows = 1
    BE-->>FE: Step 7: 返回 { success: true }
    FE->>FE: Step 8: 从 Zustand Store tasks 数组中移除该任务
    FE-->>U: Step 9: 任务卡片从列表中消失，若面板打开则同步关闭
```

**步骤说明：**

1. **用户**鼠标悬停任务卡片，卡片右侧出现删除图标，点击删除图标。
2. **React 前端**弹出确认对话框，明确告知操作不可恢复。
3. **用户**确认删除（点击"确认删除"；若点击"取消"则关闭对话框，不执行任何操作）。
4. **React 前端**调用 `invoke('delete_task', { task_id })`。
5. **Rust 命令层**执行 DELETE，WHERE 条件同时包含 `user_id` 防止越权删除。
6. **SQLite** 返回 `affected_rows = 1`，确认删除成功。→ 见 EX-6.1（任务不存在）
7. **Rust 命令层**返回 `{ success: true }`。
8. **React 前端**从 Zustand Store 的 `tasks` 数组中过滤掉该任务（不重新拉取全量列表）。
9. **React 前端**重新渲染，任务从界面消失；若当前编辑面板展示的正是被删除的任务，面板同步关闭。

### 异常用例（S02.3c）

#### EX-6.1: 任务不存在（并发场景）

- **触发条件**：Step 6 的 DELETE 返回 `affected_rows = 0`（任务已被其他操作删除，极少发生）
- **期望响应**：Rust 命令层返回 `{ code: "TASK_NOT_FOUND" }`；前端静默处理，从 Store 中移除该任务（结果一致）
- **副作用**：无，状态最终一致
