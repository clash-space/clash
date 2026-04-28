/**
 * RuntimeRoom — Durable Object for one user's runtime (one machine).
 *
 * Addressed by `idFromName(runtime_id)` so daemon and browser subscribers
 * always land on the same instance.
 *
 * Two kinds of WS attached here, distinguished by hibernation tag:
 *   - "daemon"           — the long-running clash-bridge process. Exactly one.
 *   - "client:<sid>"     — a browser tab subscribed to a session's events.
 *                          N-per-session (multiple tabs / re-connects).
 *
 * Routing:
 *   daemon → DO     {type: hello/ping}                  → DB updates + ack
 *   daemon → DO     {type: session.event/.complete/etc, session_id}
 *                                                       → fan-out to all
 *                                                          "client:<sid>" WSs
 *   client → DO     {type: prompt/cancel/dispose}       → forward to daemon
 *                   (the DO knows session_id from the WS tag, so the client
 *                    doesn't repeat it on every message)
 *
 * Auth:
 *   - Daemon WS: bearer token verified at /agents/runtime/_attach route
 *     (authenticateRuntimeToken) → forwarded as x-runtime-id / -user headers.
 *   - Client WS: user session verified at /api/v1/sessions/:id/_stream
 *     route → forwarded as x-session-id / -user headers (and we re-check
 *     the session belongs to that user via the runtime_session row).
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../config";
import { log } from "../logger";

interface DaemonHello {
  type: "hello";
  machine_id?: string;
  hostname?: string;
  os?: string;
  version?: string;
  agents?: Array<{ id: string; binary?: string; version?: string }>;
}

type DaemonMessage = DaemonHello | { type: string; [k: string]: unknown };

const CLIENT_TAG_PREFIX = "client:";
function clientTag(sessionId: string): string { return `${CLIENT_TAG_PREFIX}${sessionId}`; }
function sessionFromTag(tag: string): string | null {
  return tag.startsWith(CLIENT_TAG_PREFIX) ? tag.slice(CLIENT_TAG_PREFIX.length) : null;
}

export class RuntimeRoom extends DurableObject<Env> {
  /** Cached on first attach so logs / DB writes don't need a fresh lookup. */
  private runtimeId = "";
  private userId = "";

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }

    const role = request.headers.get("x-attach-role"); // "daemon" | "client"
    if (role === "daemon") return this.attachDaemon(request);
    if (role === "client") return this.attachClient(request);
    return new Response("missing or invalid x-attach-role", { status: 400 });
  }

  private async attachDaemon(request: Request): Promise<Response> {
    const runtimeId = request.headers.get("x-runtime-id") ?? "";
    const userId = request.headers.get("x-runtime-user") ?? "";
    if (!runtimeId || !userId) {
      return new Response("missing runtime headers", { status: 400 });
    }

    // One daemon per runtime. A reconnecting daemon needs the prior WS
    // to be reaped first — CF should fire `webSocketClose` on the old TCP
    // long before a fresh attempt arrives, but if not we 409 the new one
    // and let the daemon retry after the close finally lands.
    const existing = this.ctx.getWebSockets("daemon");
    if (existing.length > 0) {
      try {
        existing[0].send(JSON.stringify({ type: "ping" }));
        return new Response("daemon already attached", { status: 409 });
      } catch {
        try { existing[0].close(1011, "stale"); } catch { /* already closing */ }
      }
    }

    this.runtimeId = runtimeId;
    this.userId = userId;
    await this.ctx.storage.put("runtime_id", runtimeId);
    await this.ctx.storage.put("user_id", userId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["daemon"]);
    log.info(`${this.tag()} daemon attached`);

    await this.markOnline();
    return new Response(null, { status: 101, webSocket: client });
  }

  private async attachClient(request: Request): Promise<Response> {
    const sessionId = request.headers.get("x-session-id") ?? "";
    if (!sessionId) return new Response("missing x-session-id", { status: 400 });

    await this.ensureIdentity();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [clientTag(sessionId)]);
    log.info(`${this.tag()} client attached for session ${sessionId.slice(0, 8)}`);

    const daemonUp = this.ctx.getWebSockets("daemon").length > 0;
    try {
      server.send(JSON.stringify({ type: "attached", daemon_online: daemonUp }));
    } catch { /* race: client already closed */ }

    // Replay last terminal/transition state for this session if any.
    // POST /sessions → daemon session.start → daemon session.ready almost
    // always arrives BEFORE the client opens its WS, so the broadcast
    // would otherwise hit zero subscribers and the client would hang
    // waiting for a session.ready that already happened.
    const replay = await this.ctx.storage.get<Record<string, unknown>>(
      this.sessionStateKey(sessionId),
    );
    if (replay) {
      try { server.send(JSON.stringify(replay)); } catch { /* client closed */ }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private sessionStateKey(sessionId: string): string {
    return `session_state:${sessionId}`;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let parsed: DaemonMessage;
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      parsed = JSON.parse(text);
    } catch (e) {
      log.warn(`${this.tag()} bad ws message:`, e);
      return;
    }

    await this.ensureIdentity();

    const tags = this.ctx.getTags(ws);
    const isDaemon = tags.includes("daemon");

    if (isDaemon) {
      await this.onDaemonMessage(ws, parsed);
    } else {
      // It's a client. Find which session via tag.
      const sid = tags.map(sessionFromTag).find((s) => !!s);
      if (!sid) return;
      this.onClientMessage(sid, parsed);
    }
  }

  private async onDaemonMessage(ws: WebSocket, parsed: DaemonMessage): Promise<void> {
    if (parsed.type === "hello") {
      const m = parsed as DaemonHello;
      const agents = Array.isArray(m.agents) ? m.agents : [];
      const version = typeof m.version === "string" ? m.version : "unknown";
      const hostname = typeof m.hostname === "string" ? m.hostname : null;
      const os = typeof m.os === "string" ? m.os : null;
      try {
        const cols = ["agents_json = ?", "version = ?", "status = 'online'", "last_heartbeat = unixepoch()"];
        const args: unknown[] = [JSON.stringify(agents), version];
        if (hostname) { cols.push("hostname = ?"); args.push(hostname); }
        if (os) { cols.push("os = ?"); args.push(os); }
        args.push(this.runtimeId);
        await this.env.DB.prepare(
          `UPDATE runtime SET ${cols.join(", ")} WHERE id = ?`,
        ).bind(...args).run();
      } catch (e) {
        log.error(`${this.tag()} hello DB update failed:`, e);
      }
      try { ws.send(JSON.stringify({ type: "welcome", runtime_id: this.runtimeId })); } catch { /* ignore */ }
      // Tell every connected client that the daemon is now online.
      this.broadcastToAllClients({ type: "daemon_online" });
      log.info(`${this.tag()} hello: ${agents.length} agents, v${version}`);
      return;
    }

    if (parsed.type === "ping") {
      try {
        await this.env.DB.prepare(
          "UPDATE runtime SET last_heartbeat = unixepoch(), status = 'online' WHERE id = ?",
        ).bind(this.runtimeId).run();
      } catch (e) {
        log.error(`${this.tag()} ping DB update failed:`, e);
      }
      try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* ignore */ }
      return;
    }

    // Session-related daemon messages — fan out to clients of that session.
    // Wire shape from session-manager.ts:
    //   session.ready    { session_id, acp_session_id }
    //   session.event    { session_id, turn_id, event }
    //   session.complete { session_id, turn_id }
    //   session.error    { session_id, turn_id?, message }
    //   session.disposed { session_id }
    if (typeof parsed.type === "string" && parsed.type.startsWith("session.")) {
      const sid = (parsed as { session_id?: string }).session_id;
      if (!sid) {
        log.warn(`${this.tag()} daemon ${parsed.type} missing session_id`);
        return;
      }
      // Persist transition states so a client that opens its WS *after*
      // session.ready / session.error arrived still gets the message.
      // Per-turn events (session.event/.complete) are NOT replayed —
      // those are streamed and lost-events are tolerable for a v1.
      if (parsed.type === "session.ready" || parsed.type === "session.error") {
        await this.ctx.storage.put(this.sessionStateKey(sid), parsed);
      }
      if (parsed.type === "session.disposed") {
        // Dispose terminates the session; remove cached state so a re-use
        // of the same session_id (shouldn't happen in v1, but defensive)
        // doesn't accidentally replay a stale "ready".
        await this.ctx.storage.delete(this.sessionStateKey(sid));
      }
      // Persist acp_session_id when daemon reports it (powers slice-3 resume).
      if (parsed.type === "session.ready") {
        const acpId = (parsed as { acp_session_id?: string }).acp_session_id;
        if (acpId) {
          this.env.DB.prepare(
            "UPDATE runtime_session SET acp_session_id = ?, last_active_at = unixepoch() WHERE id = ?",
          ).bind(acpId, sid).run().catch((e: unknown) => log.error("update acp_session_id failed:", e));
        }
      }
      if (parsed.type === "session.disposed") {
        this.env.DB.prepare(
          "UPDATE runtime_session SET status = 'closed', last_active_at = unixepoch() WHERE id = ?",
        ).bind(sid).run().catch((e: unknown) => log.error("close session row failed:", e));
      }
      this.broadcastToSession(sid, parsed as Record<string, unknown>);
      return;
    }

    log.info(`${this.tag()} unhandled daemon message: ${parsed.type}`);
  }

  private onClientMessage(sessionId: string, parsed: DaemonMessage): void {
    // Wire shape from client (browser):
    //   { type: "prompt", turn_id, text }   → daemon session.prompt
    //   { type: "cancel", turn_id }         → daemon session.cancel
    //   { type: "dispose" }                 → daemon session.dispose
    const daemon = this.ctx.getWebSockets("daemon")[0];
    if (!daemon) {
      // Daemon offline — tell the client back so it can show a banner
      // instead of silently swallowing.
      this.broadcastToSession(sessionId, {
        type: "session.error",
        session_id: sessionId,
        turn_id: (parsed as { turn_id?: string }).turn_id,
        message: "machine offline",
      });
      return;
    }
    let outbound: Record<string, unknown> | null = null;
    if (parsed.type === "prompt") {
      outbound = {
        type: "session.prompt",
        session_id: sessionId,
        turn_id: (parsed as { turn_id?: string }).turn_id,
        text: (parsed as { text?: string }).text,
      };
    } else if (parsed.type === "cancel") {
      outbound = {
        type: "session.cancel",
        session_id: sessionId,
        turn_id: (parsed as { turn_id?: string }).turn_id,
      };
    } else if (parsed.type === "dispose") {
      outbound = { type: "session.dispose", session_id: sessionId };
    } else {
      log.info(`${this.tag()} unhandled client message: ${parsed.type}`);
      return;
    }
    try { daemon.send(JSON.stringify(outbound)); }
    catch (e) { log.warn(`${this.tag()} forward to daemon failed:`, e); }
  }

  /** Send a message to all clients subscribed to one session. */
  private broadcastToSession(sessionId: string, msg: Record<string, unknown>): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(clientTag(sessionId))) {
      try { ws.send(payload); } catch { /* dead client; will close soon */ }
    }
  }

  /** Send to every client across every session (used for daemon online/offline). */
  private broadcastToAllClients(msg: Record<string, unknown>): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const tags = this.ctx.getTags(ws);
      if (tags.includes("daemon")) continue;
      try { ws.send(payload); } catch { /* dead client */ }
    }
  }

  /**
   * Tell the daemon to dispose a session. Called from the route handler
   * (DELETE /api/v1/sessions/:id) before the runtime_session row is
   * deleted, so any active turns get aborted cleanly.
   */
  async sendToDaemon(msg: Record<string, unknown>): Promise<boolean> {
    await this.ensureIdentity();
    const daemon = this.ctx.getWebSockets("daemon")[0];
    if (!daemon) return false;
    try { daemon.send(JSON.stringify(msg)); return true; }
    catch { return false; }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.ensureIdentity();
    const tags = this.ctx.getTags(ws);
    if (tags.includes("daemon")) {
      log.info(`${this.tag()} daemon closed (code=${code} reason=${reason || "—"})`);
      await this.markOffline();
      this.broadcastToAllClients({ type: "daemon_offline" });
      return;
    }
    const sid = tags.map(sessionFromTag).find((s) => !!s);
    if (sid) log.info(`${this.tag()} client detached from session ${sid.slice(0, 8)}`);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    await this.ensureIdentity();
    log.error(`${this.tag()} ws error:`, error);
    try { ws.close(1011, "ws error"); } catch { /* already closed */ }
    const tags = this.ctx.getTags(ws);
    if (tags.includes("daemon")) await this.markOffline();
  }

  private async ensureIdentity(): Promise<void> {
    if (this.runtimeId && this.userId) return;
    const stored = await this.ctx.storage.get(["runtime_id", "user_id"] as never);
    const m = stored as unknown as Map<string, string> | undefined;
    if (m) {
      this.runtimeId = m.get("runtime_id") ?? "";
      this.userId = m.get("user_id") ?? "";
    }
  }

  private async markOnline(): Promise<void> {
    try {
      await this.env.DB.prepare(
        "UPDATE runtime SET status = 'online', last_heartbeat = unixepoch() WHERE id = ?",
      ).bind(this.runtimeId).run();
    } catch (e) {
      log.error(`${this.tag()} markOnline failed:`, e);
    }
  }

  private async markOffline(): Promise<void> {
    if (!this.runtimeId) return;
    try {
      await this.env.DB.prepare(
        "UPDATE runtime SET status = 'offline' WHERE id = ?",
      ).bind(this.runtimeId).run();
    } catch (e) {
      log.error(`${this.tag()} markOffline failed:`, e);
    }
  }

  private tag(): string {
    return `[runtime ${this.runtimeId.slice(0, 8)} usr=${this.userId.slice(-6)}]`;
  }
}
