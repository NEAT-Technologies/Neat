#!/usr/bin/env bash
# PreToolUse hook for NEAT contracts.
# Wired in .claude/settings.json against Edit, Write, MultiEdit.
#
# Reads the tool payload from stdin, finds every contract in
# docs/contracts/*.md whose `governs:` frontmatter glob matches the target
# file path, and surfaces the matching contract bodies as additionalContext.
# The model reads the binding rules at the moment of writing.
#
# Output is a JSON object keyed `hookSpecificOutput.additionalContext`.
# If no contracts match, the hook is a silent no-op (exit 0, empty output).

set -euo pipefail

INPUT=$(cat)

# Pick the file path off whichever shape the tool input arrived in.
# Edit / Write use file_path; MultiEdit nests edits but still has file_path.
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CONTRACTS_DIR="$PROJECT_DIR/docs/contracts"

if [ ! -d "$CONTRACTS_DIR" ]; then
  exit 0
fi

# Make the file path relative to the project root for glob matching.
REL_PATH="${FILE_PATH#$PROJECT_DIR/}"

# Walk every contract file. Extract the `governs:` block from frontmatter.
# For each glob, test if REL_PATH matches via shell pattern.
RELEVANT=()
for contract in "$CONTRACTS_DIR"/*.md; do
  [ -f "$contract" ] || continue
  base=$(basename "$contract")
  # Skip the index and the hook itself; only per-topic contracts have governs.
  case "$base" in
    _*|index.md) continue ;;
  esac

  # Parse `governs:` frontmatter list. Frontmatter is between the first two
  # `---` lines. Lines under `governs:` look like `  - "packages/..."`.
  GLOBS=$(awk '
    /^---$/ { fm = !fm; next }
    fm && /^governs:/ { in_governs = 1; next }
    fm && in_governs && /^  - / {
      sub(/^  - /, "")
      gsub(/"/, "")
      print
      next
    }
    fm && in_governs && /^[a-z]/ { in_governs = 0 }
  ' "$contract")

  while IFS= read -r glob; do
    [ -z "$glob" ] && continue
    case "$REL_PATH" in
      $glob) RELEVANT+=("$contract"); break ;;
    esac
  done <<< "$GLOBS"
done

if [ ${#RELEVANT[@]} -eq 0 ]; then
  exit 0
fi

# Build the additionalContext payload.
CONTEXT="The following NEAT contracts govern this file. Read them before editing — they are binding."$'\n'
for c in "${RELEVANT[@]}"; do
  CONTEXT+=$'\n\n----\n\n'
  CONTEXT+="$(cat "$c")"
done

# Emit the structured PreToolUse response.
jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: $ctx
  }
}'
