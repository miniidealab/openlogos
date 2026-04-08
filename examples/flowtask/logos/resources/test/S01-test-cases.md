# S01: 新用户注册并开始使用 — 测试用例

> 来源场景：S01-register.md
> 关联 API：auth.yaml → register, check_has_user
> 关联 DB：users 表
> 更新时间：2026/04/07

---

## 一、单元测试用例

### 1.1 用户名字段校验（来源：auth.yaml → register → username）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S01-01 | 用户名长度恰好 2 字符（下边界合法） | `username: minLength: 2` | 无 | `username: "ab"` | 校验通过 |
| UT-S01-02 | 用户名长度恰好 20 字符（上边界合法） | `username: maxLength: 20` | 无 | `username: "abcdefghij0123456789"` | 校验通过 |
| UT-S01-03 | 用户名长度 1 字符（低于下边界） | `username: minLength: 2` | 无 | `username: "a"` | 错误：用户名需为 2-20 个字符 |
| UT-S01-04 | 用户名长度 21 字符（超出上边界） | `username: maxLength: 20` | 无 | `username: "abcdefghij01234567890"` | 错误：用户名需为 2-20 个字符 |
| UT-S01-05 | 用户名为空字符串 | `username: required` | 无 | `username: ""` | 错误：用户名不能为空 |

### 1.2 密码字段校验（来源：auth.yaml → register → password）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S01-06 | 密码长度恰好 8 位（下边界合法） | `password: minLength: 8` | 无 | `password: "Pass1234"` | 校验通过 |
| UT-S01-07 | 密码长度 7 位（低于下边界） | `password: minLength: 8` | 无 | `password: "Pass123"` | 错误：密码至少需要 8 位字符 |
| UT-S01-08 | 密码为空字符串 | `password: required` | 无 | `password: ""` | 错误：密码至少需要 8 位字符 |

### 1.3 确认密码校验（来源：S01 Step 8 业务规则）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S01-09 | 两次密码一致 | Step 8 业务规则 | 无 | `password: "Pass1234", confirm: "Pass1234"` | 校验通过 |
| UT-S01-10 | 两次密码不一致 | Step 8 业务规则 / EX-8.3 | 无 | `password: "Pass1234", confirm: "Pass5678"` | 错误：两次输入的密码不一致 |

### 1.4 DB 约束（来源：schema.sql → users 表）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S01-11 | 用户名唯一约束：重复插入同名用户 | `users: UNIQUE(username)` | users 表已有 `username="xiaoli"` | `username: "xiaoli"` | 错误码 `USERNAME_EXISTS` |
| UT-S01-12 | 密码字段 NOT NULL 约束 | `users: password NOT NULL` | 无 | `password: null` | DB 拒绝插入 |
| UT-S01-13 | 新用户 done 字段默认值（tasks 表） | `tasks: done DEFAULT 0` | 注册成功后创建任务 | 不传 done 字段 | `done = 0`（未完成） |

### 1.5 bcrypt 密码加密（来源：S01 Step 12 业务规则）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S01-14 | 注册后密码以哈希形式存储，不可逆 | Step 12 安全要求 | 注册成功 | `password: "Pass1234"` | DB 中 `password` 字段以 `$2b$` 开头的 bcrypt 哈希，不含明文 |
| UT-S01-15 | bcrypt 哈希可被 verify 正确验证 | Step 12 安全要求 | 注册成功 | `bcrypt::verify("Pass1234", stored_hash)` | 返回 true |

---

## 二、场景测试用例

### 2.1 主路径：注册成功并进入任务主界面

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S01-01 | 首次启动应用，完整注册流程 | Step 1→17 | 本地 users 表为空 | 1. 调用 `check_has_user` → 2. 返回 `has_user: false` → 3. 渲染注册页 → 4. 输入 `username="xiaoli"`, `password="Pass1234"`, `confirm="Pass1234"` → 5. 调用 `register` → 6. 写入 users 表 → 7. 返回 `{ user_id, username }` → 8. 写入 Zustand Store → 9. 跳转任务主界面 | 1. users 表新增一条记录，`username="xiaoli"`，`password` 为 bcrypt 哈希 2. 前端 Zustand Store 中 `currentUser.username = "xiaoli"` 3. 页面显示空状态引导文案 |

### 2.2 异常路径

| ID | 描述 | 覆盖 EX | 前置条件 | 触发条件 | 预期结果 |
|----|------|--------|---------|---------|---------|
| ST-S01-02 | 用户名为空，前端拦截 | EX-8.1 | 注册页已打开 | 用户名输入框为空，点击"注册" | 1. 不调用 `register` 2. 用户名输入框下方显示"用户名不能为空" 3. users 表无新增记录 |
| ST-S01-03 | 密码少于 8 位，前端拦截 | EX-8.2 | 注册页已打开 | 输入 `password="abc123"`（6位），点击"注册" | 1. 不调用 `register` 2. 密码输入框下方显示"密码至少需要 8 位字符" 3. users 表无新增记录 |
| ST-S01-04 | 两次密码不一致，前端拦截 | EX-8.3 | 注册页已打开 | 输入 `password="Pass1234"`, `confirm="Pass5678"`，点击"注册" | 1. 不调用 `register` 2. 确认密码输入框下方显示"两次输入的密码不一致" 3. users 表无新增记录 |
| ST-S01-05 | 用户名已存在，后端返回错误 | EX-10.1 | users 表已有 `username="xiaoli"` | 输入 `username="xiaoli"`, `password="Pass1234"`，点击"注册" | 1. `register` 返回错误码 `USERNAME_EXISTS` 2. 用户名输入框下方显示"该用户名已被使用，请换一个" 3. users 表无新增记录 |
| ST-S01-06 | 数据库写入失败 | EX-13.1 | 模拟 DB INSERT 失败 | 调用 `register`，DB 层抛出写入异常 | 1. `register` 返回错误码 `DB_WRITE_ERROR` 2. 前端显示"注册失败，请重试" 3. users 表无新增记录，用户停留在注册页 |

---

## 三、覆盖度校验

- [x] Phase 1 正常验收条件：ST-S01-01 覆盖"完整注册并创建首个任务"
- [x] Phase 1 异常验收条件（用户名已存在）：ST-S01-05 覆盖
- [x] Phase 1 异常验收条件（密码不符合要求）：ST-S01-03 覆盖
- [x] Phase 1 异常验收条件（用户名为空）：ST-S01-02 覆盖
- [x] EX-8.1 / EX-8.2 / EX-8.3：ST-S01-02 / ST-S01-03 / ST-S01-04 覆盖
- [x] EX-10.1（用户名已存在）：ST-S01-05 覆盖
- [x] EX-13.1（DB 写入失败）：ST-S01-06 覆盖
- [x] API `required` 字段（username, password）：UT-S01-05 / UT-S01-08 覆盖
- [x] DB `UNIQUE(username)` 约束：UT-S01-11 覆盖
- [x] DB `password NOT NULL` 约束：UT-S01-12 覆盖
- [x] bcrypt 安全存储：UT-S01-14 / UT-S01-15 覆盖

---

## 四、验收条件追溯

| AC ID | 验收条件（来源：Phase 1 S01） | 覆盖用例 |
|-------|---------------------------|---------|
| S01-AC-01 | 正常：用户填写合法用户名和密码，注册成功，自动登录跳转任务主界面，显示空状态引导 | ST-S01-01 |
| S01-AC-02 | 异常：用户名已存在，显示"该用户名已被使用，请换一个"，不创建账号 | ST-S01-05, UT-S01-11 |
| S01-AC-03 | 异常：密码少于 8 位，显示"密码至少需要 8 位字符"，请求不提交 | ST-S01-03, UT-S01-07 |
| S01-AC-04 | 异常：用户名为空，显示"用户名不能为空"，请求不提交 | ST-S01-02, UT-S01-05 |
