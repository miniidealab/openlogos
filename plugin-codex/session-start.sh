#!/usr/bin/env bash
# OpenLogos Codex Plugin — SessionStart hook
# Injects current phase and next-step context into the Codex session.
# Falls back silently (returns {}) if the CLI is unavailable or project is not initialized.
#
# Output format: {"systemMessage": "...", "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "..."}}
# Codex uses systemMessage; additionalContext is included for forward compatibility.

set -euo pipefail

if ! command -v openlogos &>/dev/null; then
  echo "{}"
  exit 0
fi

if [ ! -f "logos/logos.config.json" ]; then
  echo "{}"
  exit 0
fi

STATUS=$(openlogos status --format json 2>/dev/null || echo "")

# Parse JSON using python3 (preferred) or node
_py_parse() {
  python3 -c "import sys,json; d=json.load(sys.stdin); $1" 2>/dev/null || echo "$2"
}
_node_parse() {
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);$1}catch(e){process.stdout.write('$2')}})" 2>/dev/null || echo "$2"
}

if command -v python3 &>/dev/null; then
  LOCALE=$(python3 -c "import json; d=json.load(open('logos/logos.config.json')); print(d.get('locale','en'))" 2>/dev/null || echo "en")
  CONFIG_LIFECYCLE=$(python3 -c "import json; d=json.load(open('logos/logos.config.json')); print(d.get('lifecycle',''))" 2>/dev/null || echo "")
  PROJECT_NAME=$(python3 -c "import json; d=json.load(open('logos/logos.config.json')); print(d.get('name',''))" 2>/dev/null || echo "")
  STATUS_LIFECYCLE=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('lifecycle',''))" 2>/dev/null || echo "")
  CURRENT_PHASE=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('current_phase') or 'all-done')" 2>/dev/null || echo "unknown")
  SUGGESTION=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('suggestion','Run openlogos status for next steps'))" 2>/dev/null || echo "")
  ALL_DONE=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('data',{}).get('all_done') else 'false')" 2>/dev/null || echo "false")
  ACTIVE_CHANGE=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',{}); active=data.get('active_change') or ''; mods=data.get('modules') or []; print(active or next((m.get('active_change',{}).get('slug','') for m in mods if isinstance(m.get('active_change'),dict) and m.get('active_change',{}).get('slug')), ''))" 2>/dev/null || echo "")
  PROPOSAL_STEP=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',{}); step=data.get('proposal_step') or ''; mods=data.get('modules') or []; print(step or next((m.get('active_change',{}).get('proposal_step','') for m in mods if isinstance(m.get('active_change'),dict) and m.get('active_change',{}).get('proposal_step')), ''))" 2>/dev/null || echo "")
elif command -v node &>/dev/null; then
  LOCALE=$(node -e "const d=JSON.parse(require('fs').readFileSync('logos/logos.config.json','utf-8')); console.log(d.locale||'en')" 2>/dev/null || echo "en")
  CONFIG_LIFECYCLE=$(node -e "const d=JSON.parse(require('fs').readFileSync('logos/logos.config.json','utf-8')); console.log(d.lifecycle||'')" 2>/dev/null || echo "")
  PROJECT_NAME=$(node -e "const d=JSON.parse(require('fs').readFileSync('logos/logos.config.json','utf-8')); console.log(d.name||'')" 2>/dev/null || echo "")
  STATUS_LIFECYCLE=$(echo "$STATUS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log((r.data||{}).lifecycle||'')}catch(e){console.log('')}})" 2>/dev/null || echo "")
  CURRENT_PHASE=$(echo "$STATUS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log((r.data||{}).current_phase||'all-done')}catch(e){console.log('unknown')}})" 2>/dev/null || echo "unknown")
  SUGGESTION=$(echo "$STATUS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log((r.data||{}).suggestion||'')}catch(e){console.log('')}})" 2>/dev/null || echo "")
  ALL_DONE=$(echo "$STATUS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log((r.data||{}).all_done?'true':'false')}catch(e){console.log('false')}})" 2>/dev/null || echo "false")
  ACTIVE_CHANGE=$(echo "$STATUS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const data=(JSON.parse(d).data)||{};const mod=(data.modules||[]).find(m=>m.active_change&&m.active_change.slug);console.log(data.active_change||mod?.active_change?.slug||'')}catch(e){console.log('')}})" 2>/dev/null || echo "")
  PROPOSAL_STEP=$(echo "$STATUS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const data=(JSON.parse(d).data)||{};const mod=(data.modules||[]).find(m=>m.active_change&&m.active_change.proposal_step);console.log(data.proposal_step||mod?.active_change?.proposal_step||'')}catch(e){console.log('')}})" 2>/dev/null || echo "")
else
  echo "{}"
  exit 0
fi

LIFECYCLE="${STATUS_LIFECYCLE:-${CONFIG_LIFECYCLE:-initial}}"
if [ -z "$STATUS_LIFECYCLE" ] && [ "$LIFECYCLE" = "initial" ] && [ -f "logos/.openlogos-guard" ]; then
  LIFECYCLE="launched"
fi

change_management_message() {
  local active="$1"
  local step="${2:-}"
  local base="Change Management: ACTIVE — guard file detected. Active change proposal: '$active'."
  local confirm="openlogos merge, openlogos verify, openlogos smoke, openlogos archive, deployment, and git push are human confirmation points: AI must not execute them without explicit user authorization."

  case "$step" in
    writing)
      echo "$base Current proposal step: writing. Allowed files: logos/changes/$active/proposal.md and logos/changes/$active/tasks.md. Do not write deltas or source code yet. $confirm"
      ;;
    ready-to-delta)
      echo "$base Current proposal step: ready-to-delta. The plan is ready for approval; after approval or openlogos next --auto, proceed to delta-writing. Do not modify source code or logos/resources/** directly. $confirm"
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
    if command -v python3 &>/dev/null; then
      ACTIVE_CHANGE=$(python3 -c "import json; d=json.load(open('$GUARD_FILE')); print(d.get('activeChange',''))" 2>/dev/null || echo "")
    elif command -v node &>/dev/null; then
      ACTIVE_CHANGE=$(node -e "const d=JSON.parse(require('fs').readFileSync('$GUARD_FILE','utf-8')); console.log(d.activeChange||'')" 2>/dev/null || echo "")
    else
      ACTIVE_CHANGE=""
    fi
  fi

  if [ -n "${ACTIVE_CHANGE:-}" ]; then
    GUARD_STATUS="🔓 Active change: $ACTIVE_CHANGE"
    CHANGE_MGMT=$(change_management_message "$ACTIVE_CHANGE" "${PROPOSAL_STEP:-}")
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

# Build additional context
CONTEXT="=== OpenLogos Project Context ===
Project: $PROJECT_NAME
Locale: $LOCALE
Lifecycle: $LIFECYCLE
Current Phase: $CURRENT_PHASE
Suggested Next: $SUGGESTION
$LANG_POLICY
$CHANGE_MGMT
=== End OpenLogos Context ==="

# JSON-escape context and status line
if command -v python3 &>/dev/null; then
  CONTEXT_ESCAPED=$(printf '%s' "$CONTEXT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo '""')
  SYS_MSG_ESCAPED=$(printf '%s' "$STATUS_LINE" | python3 -c "import sys,json; s=sys.stdin.read(); print(json.dumps(s)[1:-1])" 2>/dev/null || echo "$STATUS_LINE")
elif command -v node &>/dev/null; then
  CONTEXT_ESCAPED=$(printf '%s' "$CONTEXT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(d)))" 2>/dev/null || echo '""')
  SYS_MSG_ESCAPED=$(printf '%s' "$STATUS_LINE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const s=JSON.stringify(d);process.stdout.write(s.slice(1,-1))})" 2>/dev/null || echo "$STATUS_LINE")
else
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
