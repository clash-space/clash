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

    // One daemon per runtime. When a fresh attach arrives we always
    // assume it supersedes any prior attachment — the old daemon either
    // restarted (intentional) or its host crashed (the WS hibernated in
    // DO memory because CF never got a clean TCP close). The previous
    // "send ping; if ok 409 the new one" probe was unreliable: `send`
    // on a dying-but-not-yet-noticed WS writes to a buffer and returns
    // truthy, so we'd reject legitimate reconnects with 409 until the
    // close event finally landed (could be minutes; in `wrangler dev`
    // sometimes never). "Newer wins" is what users want during a
    // restart cycle anyway, and a stale daemon getting close(1011)
    // simply triggers its own reconnect loop where it'll lose the race
    // for the new attach — self-healing without manual intervention.
    for (const sock of this.ctx.getWebSockets("daemon")) {
      try { sock.close(1011, "superseded"); } catch { /* already closing */ }
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

    // RPC response from the daemon → resolve the matching waiter.
    if (parsed.type === "rpc.list_local_sessions.response") {
      const reqId = (parsed as { request_id?: string }).request_id;
      const sessions = (parsed as { sessions?: unknown[] }).sessions ?? [];
      if (reqId && this.#pendingRpcs.has(reqId)) {
        this.#pendingRpcs.get(reqId)!(sessions);
        this.#pendingRpcs.delete(reqId);
      }
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
      if (parsed.type === "session.ready" || parsed.type === "session.error") {
        await this.ctx.storage.put(this.sessionStateKey(sid), parsed);
      }
      if (parsed.type === "session.disposed") {
        await this.ctx.storage.delete(this.sessionStateKey(sid));
      }
      // Persist acp_session_id when daemon reports it (powers resume).
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
      // Chat history: accumulate session.event chunks per (session, turn);
      // INSERT one chat_message row when session.complete arrives.
      // session.error also gets persisted (so users see what failed).
      if (parsed.type === "session.event") {
        const turnId = (parsed as { turn_id?: string }).turn_id;
        if (turnId) {
          const key = this.turnAccumulatorKey(sid, turnId);
          const existing = await this.ctx.storage.get<unknown[]>(key) ?? [];
          existing.push((parsed as { event?: unknown }).event);
          await this.ctx.storage.put(key, existing);
        }
      }
      if (parsed.type === "session.complete") {
        const turnId = (parsed as { turn_id?: string }).turn_id;
        if (turnId) await this.flushTurnToHistory(sid, turnId, "complete");
      }
      if (parsed.type === "session.error") {
        const turnId = (parsed as { turn_id?: string }).turn_id;
        if (turnId) await this.flushTurnToHistory(sid, turnId, "error", (parsed as { message?: string }).message);
      }
      this.broadcastToSession(sid, parsed as Record<string, unknown>);
      return;
    }

    log.info(`${this.tag()} unhandled daemon message: ${parsed.type}`);
  }

  /** Storage key for the per-turn accumulator buffer. */
  private turnAccumulatorKey(sid: string, turnId: string): string {
    return `turn_acc:${sid}:${turnId}`;
  }

  /**
   * On session.complete (or .error), assemble the accumulated raw ACP
   * events for a turn into one chat_message row and clear the buffer.
   * The browser's parser (lib/acpEvents.ts) reads the events_json on
   * history fetch to render the same content it would have shown live.
   */
  private async flushTurnToHistory(sid: string, turnId: string, kind: "complete" | "error", errMsg?: string): Promise<void> {
    const key = this.turnAccumulatorKey(sid, turnId);
    const events = await this.ctx.storage.get<unknown[]>(key) ?? [];
    if (events.length === 0 && kind !== "error") {
      // Nothing happened in this turn (rare). Skip.
      await this.ctx.storage.delete(key);
      return;
    }
    const eventsToStore = kind === "error"
      ? [...events, { type: "synthetic_error", message: errMsg ?? "unknown error" }]
      : events;

    // Look up the session's user_id + crew_id (sender) from the row
    // we wrote at POST /sessions time.
    const row = await this.env.DB.prepare(
      "SELECT user_id, agent_id FROM runtime_session WHERE id = ?",
    ).bind(sid).first<{ user_id: string; agent_id: string }>();
    if (!row) {
      log.warn(`${this.tag()} flushTurn: no runtime_session row for ${sid}`);
      await this.ctx.storage.delete(key);
      return;
    }

    try {
      await this.env.DB.prepare(
        `INSERT INTO chat_message (id, session_id, user_id, sender_kind, sender_id, turn_id, events_json, created_at)
         VALUES (?, ?, ?, 'crew', ?, ?, ?, unixepoch())`,
      ).bind(
        crypto.randomUUID(),
        sid,
        row.user_id,
        row.agent_id,  // crew_id is stored in runtime_session.agent_id (legacy column name)
        turnId,
        JSON.stringify(eventsToStore),
      ).run();
    } catch (e) {
      log.error(`${this.tag()} chat_message INSERT failed:`, e);
    } finally {
      await this.ctx.storage.delete(key);
    }
  }

  /** Write a user message row before forwarding the prompt to the daemon. */
  private async persistUserMessage(sid: string, turnId: string, text: string): Promise<void> {
    const row = await this.env.DB.prepare(
      "SELECT user_id FROM runtime_session WHERE id = ?",
    ).bind(sid).first<{ user_id: string }>();
    if (!row) return;
    try {
      await this.env.DB.prepare(
        `INSERT INTO chat_message (id, session_id, user_id, sender_kind, sender_id, turn_id, events_json, created_at)
         VALUES (?, ?, ?, 'user', ?, ?, ?, unixepoch())`,
      ).bind(
        crypto.randomUUID(),
        sid,
        row.user_id,
        row.user_id,
        turnId,
        JSON.stringify([{ type: "text", text }]),
      ).run();
    } catch (e) {
      log.error(`${this.tag()} user chat_message INSERT failed:`, e);
    }
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
      const turnId = (parsed as { turn_id?: string }).turn_id;
      const text = (parsed as { text?: string }).text;
      // Persist user message immediately. Forwarding to daemon doesn't
      // wait for the INSERT — it's a fire-and-forget alongside.
      if (turnId && typeof text === "string") {
        void this.persistUserMessage(sessionId, turnId, text);
      }
      outbound = {
        type: "session.prompt",
        session_id: sessionId,
        turn_id: turnId,
        text,
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

  /**
   * Forward a `room.mention` text frame to every browser client attached
   * to one runtime_session. Called by routes/v1/projects.ts after a room
   * message that mentions this crew lands. The browser-side CrewSession
   * decides what to do with it (later: enqueue as a system prompt so the
   * mentioned crew responds on its next turn — append-on-next-turn,
   * never interrupt).
   *
   * Daemon is NOT involved — mentions never leave the api-cf layer until
   * the browser injects them as prompts. This keeps the daemon ignorant
   * of the room.
   */
  async pushRoomMention(sessionId: string, mention: Record<string, unknown>): Promise<void> {
    await this.ensureIdentity();
    this.broadcastToSession(sessionId, { type: "room.mention", ...mention });
  }

  /**
   * RPC the daemon for the list of resumeable local CC sessions on
   * that machine. Returns [] if the daemon is offline or doesn't
   * respond within the timeout.
   *
   * Implemented as fire-and-await: send rpc.list_local_sessions with a
   * fresh request_id, store the resolver in #pendingRpcs, resolve when
   * webSocketMessage sees the matching response. Hibernation-safe
   * because the resolver lives in DO memory and the response comes
   * back on the same DO instance (idFromName(runtime_id) is sticky).
   */
  async listLocalSessions(timeoutMs = 5000): Promise<unknown[]> {
    await this.ensureIdentity();
    const daemon = this.ctx.getWebSockets("daemon")[0];
    if (!daemon) return [];
    const requestId = crypto.randomUUID();
    const promise = new Promise<unknown[]>((resolve) => {
      const t = setTimeout(() => {
        this.#pendingRpcs.delete(requestId);
        resolve([]);
      }, timeoutMs);
      this.#pendingRpcs.set(requestId, (sessions) => {
        clearTimeout(t);
        resolve(sessions);
      });
    });
    try {
      daemon.send(JSON.stringify({ type: "rpc.list_local_sessions", request_id: requestId }));
    } catch {
      this.#pendingRpcs.delete(requestId);
      return [];
    }
    return promise;
  }

  /**
   * In-flight RPC resolvers keyed by request_id. Daemon's response
   * messages (rpc.<name>.response) look up by request_id and resolve
   * the corresponding waiter.
   */
  #pendingRpcs = new Map<string, (result: unknown[]) => void>();

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
