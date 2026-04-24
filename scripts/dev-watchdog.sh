#!/usr/bin/env bash
# Dev watchdog — keeps api-cf + gateway alive locally.
#
# Wrangler dev (workerd) leaks memory over hours under HMR + WS churn and
# eventually OOMs. This script polls each service's port and respawns whichever
# is dead. Run in its own terminal alongside `make dev`.
#
# Usage:
#   scripts/dev-watchdog.sh                # watch both (default)
#   scripts/dev-watchdog.sh api-cf         # watch api-cf only
#   scripts/dev-watchdog.sh gateway        # watch gateway only
#
# Tweak the interval via WATCHDOG_INTERVAL (seconds, default 15).

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INTERVAL="${WATCHDOG_INTERVAL:-15}"
WHICH="${1:-both}"

log() { printf '[watchdog %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# TCP listen check — any HTTP status back means the workerd is alive (404 / 500
# still count as "up"). Pure `nc -z` is the simplest portable probe.
port_alive() { nc -z 127.0.0.1 "$1" 2>/dev/null; }

kill_pattern() {
    local pat="$1"
    # shellcheck disable=SC2009
    local pids
    pids="$(pgrep -f "$pat" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
        # shellcheck disable=SC2086
        kill $pids 2>/dev/null || true
        sleep 1
        # shellcheck disable=SC2086
        kill -9 $pids 2>/dev/null || true
    fi
}

restart_api_cf() {
    log "api-cf :8789 unreachable → restart"
    kill_pattern "wrangler.*--port 8789"
    kill_pattern "apps/api-cf.*pnpm dev"
    sleep 2
    ( cd "$ROOT" && nohup make dev-api-cf > /tmp/api-cf-current.log 2>&1 & )
}

restart_gateway() {
    log "gateway :3000 unreachable → restart"
    kill_pattern "wrangler.*--port 3000"
    kill_pattern "apps/gateway.*pnpm dev"
    sleep 2
    ( cd "$ROOT" && nohup make dev-gateway > /tmp/gateway-current.log 2>&1 & )
}

watch_api_cf() { ! port_alive 8789 && restart_api_cf; }
watch_gateway() { ! port_alive 3000 && restart_gateway; }

log "watching: $WHICH  (interval ${INTERVAL}s)"
while true; do
    case "$WHICH" in
        api-cf)  watch_api_cf ;;
        gateway) watch_gateway ;;
        both)    watch_api_cf; watch_gateway ;;
        *) log "unknown target: $WHICH"; exit 1 ;;
    esac
    sleep "$INTERVAL"
done
