#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

usage() {
  cat <<'EOF'
用法:
  scripts/safety/cleanup-adopt-sandbox.sh <SANDBOX_ROOT>

说明:
  仅删除由 create-adopt-sandbox.sh 创建且带 sentinel 的临时目录。
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

TARGET_RAW="$1"
if [[ ! -d "$TARGET_RAW" ]]; then
  echo "错误: 目录不存在: $TARGET_RAW"
  exit 1
fi

TARGET="$(cd "$TARGET_RAW" && pwd -P)"
SENTINEL="$TARGET/.openlogos-adopt-sentinel"

if [[ ! -f "$SENTINEL" ]]; then
  echo "错误: 缺少 sentinel，拒绝清理: $TARGET"
  exit 1
fi

case "$TARGET" in
  /private/tmp/openlogos-adopt-safe-*|/tmp/openlogos-adopt-safe-*|/private/var/folders/*/openlogos-adopt-safe-*)
    ;;
  *)
    echo "错误: 目录名不匹配安全前缀，拒绝清理: $TARGET"
    exit 1
    ;;
esac

if [[ "$TARGET" == "$REPO_ROOT" || "$TARGET" == "$REPO_ROOT/"* ]]; then
  echo "错误: 目标在仓库内，拒绝清理: $TARGET"
  exit 1
fi

echo "将清理沙箱目录: $TARGET"
rm -rf "$TARGET"
echo "✅ 清理完成"
