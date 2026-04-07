#!/usr/bin/env bash
# Build script: copies OpenLogos skills into the Claude Code plugin directory
# with proper SKILL.md frontmatter for Claude Code auto-discovery.
#
# Usage:
#   ./scripts/build-plugin-skills.sh              # default: English
#   ./scripts/build-plugin-skills.sh --locale zh   # Chinese

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_SRC="$ROOT/skills"
PLUGIN_SKILLS="$ROOT/plugin/skills"
LOCALE="en"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --locale) LOCALE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

get_description() {
  case "$1" in
    project-init)
      echo "Initialize OpenLogos project structure and directory layout. Use when the user wants to set up a new project with openlogos init or needs help with project initialization." ;;
    prd-writer)
      echo "Write product requirements documents following OpenLogos methodology. Use when logos/resources/prd/1-product-requirements/ is empty or the user needs to create/update scenario-driven requirements with GIVEN/WHEN/THEN acceptance criteria." ;;
    product-designer)
      echo "Create product design specifications including feature specs and page designs. Use when requirements exist in logos/resources/prd/1-product-requirements/ but logos/resources/prd/2-product-design/ is empty." ;;
    architecture-designer)
      echo "Design technical architecture and select technology stack. Use when product design exists in logos/resources/prd/2-product-design/ but logos/resources/prd/3-technical-plan/1-architecture/ is empty." ;;
    scenario-architect)
      echo "Model business scenarios as detailed sequence diagrams with API calls. Use when architecture exists in 3-technical-plan/1-architecture/ but 3-technical-plan/2-scenario-implementation/ is empty. Scenarios must be complete user action paths, NOT single API calls." ;;
    api-designer)
      echo "Design OpenAPI specifications derived from scenario sequence diagrams. Use when scenarios exist in 2-scenario-implementation/ but logos/resources/api/ is empty. All description and summary values in YAML must be double-quoted." ;;
    db-designer)
      echo "Design database schema based on API and scenario requirements. Use when scenarios exist but logos/resources/database/ is empty." ;;
    test-writer)
      echo "Write unit test and scenario test case documents. Use when API specs exist in logos/resources/api/ but logos/resources/test/ is empty." ;;
    test-orchestrator)
      echo "Design API orchestration test scenarios as executable JSON. Use when test cases exist in logos/resources/test/ but logos/resources/scenario/ is empty. For API projects only." ;;
    code-reviewer)
      echo "Review code for OpenLogos methodology compliance, including YAML validity checks. Use when reviewing code changes, checking pull requests, or performing code quality analysis." ;;
    change-writer)
      echo "Write change proposals with impact analysis following OpenLogos delta workflow. Use when the project lifecycle is active and source code or methodology documents need modification." ;;
    merge-executor)
      echo "Execute delta merges by generating MERGE_PROMPT.md from change proposals. Use when an approved change proposal needs to be applied to the codebase." ;;
    *)
      echo "OpenLogos skill: $1" ;;
  esac
}

echo "Building plugin skills (locale: $LOCALE)..."
echo ""

COUNT=0
for SKILL_DIR in "$SKILLS_SRC"/*/; do
  SKILL_NAME="$(basename "$SKILL_DIR")"

  if [ "$LOCALE" = "en" ] && [ -f "$SKILL_DIR/SKILL.en.md" ]; then
    SRC_FILE="$SKILL_DIR/SKILL.en.md"
  elif [ -f "$SKILL_DIR/SKILL.md" ]; then
    SRC_FILE="$SKILL_DIR/SKILL.md"
  else
    echo "  ⚠ Skipping $SKILL_NAME (no SKILL.md found)"
    continue
  fi

  DESC="$(get_description "$SKILL_NAME")"

  TARGET_DIR="$PLUGIN_SKILLS/$SKILL_NAME"
  mkdir -p "$TARGET_DIR"

  {
    echo "---"
    echo "name: $SKILL_NAME"
    echo "description: \"$DESC\""
    echo "---"
    echo ""
    cat "$SRC_FILE"
  } > "$TARGET_DIR/SKILL.md"

  COUNT=$((COUNT + 1))
  echo "  ✓ $SKILL_NAME"
done

echo ""
echo "Done: $COUNT skills built into plugin/skills/"
