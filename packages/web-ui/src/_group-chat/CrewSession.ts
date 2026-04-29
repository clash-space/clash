/**
 * One crew member's WebSocket session + prompt queue.
 *
 * Owns:
 *   - The browser-side WS to /api/v1/local-sessions/<sid>/_stream
 *   - The list of messages rendered in the chat panel
 *   - A prompt queue so messages arriving mid-turn don't interrupt; they
 *     get sent right after the current turn's session.complete arrives
 *
 * Doesn't decide WHEN to spawn (that's GroupChat's job). The GroupChat
 * constructs CrewSession after the POST /sessions returns a session_id.
 */

import { appendAcpEvent } from '../lib/acpEvents';
import type { CrewView, CrewStatus, QueuedPrompt, Subscriber } from './types';

const SESSIONS_BASE = '/api/v1/local-sessions';

export class CrewSession {
  readonly crewId: string;
  sessionId: string;
  status: CrewStatus = 'connecting';
  errorMessage: string | null = null;
  messages: CrewView['messages'] = [];
  availableCommands: CrewView['availableCommands'] = [];
  unread = false;
  lastActiveAt = Date.now();

  /** turnId → assistant-message bubble idx, used to route streamed events. */
  private turnToMsgIdx = new Map<string, number>();
  private pending: QueuedPrompt[] = [];
  private inFlightTurn: string | null = null;
  private ws: WebSocket | null = null;
  private turnSeq = 0;

  /** Set by GroupChat when this crew becomes / loses focus. Affects
   *  unread bookkeeping for incoming events. */
  isFocused = false;

  constructor(crewId: string, private notify: Subscriber) {
    this.crewId = crewId;
    this.sessionId = '';
  }

  /** Open the WS to the session stream. Call once after /sessions
   *  returns a session_id. */
  attach(sessionId: string): void {
    this.sessionId = sessionId;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}${SESSIONS_BASE}/${encodeURIComponent(sessionId)}/_stream`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = () => {
      this.ws = null;
      // session.disposed already handled status; this catches transport drop.
      if (this.status !== 'error') this.status = 'disconnected';
      this.notify();
    };
  }

  /**
   * Enqueue a prompt. If the crew is idle (status === 'connected'),
   * sends immediately. Otherwise queues — the queue drains on the next
   * session.complete.
   *
   * "Append on next turn" semantics: never cancel an in-flight turn.
   */
  enqueuePrompt(text: string): void {
    if (!text.trim()) return;
    this.pending.push({ text, enqueuedAt: Date.now() });
    this.lastActiveAt = Date.now();
    this.maybeDrain();
    this.notify();
  }

  /** If we're idle and have a pending prompt, send it. */
  private maybeDrain(): void {
    if (this.inFlightTurn) return; // still in a turn
    if (this.status !== 'connected' && this.status !== 'streaming') return;
    if (this.pending.length === 0) return;
    const next = this.pending.shift()!;
    this.sendPromptNow(next.text);
  }

  private sendPromptNow(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const turnId = `t-${++this.turnSeq}-${Date.now().toString(36)}`;
    this.inFlightTurn = turnId;
    this.messages = [
      ...this.messages,
      { id: `user-${turnId}`, role: 'user', parts: [{ type: 'text', text }] },
    ];
    this.status = 'sending';
    this.lastActiveAt = Date.now();
    this.ws.send(JSON.stringify({ type: 'prompt', turn_id: turnId, text }));
    this.notify();
  }

  /**
   * Handle a message from the session stream. Dispatches by type:
   *   attached       — DO synthetic, we ignore
   *   session.ready  — first attach + every reconnect; status → connected
   *   session.event  — ACP notification; goes through the shared parser
   *   session.complete — turn finished; drain queue if non-empty
   *   session.error / session.disposed — terminal states
   *   daemon_offline / daemon_online — runtime state
   */
  private handleMessage(raw: unknown): void {
    let msg: { type: string; turn_id?: string; event?: unknown; message?: string };
    try { msg = JSON.parse(typeof raw === 'string' ? raw : ''); } catch { return; }
    const now = Date.now();

    switch (msg.type) {
      case 'attached':
        return;
      case 'session.ready':
        this.status = 'connected';
        this.lastActiveAt = now;
        this.maybeDrain();
        this.notify();
        return;
      case 'session.event': {
        if (!msg.turn_id) return;
        const messages = this.messages.slice();
        const knownIdx = this.turnToMsgIdx.get(msg.turn_id);
        const result = appendAcpEvent(messages, msg.turn_id, knownIdx, msg.event);
        if (knownIdx === undefined && result.idx >= 0) {
          this.turnToMsgIdx.set(msg.turn_id, result.idx);
        }
        if (result.commands) this.availableCommands = result.commands;
        this.messages = messages;
        this.status = 'streaming';
        this.lastActiveAt = now;
        if (!this.isFocused) this.unread = true;
        this.notify();
        return;
      }
      case 'session.complete': {
        if (msg.turn_id) this.turnToMsgIdx.delete(msg.turn_id);
        if (this.inFlightTurn === msg.turn_id) this.inFlightTurn = null;
        // If no other turn is open AND queue is empty → idle.
        if (this.turnToMsgIdx.size === 0 && this.pending.length === 0) {
          this.status = 'connected';
        }
        this.lastActiveAt = now;
        this.notify();
        // Drain after status flips so maybeDrain's gates pass.
        this.maybeDrain();
        return;
      }
      case 'session.error':
        this.status = 'error';
        this.errorMessage = msg.message ?? 'unknown error';
        this.lastActiveAt = now;
        this.notify();
        return;
      case 'session.disposed':
        // Crew finished — GroupChat will remove from the panel.
        this.status = 'disconnected';
        try { this.ws?.close(); } catch { /* ignore */ }
        this.notify();
        return;
      case 'daemon_offline':
        this.status = 'disconnected';
        this.errorMessage = 'runtime offline';
        this.notify();
        return;
    }
  }

  /** Cancel every in-flight turn for this crew. (Steer is a separate
   *  concept and intentionally not implemented — the design says
   *  prompts append on next turn, never interrupt.) */
  cancelInFlight(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const turnId of this.turnToMsgIdx.keys()) {
      this.ws.send(JSON.stringify({ type: 'cancel', turn_id: turnId }));
    }
  }

  /** Clean shutdown — sends dispose, closes WS. */
  dispose(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: 'dispose' })); } catch { /* */ }
      try { this.ws.close(); } catch { /* */ }
    }
    this.ws = null;
  }

  /** Read-only projection for UI. */
  view(): CrewView {
    return {
      crewId: this.crewId,
      sessionId: this.sessionId,
      status: this.status,
      errorMessage: this.errorMessage,
      messages: this.messages,
      availableCommands: this.availableCommands,
      pendingCount: this.pending.length,
      unread: this.unread,
      lastActiveAt: this.lastActiveAt,
    };
  }
}
