#!/usr/bin/env bash
#
# dev-log.sh — 启动所有服务，将日志分别写入 .log/ 目录
# 用法: ./scripts/dev-log.sh          (启动所有服务)
#       ./scripts/dev-log.sh web api   (只启动指定服务)
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.log"
PID_FILE="$LOG_DIR/.pids"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
RESET='\033[0m'

# 服务定义: name|dir|command|color|port
declare -A SERVICES
SERVICES[web]="apps/web|pnpm dev|${CYAN}|3000"
SERVICES[api]="apps/api-cf|pnpm dev|${GREEN}|8787"
SERVICES[auth]="apps/auth-gateway|pnpm dev|${YELLOW}|8788"
SERVICES[sync]="apps/loro-sync-server|pnpm dev|${MAGENTA}|8789"

# 全部可用服务名
ALL_SERVICES=(web api auth sync)

# 要启动的服务（默认全部）
if [ $# -gt 0 ]; then
  SELECTED=("$@")
else
  SELECTED=("${ALL_SERVICES[@]}")
fi

# 清理函数
cleanup() {
  echo -e "\n${RED}Shutting down services...${RESET}"
  if [ -f "$PID_FILE" ]; then
    while read -r pid; do
      kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  # 杀掉所有子进程
  jobs -p | xargs -r kill 2>/dev/null || true
  wait 2>/dev/null || true
  echo -e "${GREEN}All services stopped.${RESET}"
}
trap cleanup EXIT INT TERM

# 初始化日志目录
mkdir -p "$LOG_DIR"
rm -f "$PID_FILE"

# 带颜色前缀的日志函数
run_service() {
  local name="$1"
  local config="${SERVICES[$name]}"

  IFS='|' read -r dir cmd color port <<< "$config"

  local log_file="$LOG_DIR/${name}.log"
  local padded_name
  padded_name=$(printf '%-4s' "$name")

  # 清空旧日志
  : > "$log_file"

  echo -e "${color}[$padded_name]${RESET} Starting on port ${port}... (log: .log/${name}.log)"

  # 启动服务，同时输出到终端（带颜色前缀）和日志文件
  cd "$ROOT_DIR/$dir"
  $cmd 2>&1 | while IFS= read -r line; do
    # 写入日志文件（纯文本）
    echo "$line" >> "$log_file"
    # 带颜色前缀输出到终端
    echo -e "${color}[$padded_name]${RESET} $line"
  done &

  echo $! >> "$PID_FILE"
}

# 打印头部信息
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BLUE}  Clash Dev Server — $(date '+%Y-%m-%d %H:%M:%S')${RESET}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  ${CYAN}web ${RESET} http://localhost:3000    .log/web.log"
echo -e "  ${GREEN}api ${RESET} http://localhost:8787    .log/api.log"
echo -e "  ${YELLOW}auth${RESET} http://localhost:8788    .log/auth.log"
echo -e "  ${MAGENTA}sync${RESET} http://localhost:8789    .log/sync.log"
echo ""
echo -e "${GRAY}  Ctrl+C to stop all services${RESET}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# 启动选定的服务
for svc in "${SELECTED[@]}"; do
  if [[ -v "SERVICES[$svc]" ]]; then
    run_service "$svc"
  else
    echo -e "${RED}Unknown service: $svc${RESET}"
    echo "Available: ${ALL_SERVICES[*]}"
    exit 1
  fi
done

# 等待所有子进程
wait
