/**
 * ByoBridgeRoom — Durable Object that pairs one browser WS and one bridge WS
 * by a shared token, then relays raw frames between them.
 *
 * Address: `idFromName(token)` so both sides land on the same instance.
 * No persistence, no alarms — when both sockets close, the DO goes idle and
 * eventually gets evicted. Tokens are one-shot (DO refuses second bridge or
 * second browser attach).
 *
 * Auth model:
 *   - Browser side is authenticated at the Hono router (Better Auth). The
 *     route forwards `x-user-id` as a header so we can audit which user the
 *     pairing belongs to. We DON'T trust the user across the relay: messages
 *     are byte-passed between the two sockets, not parsed here.
 *   - Bridge side has no auth other than the token itself. Tokens are
 *     32-char random (see routes/byo-bridge.ts) and one-shot, so the security
 *     model is "token == bearer credential, leak it = lose it".
 *
 * Synthetic messages we inject for the browser's benefit:
 *   { type: "bridge_connected" }    after bridge attaches
 *   { type: "bridge_disconnected" } when bridge drops
 * Pass-through bridge messages use {type: "ready" | "event" | "complete" | "error"}
 * so the field namespaces don't collide.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../config";
import { log } from "../logger";

type Side = "browser" | "bridge";

export class ByoBridgeRoom extends DurableObject<Env> {
  /** Set on first browser attach. Used only for log tags. */
  private userId = "anon";

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }

    const url = new URL(request.url);
    const side: Side | null = url.pathname.endsWith("/browser")
      ? "browser"
      : url.pathname.endsWith("/cli")
        ? "bridge"
        : null;
    if (!side) return new Response("unknown side", { status: 404 });

    // Each side has at most one live WS. A reconnecting side (network blip,
    // browser tab refocus) may arrive before CF detects the prior socket
    // closed. Probe the existing one with a ping; if send throws it's
    // dead, evict and let the new attach through.
    const existing = this.ctx.getWebSockets(side);
    if (existing.length > 0) {
      try {
        existing[0].send(JSON.stringify({ type: "ping" }));
        return new Response(`${side} already attached for this token`, { status: 409 });
      } catch {
        try { existing[0].close(1011, "stale"); } catch { /* already closing */ }
      }
    }

    if (side === "browser") {
      const u = request.headers.get("x-user-id");
      if (!u) return new Response("unauthorized", { status: 401 });
      this.userId = u;
    } else {
      // Bridge attaching but no browser is here yet — refuse so bridge can
      // surface "pairing expired or never started" instead of holding idle.
      const browsers = this.ctx.getWebSockets("browser");
      if (browsers.length === 0) {
        return new Response("no browser waiting on this token", { status: 410 });
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Tag-based hibernation API: server-side WS gets a tag so webSocketMessage /
    // webSocketClose can route without keeping in-memory references that would
    // be lost across hibernation.
    this.ctx.acceptWebSocket(server, [side]);
    log.info(`${this.tag()} ${side} attached`);

    if (side === "bridge") {
      // Tell the browser its bridge is online.
      const browser = this.ctx.getWebSockets("browser")[0];
      try {
        browser?.send(JSON.stringify({ type: "bridge_connected" }));
      } catch {
        /* browser may have already closed */
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const tags = this.ctx.getTags(ws);
    const fromBrowser = tags.includes("browser");
    const targetTag: Side = fromBrowser ? "bridge" : "browser";
    const target = this.ctx.getWebSockets(targetTag)[0];
    if (!target) {
      // Other side dropped while we were processing. Best-effort notify
      // sender so it doesn't keep talking into the void.
      try {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `peer (${targetTag}) not connected`,
          }),
        );
      } catch {
        /* sender may have closed too */
      }
      return;
    }
    try {
      target.send(message);
    } catch (e) {
      log.warn(`${this.tag()} relay → ${targetTag} send failed:`, e);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const tags = this.ctx.getTags(ws);
    const side: Side = tags.includes("browser") ? "browser" : "bridge";
    log.info(`${this.tag()} ${side} closed (code=${code} reason=${reason || "—"})`);

    if (side === "bridge") {
      // Browser stays — tell it the bridge dropped so the dialog can
      // show "reconnecting…". Bridge auto-reconnects with the same
      // pair token; DO accepts the new attach and forwards
      // bridge_connected to the browser again.
      const browser = this.ctx.getWebSockets("browser")[0];
      try {
        browser?.send(JSON.stringify({ type: "bridge_disconnected" }));
      } catch { /* browser may have closed too */ }
    } else {
      // Browser dropped. Both the browser tab and the bridge will try
      // to reconnect with the same pair token; do NOT close the bridge.
      // Holding the ACP child alive is the whole point of the
      // reconnect path — browser just needs to reattach.
      // (User explicit shutdown comes through as `{type: "shutdown"}`
      // forwarded to bridge, which exits cleanly. Tab close without
      // shutdown leaves the bridge running until user ctrl-C — the
      // ad-hoc model expects user to manage the terminal lifecycle.)
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    log.error(`${this.tag()} ws error:`, error);
    try {
      ws.close(1011, "ws error");
    } catch {
      /* already closed */
    }
  }

  private tag(): string {
    return `[byo usr=${this.userId.slice(-6)}]`;
  }
}
