# S04: 用户修改账号密码 — 测试用例

> 来源场景：S04-change-password.md
> 关联 API：auth.yaml → change_password
> 关联 DB：users 表
> 更新时间：2026/04/07

---

## 一、单元测试用例

### 1.1 当前密码字段校验（来源：auth.yaml → change_password → current_password）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S04-01 | 当前密码为空时拒绝提交 | `current_password: required` | 已登录 | `current_password: ""` | 错误：请输入当前密码 |
| UT-S04-02 | 当前密码错误时返回 WRONG_PASSWORD | EX-8.1 | 已登录；users 表有 `username="xiaoli"` | `current_password: "WrongPass"` | 错误码 `WRONG_PASSWORD` |
| UT-S04-03 | 当前密码正确时通过验证 | S04 Step 8 | 已登录；users 表有 `username="xiaoli"` | `current_password: "Pass1234"` | bcrypt::verify 返回 true，继续执行 |

### 1.2 新密码字段校验（来源：auth.yaml → change_password → new_password）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S04-04 | 新密码为空时拒绝提交 | `new_password: required` | 已登录 | `new_password: ""` | 错误：请输入新密码 |
| UT-S04-05 | 新密码长度恰好 8 位（下边界合法） | `new_password: minLength: 8` | 已登录 | `new_password: "NewPass1"` | 校验通过 |
| UT-S04-06 | 新密码长度 7 位（低于下边界） | `new_password: minLength: 8` | 已登录 | `new_password: "NewPas1"` | 错误：密码至少需要 8 位字符 |

### 1.3 业务规则校验（来源：S04 Step 4 业务规则）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S04-07 | 新密码与当前密码相同时拒绝 | EX-4.3 | 已登录 | `current_password: "Pass1234", new_password: "Pass1234"` | 错误：新密码不能与当前密码相同 |
| UT-S04-08 | 新密码与当前密码不同时通过 | EX-4.3 | 已登录 | `current_password: "Pass1234", new_password: "NewPass5678"` | 校验通过 |
| UT-S04-09 | 确认新密码与新密码一致时通过 | EX-4.4 | 已登录 | `new_password: "NewPass5678", confirm: "NewPass5678"` | 校验通过 |
| UT-S04-10 | 确认新密码与新密码不一致时拒绝 | EX-4.4 | 已登录 | `new_password: "NewPass5678", confirm: "NewPass9999"` | 错误：两次输入的密码不一致 |

### 1.4 DB 约束（来源：schema.sql → users 表）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S04-11 | 修改密码后 DB 中存储新的 bcrypt 哈希 | `users.password: NOT NULL` + Step 9 | 已登录 | `new_password: "NewPass5678"` | DB 中 `password` 字段更新为新的 bcrypt 哈希（以 `$2b$` 开头），不含明文 |
| UT-S04-12 | 修改密码后旧密码不再有效 | Step 9 安全要求 | 密码已修改为 `"NewPass5678"` | `bcrypt::verify("Pass1234", new_hash)` | 返回 false |
| UT-S04-13 | 修改密码后新密码可正常验证 | Step 9 安全要求 | 密码已修改为 `"NewPass5678"` | `bcrypt::verify("NewPass5678", new_hash)` | 返回 true |

---

## 二、场景测试用例

### 2.1 主路径：修改密码成功

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S04-01 | 完整修改密码流程 | Step 1→14 | 已登录；users 表有 `username="xiaoli"`, `password=bcrypt("Pass1234")` | 1. 进入账号设置页 → 2. 输入 `current_password="Pass1234"`, `new_password="NewPass5678"`, `confirm="NewPass5678"` → 3. 点击"保存修改" → 4. 调用 `change_password({ user_id, current_password:"Pass1234", new_password:"NewPass5678" })` | 1. DB 中 `users.password` 更新为 `bcrypt("NewPass5678")` 的哈希 2. 返回 `{ success: true }` 3. 前端三个密码输入框清空 4. 页面顶部显示"密码修改成功"提示条 5. 当前登录会话保持不变（不强制重新登录） |

### 2.2 异常路径

| ID | 描述 | 覆盖 EX | 前置条件 | 触发条件 | 预期结果 |
|----|------|--------|---------|---------|---------|
| ST-S04-02 | 当前密码为空，前端拦截 | EX-4.1 | 已登录，账号设置页已打开 | `current_password=""` 点击"保存修改" | 1. 不调用 `change_password` 2. 显示"请输入当前密码" 3. users 表密码不变 |
| ST-S04-03 | 新密码少于 8 位，前端拦截 | EX-4.2 | 已登录 | `new_password="New123"`（7位）点击"保存修改" | 1. 不调用 `change_password` 2. 显示"密码至少需要 8 位字符" 3. users 表密码不变 |
| ST-S04-04 | 新密码与当前密码相同，前端拦截 | EX-4.3 | 已登录 | `current_password="Pass1234"`, `new_password="Pass1234"` | 1. 不调用 `change_password` 2. 显示"新密码不能与当前密码相同" 3. users 表密码不变 |
| ST-S04-05 | 两次新密码不一致，前端拦截 | EX-4.4 | 已登录 | `new_password="NewPass5678"`, `confirm="NewPass9999"` | 1. 不调用 `change_password` 2. 确认密码框下方显示"两次输入的密码不一致" 3. users 表密码不变 |
| ST-S04-06 | 当前密码验证失败，后端返回错误 | EX-8.1 | 已登录；users 表有 `username="xiaoli"` | 调用 `change_password({ current_password:"WrongPass", new_password:"NewPass5678" })` | 1. 返回错误码 `WRONG_PASSWORD` 2. 前端显示"当前密码不正确" 3. 当前密码输入框清空，焦点回到当前密码框 4. users 表密码不变 |
| ST-S04-07 | DB 写入失败 | EX-10.1 | 已登录；模拟 DB UPDATE 失败 | 调用 `change_password`，DB 层抛出写入异常 | 1. 返回错误码 `DB_WRITE_ERROR` 2. 前端显示"保存失败，请重试" 3. users 表密码不变，旧密码仍然有效 |

---

## 三、覆盖度校验

- [x] Phase 1 正常验收条件：ST-S04-01 覆盖"修改密码成功，提示修改成功，会话保持"
- [x] Phase 1 异常验收条件（当前密码错误）：ST-S04-06 覆盖
- [x] Phase 1 异常验收条件（新密码不符合要求）：ST-S04-03 覆盖
- [x] EX-4.1（字段为空）：ST-S04-02 覆盖
- [x] EX-4.2（新密码 < 8 位）：ST-S04-03 覆盖
- [x] EX-4.3（新旧密码相同）：ST-S04-04 覆盖
- [x] EX-4.4（两次密码不一致）：ST-S04-05 覆盖
- [x] EX-8.1（当前密码错误）：ST-S04-06 覆盖
- [x] EX-10.1（DB 写入失败）：ST-S04-07 覆盖
- [x] API `required` 字段（user_id, current_password, new_password）：UT-S04-01 / UT-S04-04 覆盖
- [x] bcrypt 安全存储（新密码哈希化）：UT-S04-11 / UT-S04-12 / UT-S04-13 覆盖
- [x] 修改后旧密码失效：UT-S04-12 覆盖

---

## 四、验收条件追溯

| AC ID | 验收条件（来源：Phase 1 S04） | 覆盖用例 |
|-------|---------------------------|---------|
| S04-AC-01 | 正常：输入正确当前密码和合法新密码，修改成功，显示"密码修改成功"，会话保持 | ST-S04-01 |
| S04-AC-02 | 正常：修改后使用新密码可正常登录 | ST-S04-01, UT-S04-13 |
| S04-AC-03 | 异常：当前密码错误，显示"当前密码不正确"，密码框清空 | ST-S04-06, UT-S04-02 |
| S04-AC-04 | 异常：新密码少于 8 位，显示"密码至少需要 8 位字符" | ST-S04-03, UT-S04-06 |
| S04-AC-05 | 异常：新密码与当前密码相同，显示"新密码不能与当前密码相同" | ST-S04-04, UT-S04-07 |
| S04-AC-06 | 异常：两次新密码不一致，显示"两次输入的密码不一致" | ST-S04-05, UT-S04-10 |
