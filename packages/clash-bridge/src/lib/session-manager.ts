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
import { ensureCrewCwd, readCrewRuntime } from "./session-cwd.js";

export interface SessionStartParams {
  session_id: string;
  /**
   * Crew member id (e.g. "director", "canvas-editor") — daemon resolves
   * to the bundled CLAUDE.md / skills + the agent runtime configured in
   * that crew member's runtime.json. Replaces the older `agent_id`
   * field which mixed runtime selection with role definition.
   */
  crew_id: string;
  /**
   * Optional ACP CLI override (e.g. "claude-code-acp", "codex",
   * "gemini"). When set, daemon spawns this CLI instead of the one
   * the crew template's bundled runtime.json points at. Server fills
   * this in from crew_member.agent_id when the user has claimed a
   * crew with a specific CLI choice.
   */
  agent_id?: string;
  /**
   * Server-side crew_member.id. Daemon injects it into the spawned
   * agent's env as CLASH_CREW_MEMBER_ID — used by `clash room say`
   * to identify itself when broadcasting to the project room.
   */
  crew_member_id?: string;
  /**
   * Optional clash project id. Different projects get isolated
   * workspaces (~/.clash/crew/<crew>/<project>/), so the same crew
   * member's memory and tool state don't bleed across projects.
   * Also injected into the agent's env as CLASH_PROJECT_ID so room
   * tools know which room to target.
   */
  project_id?: string;
  /** Server-supplied advisory cwd. Currently ignored — we always spawn
   *  into the crew/project workspace. Kept in the type so older bridges
   *  / future tooling don't trip. */
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

export interface SessionManagerEnv {
  /** Bridge passes its identity / configuration here so spawned agents
   *  can call back to clash. Currently just the API key + server URL. */
  CLASH_API_KEY?: string;
  CLASH_API_URL?: string;
}

export class SessionManager {
  #send: Sender;
  #spawner = new NodeSpawner();
  #runtime = new AcpRuntimeImpl(this.#spawner);
  #sessions = new Map<string, ActiveSession>();
  /** session_id → Promise that resolves once start() has populated #sessions
   *  (or rejected if start failed). The server may push session.prompt
   *  before the corresponding session.start has finished the slow ACP
   *  newSession dance (claude-code-acp with skills + history reloads can
   *  take 10–15s on a fresh cwd); without this queue, prompt() looks up
   *  the session, finds nothing, and silently aborts the turn. */
  #starting = new Map<string, Promise<void>>();
  #env: SessionManagerEnv = {};

  constructor(send: Sender) {
    this.#send = send;
  }

  /** Update the env injected into every subsequent spawn. */
  setSpawnEnv(env: SessionManagerEnv): void {
    this.#env = env;
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
    // Track in-flight start so prompt() can await it (prompts often arrive
    // before newSession finishes).
    let resolveStart!: () => void;
    let rejectStart!: (e: unknown) => void;
    const startPromise = new Promise<void>((res, rej) => { resolveStart = res; rejectStart = rej; });
    this.#starting.set(p.session_id, startPromise);
    try {
      await this.#startInner(p);
      resolveStart();
    } catch (e) {
      rejectStart(e);
      throw e;
    } finally {
      this.#starting.delete(p.session_id);
    }
  }

  async #startInner(p: SessionStartParams): Promise<void> {
    // Resolve crew template → role definition (CLAUDE.md / skills).
    // Existence check only; the agent CLI choice now comes from the
    // server's session.start payload (crew_member.agent_id) so users
    // can pick claude-code-acp / codex / gemini per claim. Falls back
    // to the template's bundled runtime.json default when the server
    // didn't supply an override (legacy crew_id-only path).
    const tpl = await readCrewRuntime(p.crew_id);
    if (!tpl) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        message: `unknown crew template: ${p.crew_id}`,
      });
      return;
    }
    const resolvedAgentId = p.agent_id ?? tpl.agent_id;
    const agent = KNOWN_ACP_AGENTS.find((a) => a.id === resolvedAgentId);
    if (!agent) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        message: `agent '${resolvedAgentId}' (for crew '${p.crew_id}') not in the registry`,
      });
      return;
    }
    const resumeId = p.resume?.acp_session_id;
    // Workspace cwd: ~/.clash/crew/<crew>/<project>/. Per-project
    // isolation prevents memory bleed between different clash projects.
    const sessionCwd = await ensureCrewCwd(p.crew_id, p.project_id);
    process.stderr.write(
      `  → SessionManager.start ${agent.spec.command}${resumeId ? ` (resume ${resumeId.slice(0, 8)}…)` : ""} cwd=${sessionCwd}\n`,
    );
    try {
      // Inject CLASH_API_KEY / CLASH_API_URL into the spawned agent's env.
      // Without these the bundled clash plugin's SessionStart hook
      // (`clash auth status`) prompts the user to log in, even though
      // the daemon itself is already authenticated.
      const spawnEnv: Record<string, string> = { ...(agent.spec.env ?? {}) };
      if (this.#env.CLASH_API_KEY) spawnEnv.CLASH_API_KEY = this.#env.CLASH_API_KEY;
      if (this.#env.CLASH_API_URL) spawnEnv.CLASH_API_URL = this.#env.CLASH_API_URL;
      // Identity for room tools (`clash room say` / `clash room read`)
      // — without these the agent has no way to know which crew_member
      // it is, or which project's room to target.
      if (p.crew_member_id) spawnEnv.CLASH_CREW_MEMBER_ID = p.crew_member_id;
      if (p.project_id) spawnEnv.CLASH_PROJECT_ID = p.project_id;
      const session = await this.#runtime.start({
        agent: { ...agent.spec, cwd: sessionCwd, env: spawnEnv },
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
    // If the session is currently being started, wait for it. Server
    // often pushes session.prompt right after session.start (an idle
    // crew that just got @-mentioned has both frames queued), and
    // claude-code-acp's newSession can take 10–15s on a populated
    // cwd. Without this wait, the prompt arrives before #sessions has
    // the entry and we'd silently 404 — turn disappears.
    const pending = this.#starting.get(p.session_id);
    if (pending) {
      try { await pending; } catch { /* start failed; falls through to no-such-session below */ }
    }
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
        // Filter out AcpSession's iterator-end sentinels — they're an
        // internal "the SDK promise resolved" marker, not real ACP
        // notifications. The outer session.complete / session.error
        // already conveys turn termination to the client. Forwarding
        // these would (a) show as raw_event clutter in the UI and
        // (b) confuse the parser that's looking for sessionUpdate-shaped
        // events.
        const t = (ev as { type?: string } | null | undefined)?.type;
        if (t === "promptComplete" || t === "promptError") continue;
        // DEV-ONLY raw event tap. Writes every ACP notification to a
        // JSONL file so we can ground-truth the wire shape without
        // round-tripping through the UI. Drop the import + this block
        // before publishing the bridge; kept here while we polish the
        // parser. Guarded by CLASH_ACP_TAP env var to avoid disk
        // churn for users not debugging.
        if (process.env.CLASH_ACP_TAP) {
          try {
            const { appendFileSync } = await import("node:fs");
            appendFileSync(
              process.env.CLASH_ACP_TAP,
              JSON.stringify({ ts: Date.now(), session_id: p.session_id, turn_id: p.turn_id, event: ev }) + "\n",
              "utf-8",
            );
          } catch { /* tap is best-effort */ }
        }
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
