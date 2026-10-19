#!/usr/bin/env bash
# OpenLogos Codex Plugin — SessionStart hook
# Injects current phase and next-step context into the Codex session.
# Falls back silently (returns {}) if the CLI is unavailable or project is not initialized.
#
# Output format: {"systemMessage": "...", "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "..."}}
# Codex uses systemMessage; additionalContext is included for forward compatibility.

set -euo pipefail

# ── Runtime probing（fix-windows-platform-compat，架构 §五十二 52.5）────────────────────
# node 是 OpenLogos 运行前提，为全部 JSON / YAML 读取的主路径；node 不可执行时才用 Python。
# Python 候选依次 python3 → python → py -3，以执行 `-c "import sys"` 退出 0 为可用判据，不以 PATH
# 可发现性为准（Windows 上 python3 常为可被发现、运行即失败的商店占位别名）。探测结果在一次调用内复用。
NODE_OK=0
if node -e "" </dev/null >/dev/null 2>&1; then
  NODE_OK=1
fi
OPENLOGOS_PY=""
detect_python() {
  [ -n "${OPENLOGOS_PY:-}" ] && return 0
  OPENLOGOS_PY="none"
  local cand
  for cand in "python3" "python" "py -3"; do
    # shellcheck disable=SC2086
    if $cand -c "import sys" </dev/null >/dev/null 2>&1; then
      OPENLOGOS_PY="$cand"
      return 0
    fi
  done
  return 0
}
has_python() {
  detect_python
  [ "$OPENLOGOS_PY" != "none" ]
}
run_python() {
  # shellcheck disable=SC2086
  $OPENLOGOS_PY "$@"
}
if [ "$NODE_OK" -ne 1 ]; then
  detect_python
fi


if ! command -v openlogos &>/dev/null; then
  echo "{}"
  exit 0
fi

if [ ! -f "logos/logos.config.json" ]; then
  echo "{}"
  exit 0
fi

STATUS=$(openlogos status --format json 2>/dev/null || echo "")


if [ "$NODE_OK" -eq 1 ]; then
  LOCALE=$(node -e "const d=JSON.parse(require('fs').readFileSync('logos/logos.config.json','utf-8')); console.log(d.locale||'en')" 2>/dev/null || echo "en")
  CONFIG_LIFECYCLE=$(node -e "const d=JSON.parse(require('fs').readFileSync('logos/logos.config.json','utf-8')); console.log(d.lifecycle||'')" 2>/dev/null || echo "")
  PROJECT_NAME=$(node -e "const d=JSON.parse(require('fs').readFileSync('logos/logos.config.json','utf-8')); console.log(d.name||'')" 2>/dev/null || echo "")
  STATUS_LIFECYCLE=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync(0,'utf-8');(()=>{try{const r=JSON.parse(d);console.log((r.data||{}).lifecycle||'')}catch(e){console.log('')}})()" 2>/dev/null || echo "")
  CURRENT_PHASE=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync(0,'utf-8');(()=>{try{const r=JSON.parse(d);console.log((r.data||{}).current_phase||'all-done')}catch(e){console.log('unknown')}})()" 2>/dev/null || echo "unknown")
  SUGGESTION=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync(0,'utf-8');(()=>{try{const r=JSON.parse(d);console.log((r.data||{}).suggestion||'')}catch(e){console.log('')}})()" 2>/dev/null || echo "")
  ALL_DONE=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync(0,'utf-8');(()=>{try{const r=JSON.parse(d);console.log((r.data||{}).all_done?'true':'false')}catch(e){console.log('false')}})()" 2>/dev/null || echo "false")
  ACTIVE_CHANGE=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync(0,'utf-8');(()=>{try{const data=(JSON.parse(d).data)||{};const mod=(data.modules||[]).find(m=>m.active_change&&m.active_change.slug);console.log(data.active_change||mod?.active_change?.slug||'')}catch(e){console.log('')}})()" 2>/dev/null || echo "")
  PROPOSAL_STEP=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync(0,'utf-8');(()=>{try{const data=(JSON.parse(d).data)||{};const mod=(data.modules||[]).find(m=>m.active_change&&m.active_change.proposal_step);console.log(data.proposal_step||mod?.active_change?.proposal_step||'')}catch(e){console.log('')}})()" 2>/dev/null || echo "")
  PLAN_STATE_SUMMARY=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync(0,'utf-8');(()=>{try{const data=(JSON.parse(d).data)||{};const active=data.active_change||'';let ps=data.plan_state;for(const m of data.modules||[]){const ac=m.active_change;if(!ac) continue;if(active&&ac.slug!==active) continue;ps=ps||ac.plan_state;break;}console.log(!ps?'':\`plan_ready=\${!!ps.plan_ready}, plan_gate_pending=\${!!ps.plan_gate_pending}, plan_approved=\${!!ps.plan_approved}, tasks_execution=\${ps.tasks_execution_done??0}/\${ps.tasks_execution_total??0} \${ps.tasks_execution_scope||'none'}\`)}catch(e){console.log('')}})()" 2>/dev/null || echo "")
fi
if [ "$NODE_OK" -ne 1 ] && has_python; then
  LOCALE=$(run_python -c "import json; d=json.load(open('logos/logos.config.json')); print(d.get('locale','en'))" 2>/dev/null || echo "en")
  CONFIG_LIFECYCLE=$(run_python -c "import json; d=json.load(open('logos/logos.config.json')); print(d.get('lifecycle',''))" 2>/dev/null || echo "")
  PROJECT_NAME=$(run_python -c "import json; d=json.load(open('logos/logos.config.json')); print(d.get('name',''))" 2>/dev/null || echo "")
  STATUS_LIFECYCLE=$(echo "$STATUS" | run_python -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('lifecycle',''))" 2>/dev/null || echo "")
  CURRENT_PHASE=$(echo "$STATUS" | run_python -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('current_phase') or 'all-done')" 2>/dev/null || echo "unknown")
  SUGGESTION=$(echo "$STATUS" | run_python -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('suggestion','Run openlogos status for next steps'))" 2>/dev/null || echo "")
  ALL_DONE=$(echo "$STATUS" | run_python -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('data',{}).get('all_done') else 'false')" 2>/dev/null || echo "false")
  ACTIVE_CHANGE=$(echo "$STATUS" | run_python -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',{}); active=data.get('active_change') or ''; mods=data.get('modules') or []; print(active or next((m.get('active_change',{}).get('slug','') for m in mods if isinstance(m.get('active_change'),dict) and m.get('active_change',{}).get('slug')), ''))" 2>/dev/null || echo "")
  PROPOSAL_STEP=$(echo "$STATUS" | run_python -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',{}); step=data.get('proposal_step') or ''; mods=data.get('modules') or []; print(step or next((m.get('active_change',{}).get('proposal_step','') for m in mods if isinstance(m.get('active_change'),dict) and m.get('active_change',{}).get('proposal_step')), ''))" 2>/dev/null || echo "")
  PLAN_STATE_SUMMARY=$(echo "$STATUS" | run_python -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',{}); active=data.get('active_change') or ''; ps=data.get('plan_state'); mods=data.get('modules') or [];
for m in mods:
  ac=m.get('active_change') if isinstance(m.get('active_change'),dict) else None
  if not ac: continue
  if active and ac.get('slug') != active: continue
  ps = ps or ac.get('plan_state'); break
print('' if not isinstance(ps,dict) else 'plan_ready=%s, plan_gate_pending=%s, plan_approved=%s, tasks_execution=%s/%s %s' % (str(bool(ps.get('plan_ready'))).lower(), str(bool(ps.get('plan_gate_pending'))).lower(), str(bool(ps.get('plan_approved'))).lower(), ps.get('tasks_execution_done',0), ps.get('tasks_execution_total',0), ps.get('tasks_execution_scope','none')))" 2>/dev/null || echo "")
fi
if [ "$NODE_OK" -ne 1 ] && ! has_python; then
  echo "{}"
  exit 0
fi

LIFECYCLE="${STATUS_LIFECYCLE:-${CONFIG_LIFECYCLE:-initial}}"
if [ -z "$STATUS_LIFECYCLE" ] && [ "$LIFECYCLE" = "initial" ] && [ -f "logos/.openlogos-guard" ]; then
  LIFECYCLE="launched"
fi

# GUI UI-first overlay detection: the project instance flow (logos/flow/launched.yaml)
# has the write-ui-prototype node injected only for GUI projects. When present we grant
# a plan-stage exception allowing the page-design prototype delta.
ui_first_exception_text() {
  local active="$1"
  if [ -f "logos/flow/launched.yaml" ] && grep -q 'write-ui-prototype' "logos/flow/launched.yaml" 2>/dev/null; then
    echo " 例外：GUI 项目且本次触及 UI（ui_impact）时，允许在 plan 阶段产出 page-design 原型 delta（logos/changes/$active/deltas/prd/2-product-design/2-page-design/*.html）；其余 delta 仍禁于 plan 阶段。"
  else
    echo ""
  fi
}

change_management_message() {
  local active="$1"
  local step="${2:-}"
  local plan_state="${3:-}"
  local base="Change Management: ACTIVE — guard file detected. Active change proposal: '$active'."
  local confirm="openlogos merge, openlogos verify, openlogos smoke, openlogos archive, deployment, and git push are human confirmation points: AI must not execute them without explicit user authorization."
  local ui_exc
  ui_exc="$(ui_first_exception_text "$active")"

  case "$step" in
    writing)
      echo "$base Current proposal step: writing. Allowed files: logos/changes/$active/proposal.md and logos/changes/$active/tasks.md. Do not write deltas or source code yet.${ui_exc} $confirm"
      ;;
    ready-to-delta)
      echo "$base Current proposal step: ready-to-delta. The plan is ready for approval; plan gate is pending and after approval or openlogos next --auto, proceed to delta-writing. ${plan_state:+Plan state: $plan_state. }Tasks execution 0/N means execution has not started, not planning failure. Do not modify source code or logos/resources/** directly.${ui_exc} $confirm"
      ;;
    delta-writing|implementing|in-progress)
      echo "$base Current proposal step: delta-writing. Allowed files: logos/changes/$active/deltas/** and logos/changes/$active/tasks.md. Continue producing delta files and check off [delta] tasks; do not modify logos/resources/** or source code directly before merge/coding stages. $confirm"
      ;;
    ready-to-merge)
      echo "$base Current proposal step: ready-to-merge. Stop writing deltas and ask the user to explicitly authorize: openlogos merge $active. $confirm"
      ;;
    merge-generated)
      echo "$base Current proposal step: merge-generated. Follow logos/changes/$active/MERGE_PROMPT.md to merge specs, then write logos/changes/$active/SPEC_MERGED when done. $confirm"
      ;;
    coding|ready-to-verify|verify-failed)
      echo "$base Current proposal step: $step. Implement only the [code] section scope from logos/changes/$active/tasks.md, including source code, tests, reporter, and required snapshots; update tasks.md when complete. $confirm"
      ;;
    verify-passed|deploy-done|smoke-passed)
      echo "$base Current proposal step: $step. Verification/delivery is complete for this step; ask the user to explicitly authorize openlogos archive $active when appropriate. $confirm"
      ;;
    ready-to-deploy)
      echo "$base Current proposal step: ready-to-deploy. Deployment requires explicit human authorization before any deployment action. $confirm"
      ;;
    ready-to-smoke|smoke-failed)
      echo "$base Current proposal step: $step. Smoke requires explicit human authorization before running openlogos smoke. $confirm"
      ;;
    *)
      echo "$base Current proposal step is unknown. Run openlogos status or openlogos next to confirm the current proposal step before modifying files; keep changes within the active proposal scope. $confirm"
      ;;
  esac
}

# Language policy
if [ "$LOCALE" = "zh" ]; then
  LANG_POLICY="Language Policy: ALL output MUST be in Chinese (中文)."
else
  LANG_POLICY="Language Policy: ALL output MUST be in English."
fi

# Change management status
GUARD_FILE="logos/.openlogos-guard"
CHANGE_MGMT=""
GUARD_STATUS=""

if [ "$LIFECYCLE" = "launched" ] || [ "$LIFECYCLE" = "active" ]; then
  if [ -z "${ACTIVE_CHANGE:-}" ] && [ -f "$GUARD_FILE" ]; then
    if [ "$NODE_OK" -eq 1 ]; then
      ACTIVE_CHANGE=$(node -e "const d=JSON.parse(require('fs').readFileSync('$GUARD_FILE','utf-8')); console.log(d.activeChange||'')" 2>/dev/null || echo "")
    fi
    if [ "$NODE_OK" -ne 1 ] && has_python; then
      ACTIVE_CHANGE=$(run_python -c "import json; d=json.load(open('$GUARD_FILE')); print(d.get('activeChange',''))" 2>/dev/null || echo "")
    fi
    if [ "$NODE_OK" -ne 1 ] && ! has_python; then
      ACTIVE_CHANGE=""
    fi
  fi

  if [ -n "${ACTIVE_CHANGE:-}" ]; then
    GUARD_STATUS="🔓 Active change: $ACTIVE_CHANGE"
    CHANGE_MGMT=$(change_management_message "$ACTIVE_CHANGE" "${PROPOSAL_STEP:-}" "${PLAN_STATE_SUMMARY:-}")
  else
    GUARD_STATUS="⛔ NO active change proposal"
    CHANGE_MGMT="Change Management: ACTIVE — ⛔ NO guard file found. Before modifying ANY source code, you MUST first run openlogos change <slug> to create a change proposal."
    if [ "$LOCALE" = "zh" ]; then
      SUGGESTION="运行 openlogos change <slug> 创建新提案"
    else
      SUGGESTION="Run openlogos change <slug> to create a new change proposal"
    fi
  fi
else
  CHANGE_MGMT="Change Management: Initial development — follow Phase progression, no change proposals needed."
fi

# Build system message
if [ "$ALL_DONE" = "true" ] && [ -n "$GUARD_STATUS" ]; then
  STATUS_LINE="📊 OpenLogos: All phases complete | $GUARD_STATUS"
elif [ "$ALL_DONE" = "true" ]; then
  STATUS_LINE="📊 OpenLogos: All phases complete"
elif [ -n "$GUARD_STATUS" ]; then
  STATUS_LINE="📊 OpenLogos: $CURRENT_PHASE | $GUARD_STATUS"
else
  STATUS_LINE="📊 OpenLogos: $CURRENT_PHASE"
fi

# proposal-ui-ux-first 切片3：前置能力门 capability surface（读 logos/.session-capabilities.json）。
# 缺失=降级模式（不注入 capabilities 段）；仅用于 plan-exit 前模式选择，plan-exit 后强制语义以 PLAN_APPROVED 为准。
CAPABILITIES=""
CAP_FILE="logos/.session-capabilities.json"
if [ -f "$CAP_FILE" ]; then
  UI_RENDER=""
  if [ "$NODE_OK" -eq 1 ]; then
    UI_RENDER=$(node -e "const d=JSON.parse(require('fs').readFileSync('$CAP_FILE','utf-8'));console.log(d.ui_prototype_render===true?'true':'')" 2>/dev/null || echo "")
  fi
  if [ "$NODE_OK" -ne 1 ] && has_python; then
    UI_RENDER=$(run_python -c "import json;print('true' if json.load(open('$CAP_FILE')).get('ui_prototype_render') is True else '')" 2>/dev/null || echo "")
  fi
  if [ "$UI_RENDER" = "true" ]; then
    CAPABILITIES="Capabilities: ui_prototype_render=true (rendered UI confirmation available; capability 仅用于 plan-exit 前模式选择——就绪→渲染确认模式，plan-exit 后以 PLAN_APPROVED 为准)."
  fi
fi

# module-lifecycle-guard：混合生命周期项目（同时有 launched 与 initial 模块）按模块追加提示段（spec/pretooluse-guard.md
# 「SessionStart 提示」）。只提供指导，授权以每次 PreToolUse 重读磁盘为准；全部 initial / 全部 launched 项目不输出任何内容。
module_lifecycle_context() {
  [ "${NODE_OK:-0}" -eq 1 ] || return 0
  [ -f "logos/logos-project.yaml" ] || return 0
  local _mlc_js
  _mlc_js=$(mktemp "${TMPDIR:-/tmp}/openlogos_mlc.XXXXXX") || return 0
  cat > "$_mlc_js" << 'JSEOF'
const fs = require('fs');
const zh = process.argv[2] === 'zh';
let text;
try { text = fs.readFileSync('logos/logos-project.yaml', 'utf8'); } catch { process.exit(0); }
const unq = (raw) => {
  const v = raw.trim();
  if (v[0] === '"' || v[0] === "'") { const j = v.indexOf(v[0], 1); return j > 0 ? v.slice(1, j) : ''; }
  const k = v.indexOf(' #');
  return (k >= 0 ? v.slice(0, k) : v).trim();
};
const mods = [];
let inModules = false; let cur = null; let inPaths = false; let dash = -1;
for (const raw of text.split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (/^\s*(#|$)/.test(line)) continue;
  const top = /^([A-Za-z_][\w-]*)\s*:/.exec(line);
  if (top) { inModules = top[1] === 'modules'; cur = null; inPaths = false; dash = -1; continue; }
  if (!inModules) continue;
  const body = line.replace(/^ +/, '');
  const indent = line.length - body.length;
  const item = /^-(?:\s+(.*))?$/.exec(body);
  let kvText = body;
  if (item) {
    if (inPaths && indent > dash) { const v = unq(item[1] || ''); if (v) cur.paths.push(v); continue; }
    if (dash < 0 || indent === dash) {
      dash = indent; inPaths = false; cur = { id: '', lifecycle: '', paths: [] }; mods.push(cur);
      if (!(item[1] || '').trim()) continue;
      kvText = item[1];
    } else continue;
  }
  const kv = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(kvText);
  if (!kv || !cur) continue;
  inPaths = false;
  const value = kv[2].trim();
  if (kv[1] === 'id') cur.id = unq(value);
  else if (kv[1] === 'lifecycle') cur.lifecycle = unq(value);
  else if (kv[1] === 'paths') {
    if (value === '' || value[0] === '#') inPaths = true;
    else if (value[0] === '[') { const e = value.indexOf(']'); if (e > 0) cur.paths = value.slice(1, e).split(',').map(unq).filter(Boolean); }
  }
}
const initial = mods.filter(m => m.id && m.lifecycle === 'initial');
const launched = mods.filter(m => m.id && m.lifecycle === 'launched');
if (initial.length === 0 || launched.length === 0) process.exit(0);
const valid = (p) => p && !p.startsWith('/') && !p.split('/').includes('..');
const out = [zh
  ? 'Module Lifecycle（混合生命周期，按模块判定；上方变更管理规则只约束 launched 模块文件、共享配置与未归属文件）：'
  : 'Module Lifecycle (mixed; the change-management rule above applies only to launched module files, shared configuration and unattributed files):'];
for (const m of initial) {
  const paths = m.paths.filter(valid);
  out.push(zh
    ? `- ${m.id}: initial — 按 Phase 推进，无需变更提案；豁免范围：logos/resources/** 下 ${m.id}- 前缀规格；${paths.length ? `代码 paths: ${paths.join(', ')}` : '代码仍需提案（未声明 paths）'}`
    : `- ${m.id}: initial — follow the Phase progression, no change proposal needed; exempt: specs prefixed ${m.id}- under logos/resources/**; ${paths.length ? `code paths: ${paths.join(', ')}` : 'code still requires a proposal (no paths declared)'}`);
}
for (const m of launched) out.push(zh ? `- ${m.id}: launched — 变更须先立案` : `- ${m.id}: launched — changes require a proposal first`);
process.stdout.write(out.join('\n'));
JSEOF
  node "$_mlc_js" "${LOCALE:-en}" 2>/dev/null || true
  rm -f "$_mlc_js"
}
MODULE_LIFECYCLE="$(module_lifecycle_context)"

# Build additional context
CONTEXT="=== OpenLogos Project Context ===
Project: $PROJECT_NAME
Locale: $LOCALE
Lifecycle: $LIFECYCLE
Current Phase: $CURRENT_PHASE
Suggested Next: $SUGGESTION
$LANG_POLICY${CAPABILITIES:+
$CAPABILITIES}
$CHANGE_MGMT${MODULE_LIFECYCLE:+
$MODULE_LIFECYCLE}
=== End OpenLogos Context ==="

# JSON-escape context and status line
if [ "$NODE_OK" -eq 1 ]; then
  CONTEXT_ESCAPED=$(printf '%s' "$CONTEXT" | node -e "console.log(JSON.stringify(require('fs').readFileSync(0,'utf-8')))" 2>/dev/null || echo '""')
  SYS_MSG_ESCAPED=$(printf '%s' "$STATUS_LINE" | node -e "const d=require('fs').readFileSync(0,'utf-8');(()=>{const s=JSON.stringify(d);process.stdout.write(s.slice(1,-1))})()" 2>/dev/null || echo "$STATUS_LINE")
fi
if [ "$NODE_OK" -ne 1 ] && has_python; then
  CONTEXT_ESCAPED=$(printf '%s' "$CONTEXT" | run_python -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo '""')
  SYS_MSG_ESCAPED=$(printf '%s' "$STATUS_LINE" | run_python -c "import sys,json; s=sys.stdin.read(); print(json.dumps(s)[1:-1])" 2>/dev/null || echo "$STATUS_LINE")
fi
if [ "$NODE_OK" -ne 1 ] && ! has_python; then
  CONTEXT_ESCAPED='""'
  SYS_MSG_ESCAPED="$STATUS_LINE"
fi

cat <<ENDJSON
{
  "systemMessage": "$SYS_MSG_ESCAPED",
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $CONTEXT_ESCAPED
  }
}
ENDJSON
