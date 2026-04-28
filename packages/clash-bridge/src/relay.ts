/**
 * Relay between the reverse-WebSocket to clash and the local ACP session.
 *
 * Wire protocol (kept dead simple for v1 — extend later):
 *
 *   Worker → Bridge:
 *     { type: "prompt", id, text }     User typed something. Run a turn.
 *     { type: "cancel", id }           User clicked stop on turn `id`.
 *     { type: "shutdown" }             Tear down the agent and exit.
 *
 *   Bridge → Worker:
 *     { type: "ready" }                Spawn + handshake done, accepting prompts.
 *     { type: "event", id, event }     One ACP notification for turn `id`.
 *     { type: "complete", id }         Turn `id`'s prompt resolved cleanly.
 *     { type: "error", id?, message }  Turn-scoped or fatal error.
 *
 * Anything richer (tool result injection, permissions, multi-turn state)
 * is deferred to v2 — minimum-viable BYO chat first.
 */

import type { AcpSession } from "./_acp-runtime/index.js";
import type { WebSocket } from "ws";

interface InMessage {
  type: "prompt" | "cancel" | "shutdown";
  id?: string;
  text?: string;
}

export class Relay {
  #ws: WebSocket;
  #session: AcpSession;
  #activeTurns = new Map<string, AbortController>();
  #shuttingDown = false;

  constructor(ws: WebSocket, session: AcpSession) {
    this.#ws = ws;
    this.#session = session;
    ws.on("message", (data) => this.#onMessage(data));
    ws.on("close", () => this.#onClose());
  }

  /** Tell Worker we're ready to accept prompts. */
  notifyReady(): void {
    this.#send({ type: "ready" });
  }

  #onMessage(data: unknown): void {
    let msg: InMessage;
    try {
      msg = JSON.parse(typeof data === "string" ? data : data!.toString());
    } catch (e) {
      this.#send({ type: "error", message: `bad message: ${e}` });
      return;
    }

    if (msg.type === "prompt") {
      if (!msg.id || typeof msg.text !== "string") {
        this.#send({ type: "error", message: "prompt requires id + text" });
        return;
      }
      void this.#runPrompt(msg.id, msg.text);
    } else if (msg.type === "cancel") {
      if (msg.id) this.#activeTurns.get(msg.id)?.abort();
    } else if (msg.type === "shutdown") {
      this.#shuttingDown = true;
      void this.#session.dispose().finally(() => this.#ws.close(1000, "shutdown"));
    }
  }

  async #runPrompt(id: string, text: string): Promise<void> {
    const ctrl = new AbortController();
    this.#activeTurns.set(id, ctrl);
    try {
      for await (const event of this.#session.prompt(text, { abortSignal: ctrl.signal })) {
        if (ctrl.signal.aborted) break;
        // AcpSession yields an internal `{type: "promptComplete"}` /
        // `{type: "promptError"}` sentinel as its last event. That's not
        // an ACP notification — it's a marker that the SDK promise
        // resolved. Outer `complete` / `error` messages already cover
        // it; forwarding this confuses the browser-side parser and
        // shows up as raw event clutter.
        const t = (event as { type?: string } | null | undefined)?.type;
        if (t === "promptComplete" || t === "promptError") continue;
        this.#send({ type: "event", id, event });
      }
      this.#send({ type: "complete", id });
    } catch (e) {
      this.#send({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.#activeTurns.delete(id);
    }
  }

  #onClose(): void {
    if (this.#shuttingDown) return;
    // Worker dropped us. Cancel any in-flight turns and dispose the agent
    // so we don't leak the child process.
    for (const ctrl of this.#activeTurns.values()) ctrl.abort();
    void this.#session.dispose();
  }

  #send(msg: Record<string, unknown>): void {
    if (this.#ws.readyState === 1 /* OPEN */) {
      this.#ws.send(JSON.stringify(msg));
    }
  }
}
