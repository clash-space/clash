/**
 * SessionManager — owns the ACP child processes the daemon is currently
 * running on this machine. Slice-2 minimum: one ACP runtime per session
 * (i.e. one child process per session). Multi-session-per-process
 * optimization defers to slice 3 because (a) it requires AcpSession to
 * hold N session ids and route events by sessionId, and (b) most users
 * have one chat at a time.
 *
 * Wire protocol (over the daemon ↔ control-plane WS, see daemon.ts):
 *
 *   Server → Daemon
 *     session.start    { session_id, agent_id, cwd, resume?: { acp_session_id } }
 *     session.prompt   { session_id, turn_id, text }
 *     session.cancel   { session_id, turn_id }
 *     session.dispose  { session_id }
 *
 *   Daemon → Server
 *     session.ready    { session_id, acp_session_id }
 *     session.event    { session_id, turn_id, event }
 *     session.complete { session_id, turn_id }
 *     session.error    { session_id, turn_id?, message }
 *     session.disposed { session_id }
 */

import { AcpRuntimeImpl } from "../_acp-runtime/index.js";
import { NodeSpawner } from "../_acp-runtime/spawners/node.js";
import { KNOWN_ACP_AGENTS } from "../_acp-runtime/registry.js";
import type { AcpSession } from "../_acp-runtime/types.js";
import { ensureSessionCwd } from "./session-cwd.js";

export interface SessionStartParams {
  session_id: string;
  agent_id: string;
  cwd?: string;
  resume?: { acp_session_id: string };
}

export interface SessionPromptParams {
  session_id: string;
  turn_id: string;
  text: string;
}

/** Whatever the manager wants the daemon to send back over the WS. */
export type ManagerOut =
  | { type: "session.ready"; session_id: string; acp_session_id: string }
  | { type: "session.event"; session_id: string; turn_id: string; event: unknown }
  | { type: "session.complete"; session_id: string; turn_id: string }
  | { type: "session.error"; session_id: string; turn_id?: string; message: string }
  | { type: "session.disposed"; session_id: string };

export type Sender = (msg: ManagerOut) => void;

interface ActiveSession {
  acp: AcpSession;
  /** turnId → abort controller for cancel. */
  turns: Map<string, AbortController>;
}

export class SessionManager {
  #send: Sender;
  #spawner = new NodeSpawner();
  #runtime = new AcpRuntimeImpl(this.#spawner);
  #sessions = new Map<string, ActiveSession>();

  constructor(send: Sender) {
    this.#send = send;
  }

  /** Swap the outbound sender (e.g. when WS reconnects with a fresh socket). */
  setSender(send: Sender): void {
    this.#send = send;
  }

  /** True iff a session with this id is currently alive on this daemon. */
  has(session_id: string): boolean {
    return this.#sessions.has(session_id);
  }

  /** Re-announce alive sessions to the server (used after WS reconnect). */
  announceAll(): void {
    for (const [session_id] of this.#sessions) {
      // We don't store acp_session_id locally — the server already has it
      // in runtime_session.acp_session_id from the original ready event.
      // Send a generic ack so the server can update its session_state cache.
      this.#send({ type: "session.ready", session_id, acp_session_id: "" });
    }
  }

  async start(p: SessionStartParams): Promise<void> {
    if (this.#sessions.has(p.session_id)) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        message: "session already started",
      });
      return;
    }
    const agent = KNOWN_ACP_AGENTS.find((a) => a.id === p.agent_id);
    if (!agent) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        message: `unknown agent: ${p.agent_id}`,
      });
      return;
    }
    const resumeId = p.resume?.acp_session_id;
    // Spawn into ~/.clash/sessions/<sid>/ — never the user's pwd. The
    // server's `cwd` field is currently advisory (we ignore it for v1)
    // but kept in the protocol so future per-project workspaces can use it.
    const sessionCwd = await ensureSessionCwd(p.session_id);
    process.stderr.write(
      `  → SessionManager.start ${agent.spec.command}${resumeId ? ` (resume ${resumeId.slice(0, 8)}…)` : ""} cwd=${sessionCwd}\n`,
    );
    try {
      const session = await this.#runtime.start({
        agent: { ...agent.spec, cwd: sessionCwd },
        resumeAcpSessionId: resumeId,
      });
      process.stderr.write(`  ✓ agent ready, session id=${(session as unknown as { id?: string }).id}\n`);
      this.#sessions.set(p.session_id, { acp: session, turns: new Map() });
      // session.acpSessionId is the id the agent issued via session/new
      // (or echoed back via session/load). Server persists it to
      // runtime_session.acp_session_id so a future resume can re-attach.
      this.#send({
        type: "session.ready",
        session_id: p.session_id,
        acp_session_id: session.acpSessionId,
      });
    } catch (e) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async prompt(p: SessionPromptParams): Promise<void> {
    const sess = this.#sessions.get(p.session_id);
    if (!sess) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        turn_id: p.turn_id,
        message: "no such session",
      });
      return;
    }
    const ctrl = new AbortController();
    sess.turns.set(p.turn_id, ctrl);
    try {
      for await (const ev of sess.acp.prompt(p.text, { abortSignal: ctrl.signal })) {
        if (ctrl.signal.aborted) break;
        this.#send({
          type: "session.event",
          session_id: p.session_id,
          turn_id: p.turn_id,
          event: ev,
        });
      }
      this.#send({ type: "session.complete", session_id: p.session_id, turn_id: p.turn_id });
    } catch (e) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        turn_id: p.turn_id,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      sess.turns.delete(p.turn_id);
    }
  }

  cancel(session_id: string, turn_id: string): void {
    const sess = this.#sessions.get(session_id);
    if (!sess) return;
    sess.turns.get(turn_id)?.abort();
  }

  async dispose(session_id: string): Promise<void> {
    const sess = this.#sessions.get(session_id);
    if (!sess) return;
    for (const ctrl of sess.turns.values()) ctrl.abort();
    await sess.acp.dispose().catch(() => undefined);
    this.#sessions.delete(session_id);
    this.#send({ type: "session.disposed", session_id });
  }

  /** Best-effort cleanup on daemon shutdown. */
  async disposeAll(): Promise<void> {
    const ids = [...this.#sessions.keys()];
    await Promise.all(ids.map((id) => this.dispose(id)));
  }
}
