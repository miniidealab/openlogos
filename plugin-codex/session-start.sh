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

STATUS=$(openlogos status --format json 2>/dev/null) || { echo "{}"; exit 0; }

# Parse JSON using python3 (preferred) or node
_py_parse() {
  python3 -c "import sys,json; d=json.load(sys.stdin); $1" 2>/dev/null || echo "$2"
}
_node_parse() {
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);$1}catch(e){process.stdout.write('$2')}})" 2>/dev/null || echo "$2"
}

if command -v python3 &>/dev/null; then
  LOCALE=$(python3 -c "import json; d=json.load(open('logos/logos.config.json')); print(d.get('locale','en'))" 2>/dev/null || echo "en")
  LIFECYCLE=$(python3 -c "import json; d=json.load(open('logos/logos.config.json')); print(d.get('lifecycle','initial'))" 2>/dev/null || echo "initial")
  PROJECT_NAME=$(python3 -c "import json; d=json.load(open('logos/logos.config.json')); print(d.get('name',''))" 2>/dev/null || echo "")
  CURRENT_PHASE=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('current_phase') or 'all-done')" 2>/dev/null || echo "unknown")
  SUGGESTION=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('suggestion','Run openlogos status for next steps'))" 2>/dev/null || echo "")
  ALL_DONE=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('data',{}).get('all_done') else 'false')" 2>/dev/null || echo "false")
elif command -v node &>/dev/null; then
  LOCALE=$(node -e "const d=JSON.parse(require('fs').readFileSync('logos/logos.config.json','utf-8')); console.log(d.locale||'en')" 2>/dev/null || echo "en")
  LIFECYCLE=$(node -e "const d=JSON.parse(require('fs').readFileSync('logos/logos.config.json','utf-8')); console.log(d.lifecycle||'initial')" 2>/dev/null || echo "initial")
  PROJECT_NAME=$(node -e "const d=JSON.parse(require('fs').readFileSync('logos/logos.config.json','utf-8')); console.log(d.name||'')" 2>/dev/null || echo "")
  CURRENT_PHASE=$(echo "$STATUS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log((r.data||{}).current_phase||'all-done')}catch(e){console.log('unknown')}})" 2>/dev/null || echo "unknown")
  SUGGESTION=$(echo "$STATUS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log((r.data||{}).suggestion||'')}catch(e){console.log('')}})" 2>/dev/null || echo "")
  ALL_DONE=$(echo "$STATUS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log((r.data||{}).all_done?'true':'false')}catch(e){console.log('false')}})" 2>/dev/null || echo "false")
else
  echo "{}"
  exit 0
fi

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

if [ "$LIFECYCLE" = "active" ] && [ -f "$GUARD_FILE" ]; then
  if command -v python3 &>/dev/null; then
    ACTIVE_CHANGE=$(python3 -c "import json; d=json.load(open('$GUARD_FILE')); print(d.get('activeChange',''))" 2>/dev/null || echo "")
  elif command -v node &>/dev/null; then
    ACTIVE_CHANGE=$(node -e "const d=JSON.parse(require('fs').readFileSync('$GUARD_FILE','utf-8')); console.log(d.activeChange||'')" 2>/dev/null || echo "")
  else
    ACTIVE_CHANGE=""
  fi

  if [ -n "$ACTIVE_CHANGE" ]; then
    GUARD_STATUS="🔓 Active change: $ACTIVE_CHANGE"
    CHANGE_MGMT="Change Management: ACTIVE — guard file detected. Active change proposal: '$ACTIVE_CHANGE'. Only modify files within the scope of logos/changes/$ACTIVE_CHANGE/proposal.md. openlogos merge and openlogos archive are human confirmation points: AI must not execute them without explicit user authorization. When coding is done, remind the user to explicitly authorize running: openlogos merge $ACTIVE_CHANGE (then after review: openlogos archive $ACTIVE_CHANGE). If the user explicitly requests execution (including via slash commands), AI may execute."
  else
    GUARD_STATUS="⛔ NO active change proposal"
    CHANGE_MGMT="Change Management: ACTIVE — ⛔ NO guard file found. Before modifying ANY source code, you MUST first run openlogos change <slug> to create a change proposal."
  fi
elif [ "$LIFECYCLE" = "active" ]; then
  GUARD_STATUS="⛔ NO active change proposal"
  CHANGE_MGMT="Change Management: ACTIVE — ⛔ NO guard file found. Before modifying ANY source code, you MUST first run openlogos change <slug> to create a change proposal."
else
  CHANGE_MGMT="Change Management: Initial development — follow Phase progression, no change proposals needed."
fi

# Build system message
if [ "$ALL_DONE" = "true" ]; then
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
