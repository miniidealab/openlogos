/// FlowTask 编排测试 — S01~S04
/// 直接调用 lib 层函数，使用内存 SQLite，不依赖 Tauri runtime。

use flowtask_lib::*;
use sqlx::{Row, SqlitePool};

/// 初始化内存数据库并执行 migration
async fn setup_db() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    sqlx::query(include_str!("../migrations/001_init.sql"))
        .execute(&pool)
        .await
        .unwrap();
    pool
}

// ─────────────────────────────────────────────────────────────
// S01 注册
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ot_s01_01_register_success() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool)
        .await
        .expect("注册应成功");
    assert_eq!(session.username, "xiaoli");
    assert!(session.user_id > 0);
    assert!(session.tasks.is_empty());
    assert!(session.categories.is_empty());
}

#[tokio::test]
async fn ot_s01_02_register_username_exists() {
    let pool = setup_db().await;
    cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let err = cmd_register("xiaoli".into(), "Other123".into(), &pool)
        .await
        .expect_err("重复用户名应失败");
    assert_eq!(err.code, "USERNAME_EXISTS");
}

// ─────────────────────────────────────────────────────────────
// S02.1 登录
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ot_s02_01_login_success() {
    let pool = setup_db().await;
    cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let session = cmd_login("xiaoli".into(), "Pass1234".into(), &pool)
        .await
        .expect("登录应成功");
    assert_eq!(session.username, "xiaoli");
}

#[tokio::test]
async fn ot_s02_02_login_wrong_password() {
    let pool = setup_db().await;
    cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let err = cmd_login("xiaoli".into(), "WrongPass".into(), &pool)
        .await
        .expect_err("密码错误应失败");
    assert_eq!(err.code, "INVALID_CREDENTIALS");
}

#[tokio::test]
async fn ot_s02_03_login_user_not_found() {
    let pool = setup_db().await;
    let err = cmd_login("nobody".into(), "Pass1234".into(), &pool)
        .await
        .expect_err("用户不存在应失败");
    assert_eq!(err.code, "INVALID_CREDENTIALS");
}

#[tokio::test]
async fn ot_s02_04_login_returns_all_tasks() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let uid = session.user_id;
    // 创建一个未完成任务和一个已完成任务
    let t1 = cmd_create_task(uid, "任务A".into(), None, None, &pool).await.unwrap();
    cmd_update_task_status(t1.id, true, &pool).await.unwrap();
    cmd_create_task(uid, "任务B".into(), None, None, &pool).await.unwrap();

    let session2 = cmd_login("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    // 应返回全量任务（含已完成）
    assert_eq!(session2.tasks.len(), 2);
}

// ─────────────────────────────────────────────────────────────
// S02.2 创建任务
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ot_s02_05_create_task_success() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let task = cmd_create_task(session.user_id, "买牛奶".into(), None, Some("全脂".into()), &pool)
        .await
        .expect("创建任务应成功");
    assert_eq!(task.name, "买牛奶");
    assert_eq!(task.note, Some("全脂".into()));
    assert!(!task.done);
}

// ─────────────────────────────────────────────────────────────
// S02.3a 切换任务状态
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ot_s02_06_toggle_task_done() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let task = cmd_create_task(session.user_id, "买牛奶".into(), None, None, &pool).await.unwrap();

    let r = cmd_update_task_status(task.id, true, &pool).await.unwrap();
    assert!(r.done);

    let r2 = cmd_update_task_status(task.id, false, &pool).await.unwrap();
    assert!(!r2.done);
}

#[tokio::test]
async fn ot_s02_07_toggle_nonexistent_task() {
    let pool = setup_db().await;
    let err = cmd_update_task_status(9999, true, &pool).await.expect_err("不存在任务应失败");
    assert_eq!(err.code, "TASK_NOT_FOUND");
}

// ─────────────────────────────────────────────────────────────
// S02.3b 编辑任务
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ot_s02_08_update_task_success() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let task = cmd_create_task(session.user_id, "旧名称".into(), None, None, &pool).await.unwrap();
    let updated = cmd_update_task(task.id, "新名称".into(), None, Some("备注".into()), &pool)
        .await
        .unwrap();
    assert_eq!(updated.name, "新名称");
    assert_eq!(updated.note, Some("备注".into()));
}

// ─────────────────────────────────────────────────────────────
// S02.3c 删除任务
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ot_s02_09_delete_task_success() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let task = cmd_create_task(session.user_id, "待删除".into(), None, None, &pool).await.unwrap();
    let r = cmd_delete_task(task.id, session.user_id, &pool).await.unwrap();
    assert!(r.success);
}

#[tokio::test]
async fn ot_s02_10_delete_task_wrong_user() {
    let pool = setup_db().await;
    let s1 = cmd_register("user1".into(), "Pass1234".into(), &pool).await.unwrap();
    let s2 = cmd_register("user2".into(), "Pass1234".into(), &pool).await.unwrap();
    let task = cmd_create_task(s1.user_id, "user1的任务".into(), None, None, &pool).await.unwrap();
    // user2 尝试删除 user1 的任务，应失败
    let err = cmd_delete_task(task.id, s2.user_id, &pool).await.expect_err("越权删除应失败");
    assert_eq!(err.code, "TASK_NOT_FOUND");
}

// ─────────────────────────────────────────────────────────────
// S03.1 创建分类
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ot_s03_01_create_category_success() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let cat = cmd_create_category(session.user_id, "工作".into(), &pool).await.unwrap();
    assert_eq!(cat.name, "工作");
    assert!(cat.id > 0);
}

#[tokio::test]
async fn ot_s03_02_create_category_duplicate() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    cmd_create_category(session.user_id, "工作".into(), &pool).await.unwrap();
    let err = cmd_create_category(session.user_id, "工作".into(), &pool)
        .await
        .expect_err("重复分类应失败");
    assert_eq!(err.code, "CATEGORY_EXISTS");
}

// ─────────────────────────────────────────────────────────────
// S03.3 删除分类
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ot_s03_03_delete_category_tasks_set_null() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let cat = cmd_create_category(session.user_id, "工作".into(), &pool).await.unwrap();
    let task = cmd_create_task(session.user_id, "工作任务".into(), Some(cat.id), None, &pool).await.unwrap();
    assert_eq!(task.category_id, Some(cat.id));

    cmd_delete_category(cat.id, &pool).await.unwrap();

    // 任务应保留，category_id 置 NULL（由 DB ON DELETE SET NULL 处理）
    let row = sqlx::query("SELECT category_id FROM tasks WHERE id = ?")
        .bind(task.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let cat_id: Option<i64> = row.try_get("category_id").unwrap_or(None);
    assert!(cat_id.is_none());
}

// ─────────────────────────────────────────────────────────────
// S04 修改密码
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ot_s04_01_change_password_success() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let r = cmd_change_password(session.user_id, "Pass1234".into(), "NewPass99".into(), &pool)
        .await
        .unwrap();
    assert!(r.success);

    // 新密码可登录
    cmd_login("xiaoli".into(), "NewPass99".into(), &pool).await.expect("新密码应可登录");
    // 旧密码不可登录
    let err = cmd_login("xiaoli".into(), "Pass1234".into(), &pool).await.expect_err("旧密码应失败");
    assert_eq!(err.code, "INVALID_CREDENTIALS");
}

#[tokio::test]
async fn ot_s04_02_change_password_wrong_current() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    let err = cmd_change_password(session.user_id, "WrongPass".into(), "NewPass99".into(), &pool)
        .await
        .expect_err("当前密码错误应失败");
    assert_eq!(err.code, "WRONG_PASSWORD");

    // 密码未被修改
    cmd_login("xiaoli".into(), "Pass1234".into(), &pool).await.expect("原密码应仍有效");
}

#[tokio::test]
async fn ot_s04_03_change_password_twice() {
    let pool = setup_db().await;
    let session = cmd_register("xiaoli".into(), "Pass1234".into(), &pool).await.unwrap();
    cmd_change_password(session.user_id, "Pass1234".into(), "NewPass01".into(), &pool).await.unwrap();
    cmd_change_password(session.user_id, "NewPass01".into(), "NewPass02".into(), &pool).await.unwrap();
    cmd_login("xiaoli".into(), "NewPass02".into(), &pool).await.expect("最终密码应可登录");
}
