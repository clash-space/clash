/**
 * RuntimeRoom — Durable Object for one user's runtime (one machine).
 *
 * Addressed by `idFromName(runtime_id)` so the daemon and any subscribers
 * always land on the same instance.
 *
 * For slice 1 the only thing this DO does is:
 *   - Accept exactly one daemon WS per runtime (refuse a second).
 *   - On `hello`, persist the manifest (agents detected, version) to D1
 *     and flip `runtime.status` to 'online'.
 *   - On `ping`, refresh `last_heartbeat`.
 *   - On WS close, flip `runtime.status` back to 'offline'.
 *
 * Slice 2 adds session multiplexing (browser subscribers, session.start /
 * .prompt / .event fan-out). The pattern stays the same — extra WS tags
 * for `client:<conn-id>`, message routing in `webSocketMessage`.
 *
 * Auth model: the WS upgrade is gated at the app.ts route via
 * `authenticateRuntimeToken()` — by the time a request reaches this DO
 * the bearer token has already been verified and `x-runtime-id` /
 * `x-runtime-user` headers are filled in.
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

interface DaemonPing {
  type: "ping";
}

type DaemonMessage = DaemonHello | DaemonPing | { type: string; [k: string]: unknown };

export class RuntimeRoom extends DurableObject<Env> {
  /** Cached on first attach so logs / DB writes don't need a fresh lookup. */
  private runtimeId = "";
  private userId = "";

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }

    const runtimeId = request.headers.get("x-runtime-id") ?? "";
    const userId = request.headers.get("x-runtime-user") ?? "";
    if (!runtimeId || !userId) {
      // Should never happen — the route gates this.
      return new Response("missing runtime headers", { status: 400 });
    }

    // One daemon per runtime. A reconnecting daemon needs the prior WS
    // to be reaped first — CF should fire `webSocketClose` on the old TCP
    // long before a fresh attempt arrives, but if not we 409 the new one
    // and let the daemon retry after the close finally lands.
    const existing = this.ctx.getWebSockets("daemon");
    if (existing.length > 0) {
      // Try to detect a clearly-dead old WS and evict it: send a ping; if
      // send throws, drop it and let the new one through. This keeps a
      // hibernated old socket from blocking reconnects forever.
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

    // Reflect online state immediately. Manifest fields (agents, version)
    // get filled in by the `hello` message that follows.
    await this.markOnline();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let parsed: DaemonMessage;
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      parsed = JSON.parse(text);
    } catch (e) {
      log.warn(`${this.tag()} bad daemon message:`, e);
      return;
    }

    await this.ensureIdentity();

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

    // Unknown message types: log and ignore (forward-compat — daemon may
    // start sending message types this version doesn't handle yet).
    log.info(`${this.tag()} unknown daemon message type: ${parsed.type}`);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.ensureIdentity();
    log.info(`${this.tag()} daemon closed (code=${code} reason=${reason || "—"})`);
    await this.markOffline();
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    await this.ensureIdentity();
    log.error(`${this.tag()} ws error:`, error);
    try { ws.close(1011, "ws error"); } catch { /* already closed */ }
    await this.markOffline();
  }

  /**
   * Across hibernation, the in-memory `runtimeId` / `userId` can be lost.
   * Recover them from DO storage so logs and DB writes still work.
   */
  private async ensureIdentity(): Promise<void> {
    if (this.runtimeId && this.userId) return;
    const stored = await this.ctx.storage.get<{ runtime_id?: string; user_id?: string }>([
      "runtime_id", "user_id",
    ] as never);
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
