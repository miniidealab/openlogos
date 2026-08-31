## ADDED — Authority writer cutover 与 projection 重建

部署设计前读取 `spec/authority-closure.md` 和 Authority Registry。只要本次改变 owner/writer/mutation entry、projection schema 或 recovery source，部署方案必须包含有限 cutover；不得把长期双写当兼容策略。

### 强制顺序

1. 冻结 authority identity、before facts、当前入口和回滚制品。
2. 停止/隔离旧 writer，并证明旧入口不能成功写入。
3. 启用唯一新 mutation entry；不可逆写入前明确 rollback boundary。
4. 从 authority 重建 projections，以 generation/version/hash/receipt 做 freshness probe。
5. 执行 stale/conflict/response-lost/restart/legacy-writer 负向 smoke。
6. 记录 exit evidence，结束迁移窗口；失败时恢复冻结版本且不留下混合 writer。

部署完成与 cutover 完成是两个事实，不能由“进程已启动”反推 writer 已唯一。新 authority 已产生不可逆写入后禁止重新开启旧 writer；只能前滚或启用兼容 reader。部署任务与 smoke 仍分别等待用户明确授权。
