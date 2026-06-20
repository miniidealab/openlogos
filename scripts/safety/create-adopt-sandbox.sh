#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

usage() {
  cat <<'EOF'
用法:
  scripts/safety/create-adopt-sandbox.sh [临时根目录]

说明:
  1) 创建隔离的 adopt 验证沙箱（clean + legacy 两个样例）
  2) 所有文件都写入新建的 mktemp 目录，避免误写仓库
  3) 自动生成 run-verify.sh（可直接执行验证命令）

默认临时根目录:
  /private/tmp
EOF
}

BASE_TMP="/private/tmp"
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi
if [[ $# -gt 1 ]]; then
  echo "错误: 参数过多。"
  usage
  exit 1
fi
if [[ $# -eq 1 ]]; then
  BASE_TMP="$1"
fi

if [[ ! -d "$BASE_TMP" ]]; then
  echo "错误: 临时根目录不存在: $BASE_TMP"
  exit 1
fi

case "$BASE_TMP" in
  /private/tmp|/tmp|/private/var/folders/*)
    ;;
  *)
    echo "错误: 为避免误删，仅允许在 /private/tmp、/tmp 或 /private/var/folders/* 下创建沙箱。"
    exit 1
    ;;
esac

SANDBOX_ROOT="$(mktemp -d "${BASE_TMP%/}/openlogos-adopt-safe-XXXXXX")"
CLEAN_APP_DIR="$SANDBOX_ROOT/openlogos-adopt-clean/demo-app"
LEGACY_APP_DIR="$SANDBOX_ROOT/openlogos-adopt-legacy/legacy-app"

mkdir -p "$CLEAN_APP_DIR"
mkdir -p "$LEGACY_APP_DIR/logos/resources/verify"
mkdir -p "$LEGACY_APP_DIR/logos/changes"

cat > "$CLEAN_APP_DIR/README.md" <<'EOF'
# demo
EOF

cat > "$CLEAN_APP_DIR/package.json" <<'EOF'
{
  "name": "demo-app",
  "private": true,
  "version": "0.0.0"
}
EOF

cat > "$LEGACY_APP_DIR/logos/logos.config.json" <<'EOF'
{
  "locale": "zh",
  "aiTool": "all",
  "sourceRoots": {
    "src": [
      "src"
    ],
    "test": [
      "test"
    ]
  },
  "verify": {
    "result_path": "logos/resources/verify/test-results.jsonl"
  }
}
EOF

cat > "$LEGACY_APP_DIR/logos/logos-project.yaml" <<'EOF'
project:
  name: legacy-app
  methodology: OpenLogos
modules:
  - id: core
    name: Core
    lifecycle: launched
    bootstrap: skipped
EOF

cat > "$SANDBOX_ROOT/.openlogos-adopt-sentinel" <<EOF
OPENLOGOS_ADOPT_SANDBOX=1
REPO_ROOT=$REPO_ROOT
CLEAN_APP_DIR=$CLEAN_APP_DIR
LEGACY_APP_DIR=$LEGACY_APP_DIR
EOF

cat > "$SANDBOX_ROOT/.paths" <<EOF
$CLEAN_APP_DIR
$LEGACY_APP_DIR
EOF

cat > "$SANDBOX_ROOT/run-verify.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$REPO_ROOT"
CLI_ENTRY="\$REPO_ROOT/cli/dist/index.js"
CLEAN_APP_DIR="$CLEAN_APP_DIR"
LEGACY_APP_DIR="$LEGACY_APP_DIR"

if [[ ! -f "\$CLI_ENTRY" ]]; then
  echo "错误: 未找到 CLI 构建产物: \$CLI_ENTRY"
  echo "请先在仓库根目录执行: cd \$REPO_ROOT/cli && npm run build"
  exit 1
fi

echo "[1/2] clean 样例执行 adopt（目录: \$CLEAN_APP_DIR）"
(
  cd "\$CLEAN_APP_DIR"
  node "\$CLI_ENTRY" adopt --locale zh --ai-tool all
)

echo "[2/2] legacy 样例执行 status --format json（目录: \$LEGACY_APP_DIR）"
(
  cd "\$LEGACY_APP_DIR"
  node "\$CLI_ENTRY" status --format json
)

echo
echo "验证完成。"
echo "如需清理沙箱，请执行:"
echo "  \$REPO_ROOT/scripts/safety/cleanup-adopt-sandbox.sh $SANDBOX_ROOT"
EOF
chmod +x "$SANDBOX_ROOT/run-verify.sh"

echo "✅ adopt 验证沙箱已创建:"
echo "  SANDBOX_ROOT: $SANDBOX_ROOT"
echo "  CLEAN_APP_DIR: $CLEAN_APP_DIR"
echo "  LEGACY_APP_DIR: $LEGACY_APP_DIR"
echo
echo "下一步："
echo "  1) 执行验证: $SANDBOX_ROOT/run-verify.sh"
echo "  2) 清理沙箱: $REPO_ROOT/scripts/safety/cleanup-adopt-sandbox.sh $SANDBOX_ROOT"
