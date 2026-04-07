# 任务拆解：部署 spec/ 规范文档到用户项目

## T1：npm 打包 spec/
- 文件：`cli/package.json`
- 变更：`files` 数组增加 `"spec"`
- prepack 脚本增加 `spec/` 的复制
- postpack 脚本增加 `spec/` 的清理
- 状态：☐

## T2：init 部署 spec/
- 文件：`cli/src/commands/init.ts`
- 新增 `deploySpecs(root)` 函数：从 npm 包的 `spec/` 目录复制所有 `.md` 文件到 `logos/spec/`
- `init()` 函数调用 `deploySpecs(root)` 并打印部署结果
- 状态：☐

## T3：sync 同步 spec/
- 文件：`cli/src/commands/sync.ts`
- 调用 `deploySpecs(root)` 覆盖更新 spec 文件
- 打印同步结果
- 状态：☐

## T4：更新引用路径
- `cli/src/commands/init.ts`：`createAgentsMd()` 中 `spec/test-results.md` → `logos/spec/test-results.md`
- `skills/test-writer/SKILL.md` + `SKILL.en.md`：路径更新
- `skills/test-orchestrator/SKILL.md` + `SKILL.en.md`：路径更新
- `skills/db-designer/SKILL.md` + `SKILL.en.md`：路径更新
- `skills/project-init/SKILL.md` + `SKILL.en.md`：路径更新
- 运行 `build-plugin-skills.sh` 同步 plugin
- 状态：☐

## T5：测试
- 更新 `test/s01-init.test.ts`：验证 `logos/spec/` 目录部署
- 更新 `test/s08-sync.test.ts`：验证 sync 同步 spec
- 运行全量测试确认无回归
- 状态：☐

## T6：构建发布
- 版本号 0.5.0 → 0.5.1
- 更新 CHANGELOG
- 构建 + 提交 + 推送 + 打 tag
- 状态：☐

## 依赖关系

```
T1 → T2 → T3 → T4 → T5 → T6
```
