/**
 * Derived runtime status — single source of truth shared by every
 * endpoint that surfaces runtime liveness.
 *
 * The raw `runtime.status` column only flips to `'offline'` on an
 * explicit graceful disconnect from the daemon. SIGKILL / host crash /
 * laptop lid close don't produce that signal, so the row sits at
 * `'online'` indefinitely while `last_heartbeat` ages out. Without a
 * derived view the UI lies to users about runtime liveness and the
 * browser's reconnect loop pumps out orphan `runtime_session` rows
 * (we found 239 of them in a single afternoon before this landed).
 *
 * Daemon heartbeats at ~30s cadence. 90s = 3 missed beats before we
 * call it dead — long enough to tolerate the occasional network hiccup
 * or laptop sleep wake, short enough that a real outage surfaces fast.
 */

export const RUNTIME_HEARTBEAT_STALE_SEC = 90;

export function deriveRuntimeStatus(
  rawStatus: string,
  lastHeartbeat: number | null,
): string {
  if (rawStatus !== "online") return rawStatus;
  if (lastHeartbeat == null) return "offline";
  const now = Math.floor(Date.now() / 1000);
  if (now - lastHeartbeat > RUNTIME_HEARTBEAT_STALE_SEC) return "offline";
  return "online";
}
