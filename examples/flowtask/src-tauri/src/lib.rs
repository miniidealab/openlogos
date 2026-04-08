use bcrypt::{hash, verify, DEFAULT_COST};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

// ── 统一错误结构 ──────────────────────────────────────────────
#[derive(Debug, Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    fn new(code: &str, message: &str) -> Self {
        Self { code: code.to_string(), message: message.to_string() }
    }
}

type CmdResult<T> = Result<T, CommandError>;

// ── 返回值结构 ────────────────────────────────────────────────
#[derive(Debug, Serialize)]
struct HasUserResult { has_user: bool }

#[derive(Debug, Serialize)]
pub struct UserSession {
    pub user_id: i64,
    pub username: String,
    pub tasks: Vec<TaskItem>,
    pub categories: Vec<CategoryItem>,
}

#[derive(Debug, Serialize)]
pub struct TaskItem {
    pub id: i64,
    pub user_id: i64,
    pub category_id: Option<i64>,
    pub name: String,
    pub note: Option<String>,
    pub done: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct CategoryItem {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct TaskStatusResult { pub task_id: i64, pub done: bool }

#[derive(Debug, Serialize)]
pub struct SuccessResult { pub success: bool }

// ── 命令参数 ──────────────────────────────────────────────────
#[derive(Debug, Deserialize)]
struct RegisterParams { username: String, password: String }

#[derive(Debug, Deserialize)]
struct LoginParams { username: String, password: String }

#[derive(Debug, Deserialize)]
struct CreateTaskParams {
    user_id: i64,
    name: String,
    category_id: Option<i64>,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateTaskParams {
    task_id: i64,
    name: String,
    category_id: Option<i64>,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateTaskStatusParams { task_id: i64, done: bool }

#[derive(Debug, Deserialize)]
struct DeleteTaskParams { task_id: i64, user_id: i64 }

#[derive(Debug, Deserialize)]
struct CreateCategoryParams { user_id: i64, name: String }

#[derive(Debug, Deserialize)]
struct DeleteCategoryParams { category_id: i64 }

#[derive(Debug, Deserialize)]
struct ChangePasswordParams {
    user_id: i64,
    current_password: String,
    new_password: String,
}

// ── S01 Step 2: check_has_user ────────────────────────────────
#[tauri::command]
async fn check_has_user(pool: tauri::State<'_, SqlitePool>) -> CmdResult<HasUserResult> {
    let row = sqlx::query("SELECT COUNT(*) as count FROM users")
        .fetch_one(pool.inner()).await
        .map_err(|_| CommandError::new("DB_ERROR", "查询失败"))?;
    Ok(HasUserResult { has_user: row.get::<i64, _>("count") > 0 })
}

// ── S01 Step 9-15: register ───────────────────────────────────
#[tauri::command]
async fn register(
    params: RegisterParams,
    pool: tauri::State<'_, SqlitePool>,
) -> CmdResult<UserSession> {
    let row = sqlx::query("SELECT COUNT(*) as count FROM users WHERE username = ?")
        .bind(&params.username).fetch_one(pool.inner()).await
        .map_err(|_| CommandError::new("DB_ERROR", "查询失败"))?;
    if row.get::<i64, _>("count") > 0 {
        return Err(CommandError::new("USERNAME_EXISTS", "该用户名已被使用，请换一个"));
    }
    let pw_hash = hash(&params.password, DEFAULT_COST)
        .map_err(|_| CommandError::new("HASH_ERROR", "密码加密失败"))?;
    let result = sqlx::query("INSERT INTO users (username, password) VALUES (?, ?)")
        .bind(&params.username).bind(&pw_hash).execute(pool.inner()).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "注册失败，请重试"))?;
    Ok(UserSession {
        user_id: result.last_insert_rowid(),
        username: params.username,
        tasks: vec![],
        categories: vec![],
    })
}

// ── S02.1 Step 8-14: login ────────────────────────────────────
#[tauri::command]
async fn login(
    params: LoginParams,
    pool: tauri::State<'_, SqlitePool>,
) -> CmdResult<UserSession> {
    let user_row = sqlx::query(
        "SELECT id, username, password FROM users WHERE username = ?",
    )
    .bind(&params.username).fetch_optional(pool.inner()).await
    .map_err(|_| CommandError::new("DB_ERROR", "查询失败"))?
    .ok_or_else(|| CommandError::new("INVALID_CREDENTIALS", "用户名或密码错误"))?;

    let user_id: i64 = user_row.get("id");
    let username: String = user_row.get("username");
    let stored_hash: String = user_row.get("password");

    let valid = verify(&params.password, &stored_hash)
        .map_err(|_| CommandError::new("INVALID_CREDENTIALS", "用户名或密码错误"))?;
    if !valid {
        return Err(CommandError::new("INVALID_CREDENTIALS", "用户名或密码错误"));
    }

    let task_rows = sqlx::query(
        "SELECT id, user_id, category_id, name, note, done, created_at, updated_at
         FROM tasks WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(user_id).fetch_all(pool.inner()).await
    .map_err(|_| CommandError::new("DB_ERROR", "加载任务失败"))?;

    let tasks = task_rows.iter().map(|r| TaskItem {
        id: r.get("id"), user_id: r.get("user_id"),
        category_id: r.get("category_id"), name: r.get("name"),
        note: r.get("note"), done: r.get::<i64, _>("done") != 0,
        created_at: r.get("created_at"), updated_at: r.get("updated_at"),
    }).collect();

    let cat_rows = sqlx::query("SELECT id, name FROM categories WHERE user_id = ?")
        .bind(user_id).fetch_all(pool.inner()).await
        .map_err(|_| CommandError::new("DB_ERROR", "加载分类失败"))?;

    let categories = cat_rows.iter().map(|r| CategoryItem {
        id: r.get("id"), name: r.get("name"),
    }).collect();

    Ok(UserSession { user_id, username, tasks, categories })
}

// ── S02.2 Step 5-8: create_task ───────────────────────────────
#[tauri::command]
async fn create_task(
    params: CreateTaskParams,
    pool: tauri::State<'_, SqlitePool>,
) -> CmdResult<TaskItem> {
    let result = sqlx::query(
        "INSERT INTO tasks (user_id, category_id, name, note, done) VALUES (?, ?, ?, ?, 0)",
    )
    .bind(params.user_id).bind(params.category_id)
    .bind(&params.name).bind(&params.note)
    .execute(pool.inner()).await
    .map_err(|_| CommandError::new("DB_WRITE_ERROR", "保存失败，请重试"))?;

    let task_id = result.last_insert_rowid();
    let row = sqlx::query(
        "SELECT id, user_id, category_id, name, note, done, created_at, updated_at
         FROM tasks WHERE id = ?",
    )
    .bind(task_id).fetch_one(pool.inner()).await
    .map_err(|_| CommandError::new("DB_ERROR", "读取任务失败"))?;

    Ok(TaskItem {
        id: row.get("id"), user_id: row.get("user_id"),
        category_id: row.get("category_id"), name: row.get("name"),
        note: row.get("note"), done: row.get::<i64, _>("done") != 0,
        created_at: row.get("created_at"), updated_at: row.get("updated_at"),
    })
}

// ── S02.3b Step 5-8: update_task ─────────────────────────────
#[tauri::command]
async fn update_task(
    params: UpdateTaskParams,
    pool: tauri::State<'_, SqlitePool>,
) -> CmdResult<TaskItem> {
    let result = sqlx::query(
        "UPDATE tasks SET name=?, category_id=?, note=?, updated_at=datetime('now') WHERE id=?",
    )
    .bind(&params.name).bind(params.category_id)
    .bind(&params.note).bind(params.task_id)
    .execute(pool.inner()).await
    .map_err(|_| CommandError::new("DB_WRITE_ERROR", "保存失败，请重试"))?;

    if result.rows_affected() == 0 {
        return Err(CommandError::new("TASK_NOT_FOUND", "任务不存在"));
    }

    let row = sqlx::query(
        "SELECT id, user_id, category_id, name, note, done, created_at, updated_at
         FROM tasks WHERE id = ?",
    )
    .bind(params.task_id).fetch_one(pool.inner()).await
    .map_err(|_| CommandError::new("DB_ERROR", "读取任务失败"))?;

    Ok(TaskItem {
        id: row.get("id"), user_id: row.get("user_id"),
        category_id: row.get("category_id"), name: row.get("name"),
        note: row.get("note"), done: row.get::<i64, _>("done") != 0,
        created_at: row.get("created_at"), updated_at: row.get("updated_at"),
    })
}

// ── S02.3a Step 2-5: update_task_status ──────────────────────
#[tauri::command]
async fn update_task_status(
    params: UpdateTaskStatusParams,
    pool: tauri::State<'_, SqlitePool>,
) -> CmdResult<TaskStatusResult> {
    let result = sqlx::query(
        "UPDATE tasks SET done=?, updated_at=datetime('now') WHERE id=?",
    )
    .bind(if params.done { 1i64 } else { 0i64 }).bind(params.task_id)
    .execute(pool.inner()).await
    .map_err(|_| CommandError::new("DB_WRITE_ERROR", "更新失败，请重试"))?;

    if result.rows_affected() == 0 {
        return Err(CommandError::new("TASK_NOT_FOUND", "任务不存在"));
    }
    Ok(TaskStatusResult { task_id: params.task_id, done: params.done })
}

// ── S02.3c Step 4-7: delete_task ─────────────────────────────
#[tauri::command]
async fn delete_task(
    params: DeleteTaskParams,
    pool: tauri::State<'_, SqlitePool>,
) -> CmdResult<SuccessResult> {
    let result = sqlx::query("DELETE FROM tasks WHERE id = ? AND user_id = ?")
        .bind(params.task_id).bind(params.user_id).execute(pool.inner()).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "删除失败，请重试"))?;

    if result.rows_affected() == 0 {
        return Err(CommandError::new("TASK_NOT_FOUND", "任务不存在"));
    }
    Ok(SuccessResult { success: true })
}

// ── S03.1 Step 5-8: create_category ──────────────────────────
#[tauri::command]
async fn create_category(
    params: CreateCategoryParams,
    pool: tauri::State<'_, SqlitePool>,
) -> CmdResult<CategoryItem> {
    let result = sqlx::query(
        "INSERT INTO categories (user_id, name) VALUES (?, ?)",
    )
    .bind(params.user_id).bind(&params.name)
    .execute(pool.inner()).await
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            CommandError::new("CATEGORY_EXISTS", "该分类名称已存在")
        } else {
            CommandError::new("DB_WRITE_ERROR", "创建失败，请重试")
        }
    })?;

    let cat_id = result.last_insert_rowid();
    let row = sqlx::query("SELECT id, name FROM categories WHERE id = ?")
        .bind(cat_id).fetch_one(pool.inner()).await
        .map_err(|_| CommandError::new("DB_ERROR", "读取分类失败"))?;

    Ok(CategoryItem { id: row.get("id"), name: row.get("name") })
}

// ── S03.3 Step 5-8: delete_category ──────────────────────────
#[tauri::command]
async fn delete_category(
    params: DeleteCategoryParams,
    pool: tauri::State<'_, SqlitePool>,
) -> CmdResult<SuccessResult> {
    let result = sqlx::query("DELETE FROM categories WHERE id = ?")
        .bind(params.category_id).execute(pool.inner()).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "删除失败，请重试"))?;

    if result.rows_affected() == 0 {
        return Err(CommandError::new("CATEGORY_NOT_FOUND", "分类不存在"));
    }
    Ok(SuccessResult { success: true })
}

// ── S04 Step 5-12: change_password ───────────────────────────
#[tauri::command]
async fn change_password(
    params: ChangePasswordParams,
    pool: tauri::State<'_, SqlitePool>,
) -> CmdResult<SuccessResult> {
    // Step 6-7: 取当前密码哈希
    let row = sqlx::query("SELECT password FROM users WHERE id = ?")
        .bind(params.user_id).fetch_optional(pool.inner()).await
        .map_err(|_| CommandError::new("DB_ERROR", "查询失败"))?
        .ok_or_else(|| CommandError::new("USER_NOT_FOUND", "用户不存在"))?;

    let stored_hash: String = row.get("password");

    // Step 8: 验证当前密码
    let valid = verify(&params.current_password, &stored_hash)
        .map_err(|_| CommandError::new("WRONG_PASSWORD", "当前密码不正确"))?;
    if !valid {
        return Err(CommandError::new("WRONG_PASSWORD", "当前密码不正确"));
    }

    // Step 9: 哈希新密码
    let new_hash = hash(&params.new_password, DEFAULT_COST)
        .map_err(|_| CommandError::new("HASH_ERROR", "密码加密失败"))?;

    // Step 10: 写入新密码哈希，同步更新 updated_at
    sqlx::query("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(&new_hash).bind(params.user_id)
        .execute(pool.inner()).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "保存失败，请重试"))?;

    Ok(SuccessResult { success: true })
}

// ── 数据库迁移 ────────────────────────────────────────────────
fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_initial_tables",
        sql: include_str!("../migrations/001_init.sql"),
        kind: MigrationKind::Up,
    }]
}

// ── 应用入口 ──────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:flowtask.db", migrations())
                .build(),
        )
        .setup(|app| {
            let app_dir = app.path().app_config_dir().expect("无法获取应用配置目录");
            std::fs::create_dir_all(&app_dir).expect("无法创建应用配置目录");
            let db_path = app_dir.join("flowtask.db");
            let db_url = format!("sqlite:{}?mode=rwc", db_path.to_str().unwrap());
            tauri::async_runtime::block_on(async move {
                let pool = SqlitePool::connect(&db_url).await.expect("无法连接数据库");
                // 运行建表迁移
                let sql = include_str!("../migrations/001_init.sql");
                sqlx::raw_sql(sql).execute(&pool).await.expect("无法初始化数据库表");
                app.manage(pool);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_has_user,
            register,
            login,
            create_task,
            update_task,
            update_task_status,
            delete_task,
            create_category,
            delete_category,
            change_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── 测试用公开接口（直接操作 pool，绕过 tauri::State）────────────
#[doc(hidden)]
pub async fn cmd_register(username: String, password: String, pool: &SqlitePool) -> CmdResult<UserSession> {
    let row = sqlx::query("SELECT COUNT(*) as count FROM users WHERE username = ?")
        .bind(&username).fetch_one(pool).await
        .map_err(|_| CommandError::new("DB_ERROR", "查询失败"))?;
    if row.get::<i64, _>("count") > 0 {
        return Err(CommandError::new("USERNAME_EXISTS", "该用户名已被使用，请换一个"));
    }
    let pw_hash = bcrypt::hash(&password, bcrypt::DEFAULT_COST)
        .map_err(|_| CommandError::new("HASH_ERROR", "密码加密失败"))?;
    let result = sqlx::query("INSERT INTO users (username, password) VALUES (?, ?)")
        .bind(&username).bind(&pw_hash).execute(pool).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "注册失败，请重试"))?;
    Ok(UserSession { user_id: result.last_insert_rowid(), username, tasks: vec![], categories: vec![] })
}

#[doc(hidden)]
pub async fn cmd_login(username: String, password: String, pool: &SqlitePool) -> CmdResult<UserSession> {
    let user_row = sqlx::query("SELECT id, username, password FROM users WHERE username = ?")
        .bind(&username).fetch_optional(pool).await
        .map_err(|_| CommandError::new("DB_ERROR", "查询失败"))?
        .ok_or_else(|| CommandError::new("INVALID_CREDENTIALS", "用户名或密码错误"))?;
    let user_id: i64 = user_row.get("id");
    let uname: String = user_row.get("username");
    let stored_hash: String = user_row.get("password");
    let valid = bcrypt::verify(&password, &stored_hash)
        .map_err(|_| CommandError::new("INVALID_CREDENTIALS", "用户名或密码错误"))?;
    if !valid { return Err(CommandError::new("INVALID_CREDENTIALS", "用户名或密码错误")); }
    let task_rows = sqlx::query(
        "SELECT id, user_id, category_id, name, note, done, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC")
        .bind(user_id).fetch_all(pool).await
        .map_err(|_| CommandError::new("DB_ERROR", "加载任务失败"))?;
    let tasks = task_rows.iter().map(|r| TaskItem {
        id: r.get("id"), user_id: r.get("user_id"), category_id: r.get("category_id"),
        name: r.get("name"), note: r.get("note"), done: r.get::<i64, _>("done") != 0,
        created_at: r.get("created_at"), updated_at: r.get("updated_at"),
    }).collect();
    let cat_rows = sqlx::query("SELECT id, name FROM categories WHERE user_id = ?")
        .bind(user_id).fetch_all(pool).await
        .map_err(|_| CommandError::new("DB_ERROR", "加载分类失败"))?;
    let categories = cat_rows.iter().map(|r| CategoryItem { id: r.get("id"), name: r.get("name") }).collect();
    Ok(UserSession { user_id, username: uname, tasks, categories })
}

#[doc(hidden)]
pub async fn cmd_create_task(user_id: i64, name: String, category_id: Option<i64>, note: Option<String>, pool: &SqlitePool) -> CmdResult<TaskItem> {
    let result = sqlx::query("INSERT INTO tasks (user_id, category_id, name, note, done) VALUES (?, ?, ?, ?, 0)")
        .bind(user_id).bind(category_id).bind(&name).bind(&note).execute(pool).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "保存失败，请重试"))?;
    let task_id = result.last_insert_rowid();
    let row = sqlx::query("SELECT id, user_id, category_id, name, note, done, created_at, updated_at FROM tasks WHERE id = ?")
        .bind(task_id).fetch_one(pool).await
        .map_err(|_| CommandError::new("DB_ERROR", "读取任务失败"))?;
    Ok(TaskItem { id: row.get("id"), user_id: row.get("user_id"), category_id: row.get("category_id"),
        name: row.get("name"), note: row.get("note"), done: row.get::<i64, _>("done") != 0,
        created_at: row.get("created_at"), updated_at: row.get("updated_at") })
}

#[doc(hidden)]
pub async fn cmd_update_task(task_id: i64, name: String, category_id: Option<i64>, note: Option<String>, pool: &SqlitePool) -> CmdResult<TaskItem> {
    let result = sqlx::query("UPDATE tasks SET name=?, category_id=?, note=?, updated_at=datetime('now') WHERE id=?")
        .bind(&name).bind(category_id).bind(&note).bind(task_id).execute(pool).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "保存失败，请重试"))?;
    if result.rows_affected() == 0 { return Err(CommandError::new("TASK_NOT_FOUND", "任务不存在")); }
    let row = sqlx::query("SELECT id, user_id, category_id, name, note, done, created_at, updated_at FROM tasks WHERE id = ?")
        .bind(task_id).fetch_one(pool).await
        .map_err(|_| CommandError::new("DB_ERROR", "读取任务失败"))?;
    Ok(TaskItem { id: row.get("id"), user_id: row.get("user_id"), category_id: row.get("category_id"),
        name: row.get("name"), note: row.get("note"), done: row.get::<i64, _>("done") != 0,
        created_at: row.get("created_at"), updated_at: row.get("updated_at") })
}

#[doc(hidden)]
pub async fn cmd_update_task_status(task_id: i64, done: bool, pool: &SqlitePool) -> CmdResult<TaskStatusResult> {
    let result = sqlx::query("UPDATE tasks SET done=?, updated_at=datetime('now') WHERE id=?")
        .bind(if done { 1i64 } else { 0i64 }).bind(task_id).execute(pool).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "更新失败，请重试"))?;
    if result.rows_affected() == 0 { return Err(CommandError::new("TASK_NOT_FOUND", "任务不存在")); }
    Ok(TaskStatusResult { task_id, done })
}

#[doc(hidden)]
pub async fn cmd_delete_task(task_id: i64, user_id: i64, pool: &SqlitePool) -> CmdResult<SuccessResult> {
    let result = sqlx::query("DELETE FROM tasks WHERE id = ? AND user_id = ?")
        .bind(task_id).bind(user_id).execute(pool).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "删除失败，请重试"))?;
    if result.rows_affected() == 0 { return Err(CommandError::new("TASK_NOT_FOUND", "任务不存在")); }
    Ok(SuccessResult { success: true })
}

#[doc(hidden)]
pub async fn cmd_create_category(user_id: i64, name: String, pool: &SqlitePool) -> CmdResult<CategoryItem> {
    let result = sqlx::query("INSERT INTO categories (user_id, name) VALUES (?, ?)")
        .bind(user_id).bind(&name).execute(pool).await
        .map_err(|e| if e.to_string().contains("UNIQUE") {
            CommandError::new("CATEGORY_EXISTS", "该分类名称已存在")
        } else {
            CommandError::new("DB_WRITE_ERROR", "创建失败，请重试")
        })?;
    let cat_id = result.last_insert_rowid();
    let row = sqlx::query("SELECT id, name FROM categories WHERE id = ?")
        .bind(cat_id).fetch_one(pool).await
        .map_err(|_| CommandError::new("DB_ERROR", "读取分类失败"))?;
    Ok(CategoryItem { id: row.get("id"), name: row.get("name") })
}

#[doc(hidden)]
pub async fn cmd_delete_category(category_id: i64, pool: &SqlitePool) -> CmdResult<SuccessResult> {
    let result = sqlx::query("DELETE FROM categories WHERE id = ?")
        .bind(category_id).execute(pool).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "删除失败，请重试"))?;
    if result.rows_affected() == 0 { return Err(CommandError::new("CATEGORY_NOT_FOUND", "分类不存在")); }
    Ok(SuccessResult { success: true })
}

#[doc(hidden)]
pub async fn cmd_change_password(user_id: i64, current_password: String, new_password: String, pool: &SqlitePool) -> CmdResult<SuccessResult> {
    let row = sqlx::query("SELECT password FROM users WHERE id = ?")
        .bind(user_id).fetch_optional(pool).await
        .map_err(|_| CommandError::new("DB_ERROR", "查询失败"))?
        .ok_or_else(|| CommandError::new("USER_NOT_FOUND", "用户不存在"))?;
    let stored_hash: String = row.get("password");
    let valid = bcrypt::verify(&current_password, &stored_hash)
        .map_err(|_| CommandError::new("WRONG_PASSWORD", "当前密码不正确"))?;
    if !valid { return Err(CommandError::new("WRONG_PASSWORD", "当前密码不正确")); }
    let new_hash = bcrypt::hash(&new_password, bcrypt::DEFAULT_COST)
        .map_err(|_| CommandError::new("HASH_ERROR", "密码加密失败"))?;
    sqlx::query("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(&new_hash).bind(user_id).execute(pool).await
        .map_err(|_| CommandError::new("DB_WRITE_ERROR", "保存失败，请重试"))?;
    Ok(SuccessResult { success: true })
}
