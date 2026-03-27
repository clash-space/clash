#!/usr/bin/env bash
#
# logs.sh — 查看服务日志
#
# 用法:
#   ./scripts/logs.sh              # 实时 tail 所有服务日志
#   ./scripts/logs.sh api          # 只看 api 日志
#   ./scripts/logs.sh web sync     # 同时看 web + sync
#   ./scripts/logs.sh -n 100 api   # 看 api 最近 100 行
#   ./scripts/logs.sh --error      # 只看错误日志
#   ./scripts/logs.sh --error api  # 只看 api 错误日志
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.log"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
RESET='\033[0m'

ALL_SERVICES=(web api auth sync)
LINES=50
FILTER=""
SELECTED=()

# 解析参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n)
      LINES="$2"
      shift 2
      ;;
    --error|--errors|-e)
      FILTER="ERROR"
      shift
      ;;
    --warn|-w)
      FILTER="WARN"
      shift
      ;;
    --info|-i)
      FILTER="INFO"
      shift
      ;;
    -h|--help)
      echo "Usage: logs.sh [options] [service...]"
      echo ""
      echo "Services: web, api, auth, sync"
      echo ""
      echo "Options:"
      echo "  -n NUM      Show last NUM lines (default: 50)"
      echo "  -e|--error  Filter ERROR level only"
      echo "  -w|--warn   Filter WARN+ level"
      echo "  -i|--info   Filter INFO+ level"
      echo "  -h|--help   Show this help"
      exit 0
      ;;
    *)
      SELECTED+=("$1")
      shift
      ;;
  esac
done

# 默认全部服务
if [ ${#SELECTED[@]} -eq 0 ]; then
  SELECTED=("${ALL_SERVICES[@]}")
fi

# 检查日志目录
if [ ! -d "$LOG_DIR" ]; then
  echo -e "${RED}No log directory found. Run 'npm run dev:log' first.${RESET}"
  exit 1
fi

# 颜色映射
declare -A COLORS
COLORS[web]="$CYAN"
COLORS[api]="$GREEN"
COLORS[auth]="$YELLOW"
COLORS[sync]="$MAGENTA"

# 收集日志文件
LOG_FILES=()
for svc in "${SELECTED[@]}"; do
  log_file="$LOG_DIR/${svc}.log"
  if [ -f "$log_file" ]; then
    LOG_FILES+=("$log_file")
  else
    echo -e "${GRAY}[$svc] No log file yet${RESET}"
  fi
done

if [ ${#LOG_FILES[@]} -eq 0 ]; then
  echo -e "${RED}No log files found. Run 'npm run dev:log' first.${RESET}"
  exit 1
fi

echo -e "${GRAY}Tailing logs for: ${SELECTED[*]} (last $LINES lines)${RESET}"
echo -e "${GRAY}Press Ctrl+C to stop${RESET}"
echo ""

# 使用 tail -f 跟踪日志，支持过滤
if [ -n "$FILTER" ]; then
  tail -n "$LINES" -f "${LOG_FILES[@]}" | grep --line-buffered -i "$FILTER"
else
  tail -n "$LINES" -f "${LOG_FILES[@]}"
fi
