#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
LINES_ADDED=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
LINES_REMOVED=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')

CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

# Pick bar color based on context usage
if [ "$PCT" -ge 90 ]; then
  BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then
  BAR_COLOR="$YELLOW"
else BAR_COLOR="$GREEN"; fi

FILLED=$((PCT / 10))
EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"
printf -v PAD "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

MINS=$((DURATION_MS / 60000))
SECS=$(((DURATION_MS % 60000) / 1000))

BRANCH=""
git rev-parse --git-dir >/dev/null 2>&1 && BRANCH=" | 🌿 $(git branch --show-current 2>/dev/null)"

COST_FMT=$(printf '$%.2f' "$COST")

ADDED=""
if [ "$LINES_ADDED" -gt 0 ]; then
  ADDED=" +${LINES_ADDED}"
fi

REMOVED=""
if [ "$LINES_REMOVED" -gt 0 ]; then
  REMOVED=" -${LINES_REMOVED}"
fi

echo -e "📁 ${DIR##*/}$BRANCH | 🤖 ${CYAN}$MODEL${RESET} | ✏️ ${BAR_COLOR}${BAR}${RESET} ${PCT}%${GREEN}$ADDED${RESET}${RED}$REMOVED${RESET} | ⏱️ ${MINS}m ${SECS}s"
