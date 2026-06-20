# 临时验证安全规范（adopt / smoke）

## 目标
避免临时验证脚本误写仓库目录（例如误覆盖 `logos/logos-project.yaml`）。

## 规则（强制）
1. 临时验证只能在独立沙箱目录执行，不得在仓库根目录拼接长命令链。
2. 所有写入和删除操作必须使用绝对路径，并且路径必须位于沙箱根目录内。
3. 清理动作只允许通过带 sentinel 校验的清理脚本执行。

## 推荐流程
1. 创建沙箱：
```bash
./scripts/safety/create-adopt-sandbox.sh
```
2. 执行验证：
```bash
<上一步输出的 SANDBOX_ROOT>/run-verify.sh
```
3. 清理沙箱：
```bash
./scripts/safety/cleanup-adopt-sandbox.sh <SANDBOX_ROOT>
```

## 为什么安全
- `create-adopt-sandbox.sh` 使用 `mktemp -d` 创建独立目录，并写入 `.openlogos-adopt-sentinel`。
- `cleanup-adopt-sandbox.sh` 会验证：
  - 目标目录存在 sentinel；
  - 目录名符合 `openlogos-adopt-safe-*`；
  - 目标不在仓库路径下。
- 任何校验失败都会直接中止，避免误删/误写。
