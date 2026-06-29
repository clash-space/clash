/**
 * AcpSession — owns one ACP child + its ClientSideConnection.
 *
 * Translates between the ACP SDK's request/response + notification model
 * and the higher-level AsyncIterable-of-events shape that callers want.
 *
 * SDK shape (from @agentclientprotocol/sdk):
 *   - `agent.prompt(req)` is request/response; resolves when the turn ends.
 *   - Streaming events (sessionUpdate, etc.) arrive on the *Client* callbacks
 *     we pass into ClientSideConnection.
 *
 * Our shape: `prompt(text)` returns AsyncIterable<unknown>. We collect
 * sessionUpdate notifications on a queue while `agent.prompt()` runs, then
 * end the iterator when prompt resolves. This is a thin transformation, not
 * a re-implementation — the SDK still owns JSON-RPC framing, request IDs,
 * cancellation propagation, etc.
 */

import {
  ClientSideConnection,
  type ContentBlock,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type AuthMethod,
  type Client,
  type ClientCapabilities,
  type LoadSessionResponse,
  type NewSessionResponse,
  type PromptCapabilities,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionModeState,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AcpPromptInput, AcpSession, AcpSessionEvent, ChildHandle, SessionOptions } from "./types.js";

interface ConstructDeps {
  /** Whatever the spawner produced — owned by this session, killed on dispose. */
  child: ChildHandle;
  /** Echoed from start() so callers can see how this session was configured. */
  options: SessionOptions;
  /** Stable id; AcpRuntime supplies one per start(). */
  id: string;
}

const NON_TRANSCRIPT_SESSION_UPDATES = new Set([
  "available_commands_update",
  "config_option_update",
  "current_mode_update",
  "session_info_update",
  "usage_update",
]);

const LOAD_REPLAY_QUIET_MS = 30;
const LOAD_REPLAY_MAX_SETTLE_MS = 300;
const ACP_AUTH_REQUIRED_CODE = -32000;
const ACP_CLIENT_CAPABILITIES: ClientCapabilities = {
  fs: {
    readTextFile: true,
    writeTextFile: true,
  },
  terminal: true,
  auth: {
    terminal: true,
  },
  _meta: {
    "terminal-auth": true,
    terminal_output: true,
  },
};

function sessionUpdateKind(update: unknown): string | null {
  if (!update || typeof update !== "object") return null;
  const typed = update as { sessionUpdate?: unknown; type?: unknown };
  if (typeof typed.sessionUpdate === "string") return typed.sessionUpdate;
  if (typeof typed.type === "string") return typed.type;
  return null;
}

function shouldSuppressLoadedReplayUpdate(update: unknown): boolean {
  const kind = sessionUpdateKind(update);
  return !kind || !NON_TRANSCRIPT_SESSION_UPDATES.has(kind);
}

function isAuthRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const typed = error as { code?: unknown; message?: unknown };
  return (
    typed.code === ACP_AUTH_REQUIRED_CODE &&
    typeof typed.message === "string" &&
    /^Authentication required\b/i.test(typed.message)
  );
}

function firstUsableAuthMethod(authMethods: unknown): AuthMethod | null {
  if (!Array.isArray(authMethods)) return null;
  for (const method of authMethods) {
    if (!method || typeof method !== "object") continue;
    const typed = method as { id?: unknown; type?: unknown };
    if (typeof typed.id !== "string" || typed.id.length === 0) continue;
    return method as AuthMethod;
  }
  return null;
}

function authMethodMeta(method: AuthMethod): Record<string, unknown> | null {
  const meta = (method as { _meta?: unknown; meta?: unknown })._meta ?? (method as { meta?: unknown }).meta;
  return meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : null;
}

function authMethodType(method: AuthMethod): string {
  const type = (method as { type?: unknown }).type;
  if (typeof type === "string") return type;
  const metaType = authMethodMeta(method)?.type;
  return typeof metaType === "string" ? metaType : "agent";
}

function isAgentHandledAuthMethod(method: AuthMethod | null): method is AuthMethod {
  if (!method) return false;
  return authMethodType(method) === "agent";
}


export class AcpSessionImpl implements AcpSession {
  readonly id: string;
  readonly options: SessionOptions;

  /** Public read-only view of the agent-issued sessionId. Empty until init() resolves. */
  get acpSessionId(): string {
    return this.#sessionId ?? "";
  }

  get configOptions(): SessionConfigOption[] {
    return this.#configOptions;
  }

  get modes(): SessionModeState | undefined {
    return this.#modes ? structuredClone(this.#modes) : undefined;
  }

  get promptCapabilities(): PromptCapabilities | undefined {
    return this.#promptCapabilities ? { ...this.#promptCapabilities } : undefined;
  }

  get loadedReplayEvents(): AcpSessionEvent[] {
    return this.#loadedReplayEvents.map((event) => structuredClone(event));
  }

  #child: ChildHandle;
  #agent!: Agent;                  // initialized in init()
  #sessionId!: string;              // ACP-side session id (different from this.id)
  #configOptions: SessionConfigOption[] = [];
  #modes: SessionModeState | undefined;
  #promptCapabilities: PromptCapabilities | undefined;
  #loadedReplayEvents: AcpSessionEvent[] = [];
  #disposed = false;
  #suppressLoadedReplay = false;
  #lastSuppressedLoadReplayAt = 0;
  /**
   * Notifications from the agent that arrived while a prompt was in flight.
   * The Client handler we pass into ClientSideConnection pushes here; the
   * AsyncIterable returned by prompt() pulls.
   */
  #pendingEvents: AcpSessionEvent[] = [];
  #waiters: Array<() => void> = [];

  constructor(deps: ConstructDeps) {
    this.id = deps.id;
    this.options = deps.options;
    this.#child = deps.child;
  }

  /**
   * Initialize the SDK connection, run protocol handshake, and create an
   * ACP session. Must be awaited before prompt() is callable. Caller
   * (AcpRuntime.start) does this and only returns the session once init
   * completes successfully.
   */
  async init(): Promise<void> {
    const stream = ndJsonStream(this.#child.stdin, this.#child.stdout);

    // The Client we hand to the SDK is what receives notifications from the
    // agent (sessionUpdate, requestPermission, terminalCreate, etc.). We
    // implement only what the runtime needs to surface; everything else
    // is best-effort no-op so the SDK doesn't reject the message.
    const conn = new ClientSideConnection(
      (_agent: Agent): Client => ({
        sessionUpdate: async (params: SessionNotification) => {
          if (this.#suppressLoadedReplay && shouldSuppressLoadedReplayUpdate(params.update)) {
            this.#lastSuppressedLoadReplayAt = Date.now();
            this.#loadedReplayEvents.push(params.update);
            return;
          }
          this.#pushEvent(params.update);
        },
        // Permissions / terminals / file ops: surface as events too.
        // Higher layers (clash bridge, openma session) decide handling.
        requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
          this.#pushEvent({ type: "requestPermission", params });
          // Local daemon = trusted environment (the user runs it on
          // their own machine). Auto-approve by picking the first
          // affirmative option the agent offers — typically "allow"
          // or "allow once". Without this, every Bash / clash room say
          // / fs.write etc. tool use gets cancelled and the agent
          // silently stops — never broadcasts, never finishes a turn.
          //
          // Hosts that need stricter control (remote-managed bridge,
          // multi-tenant) can subclass and override this method.
          const opts = params.options;
          const pick =
            // Prefer explicit "allow always" → "allow once" → first
            // option whose name doesn't look like a deny / cancel.
            opts.find((o) => o.kind === "allow_always") ??
            opts.find((o) => o.kind === "allow_once") ??
            opts.find((o) => /allow|approve|yes|continue/i.test(o.name ?? "")) ??
            opts.find((o) => !/deny|cancel|reject|no/i.test(o.name ?? ""));
          // ACP wire shape: RequestPermissionOutcome is a tagged union on
          // a `outcome` field (NOT `type`), see schema/types.gen.d.ts in
          // @agentclientprotocol/sdk. claude-agent-acp explicitly checks
          // `response.outcome?.outcome === "cancelled" | "selected"`, so
          // sending `type:` here is a silent no-op (agent never sees a
          // valid decision, treats as aborted, gives up — turn just stops).
          if (pick?.optionId) {
            return { outcome: { outcome: "selected", optionId: pick.optionId } };
          }
          return { outcome: { outcome: "cancelled" } };
        },
      }),
      stream,
    );
    this.#agent = conn;

    const initResult = await this.#agent.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: ACP_CLIENT_CAPABILITIES,
    });
    this.#promptCapabilities = initResult.agentCapabilities?.promptCapabilities;
    const authMethod = firstUsableAuthMethod(initResult.authMethods);
    let attemptedAuth = false;
    const authenticateOnce = async (): Promise<boolean> => {
      if (attemptedAuth || !isAgentHandledAuthMethod(authMethod)) return false;
      attemptedAuth = true;
      await this.#agent.authenticate({ methodId: authMethod.id });
      return true;
    };
    const withAuthRetry = async <T>(request: () => T | Promise<T>): Promise<T> => {
      try {
        return await Promise.resolve(request());
      } catch (e) {
        if (!isAuthRequiredError(e) || !(await authenticateOnce())) throw e;
        return Promise.resolve(request());
      }
    };

    // Try to reconnect an existing ACP session if asked. Per ACP,
    // `session/resume` is the no-replay reconnect primitive. Some current
    // agents only expose `session/load`; when using it, Clash suppresses the
    // transcript replay because the product transcript is persisted locally.
    const wantsResume = this.options.resumeAcpSessionId;
    const agentCapabilities = (initResult as {
      agentCapabilities?: {
        loadSession?: boolean;
        sessionCapabilities?: { resume?: unknown };
      };
    }).agentCapabilities;
    const cwd = this.options.agent.cwd ?? process.cwd();
    const supportsResume =
      Boolean(agentCapabilities?.sessionCapabilities?.resume) &&
      typeof this.#agent.resumeSession === "function";
    const supportsLoad =
      agentCapabilities?.loadSession === true &&
      typeof this.#agent.loadSession === "function";

    if (wantsResume && supportsResume) {
      try {
        const resumedSession = await withAuthRetry(() => this.#agent.resumeSession!({
          sessionId: wantsResume,
          cwd,
          mcpServers: [],
        }));
        this.#sessionId = wantsResume;
        this.#setSessionStateFromResponse(resumedSession);
        return;
      } catch (e) {
        // Resume failed (e.g. agent dropped session state) — try load as a
        // compatibility fallback before giving up to a fresh session.
        // eslint-disable-next-line no-console
        console.error(`[acp] session/resume(${wantsResume}) failed, falling back to load/new:`, e);
      }
    }

    if (wantsResume && supportsLoad) {
      try {
        this.#suppressLoadedReplay = true;
        this.#lastSuppressedLoadReplayAt = 0;
        const loadedSession = await withAuthRetry(() => this.#agent.loadSession!({
          sessionId: wantsResume,
          cwd,
          mcpServers: [],
        }));
        this.#sessionId = wantsResume;
        if (loadedSession) {
          this.#setSessionStateFromResponse(loadedSession);
        }
        await this.#settleLoadedReplay();
        this.#pendingEvents = this.#pendingEvents.filter((event) => !shouldSuppressLoadedReplayUpdate(event));
        return;
      } catch (e) {
        // Load failed (e.g. on-disk transcript was deleted) — fall through
        // to creating a fresh ACP session.
        // eslint-disable-next-line no-console
        console.error(`[acp] session/load(${wantsResume}) failed, falling back to new:`, e);
      } finally {
        this.#suppressLoadedReplay = false;
      }
    }

    const newSession = await withAuthRetry(() => this.#agent.newSession({
      cwd,
      mcpServers: [],
    }));
    this.#sessionId = newSession.sessionId;
    this.#setSessionStateFromResponse(newSession);
  }

  prompt(input: AcpPromptInput, opts?: { abortSignal?: AbortSignal }): AsyncIterable<AcpSessionEvent> {
    if (this.#disposed) {
      throw new Error(`AcpSession ${this.id} is disposed`);
    }
    return this.#promptIter(input, opts);
  }

  async *#promptIter(input: AcpPromptInput, opts?: { abortSignal?: AbortSignal }): AsyncIterable<AcpSessionEvent> {
    // Wire the abort signal through to ACP's cancel(). The SDK doesn't
    // do this for us — `prompt()` will hang until the agent finishes
    // unless we explicitly cancel.
    const onAbort = () => {
      Promise.resolve(this.#agent.cancel({ sessionId: this.#sessionId })).catch(() => { /* best effort */ });
    };

    // Per-turn timeout. Compose with caller's signal so either cancels both.
    const turnAbort = new AbortController();
    let abortReason = "ACP prompt cancelled";
    const turnTimer = this.options.perTurnTimeoutMs
      ? setTimeout(() => {
        abortReason = `ACP prompt timed out after ${this.options.perTurnTimeoutMs}ms`;
        turnAbort.abort();
      }, this.options.perTurnTimeoutMs)
      : null;
    const abortByCaller = () => {
      abortReason = "ACP prompt cancelled";
      turnAbort.abort();
    };
    if (opts?.abortSignal) {
      opts.abortSignal.addEventListener("abort", abortByCaller, { once: true });
    }
    turnAbort.signal.addEventListener("abort", onAbort, { once: true });

    // Fire the prompt request; events will pile into #pendingEvents while
    // it's in flight. We yield them as they arrive, end when prompt resolves.
    const agentPromptDone = Promise.resolve(this.#agent.prompt({
      sessionId: this.#sessionId,
      prompt: normalizePromptInput(input),
    }));
    agentPromptDone.catch(() => { /* A timeout can end our iterator before the agent responds. */ });
    const abortDone = new Promise<never>((_, reject) => {
      turnAbort.signal.addEventListener("abort", () => reject(new Error(abortReason)), { once: true });
    });
    const promptDone = Promise.race([agentPromptDone, abortDone]).finally(() => {
      if (turnTimer) clearTimeout(turnTimer);
      opts?.abortSignal?.removeEventListener("abort", abortByCaller);
    });

    // Sentinel: the prompt completion is itself the last event. We mark
    // the queue as ended via #endStream() once it resolves.
    let ended = false;
    const endPromise = promptDone.then(
      (response) => {
        ended = true;
        this.#pushEvent({ type: "promptComplete", response });
        this.#endStream();
      },
      (err) => {
        ended = true;
        this.#pushEvent({ type: "promptError", error: String(err) });
        this.#endStream();
      },
    );

    while (true) {
      if (this.#pendingEvents.length > 0) {
        const ev = this.#pendingEvents.shift()!;
        yield ev;
        continue;
      }
      if (ended) break;
      // Wait for either next event or stream-end.
      await new Promise<void>((resolve) => {
        this.#waiters.push(resolve);
      });
    }

    // Make sure we surface any error from the prompt promise itself.
    await endPromise;
  }

  async provideToolResult(toolCallId: string, result: unknown): Promise<void> {
    // ACP's tool flow goes through the Client side — the agent issues
    // requestPermission / terminal calls / etc. and we respond. Tool
    // *execution* results flow back through whatever mechanism the
    // agent invented; ACP doesn't have a single "tool result" RPC.
    // For now this is a stub — wire concrete behaviour when openma
    // (the only caller that needs it) lands its tool integration.
    void toolCallId;
    void result;
    throw new Error("provideToolResult not yet implemented — see ACP tool/permission flow");
  }

  async setConfigOption(configId: string, value: string | boolean): Promise<SessionConfigOption[]> {
    const setSessionConfigOption = this.#agent.setSessionConfigOption?.bind(this.#agent);
    if (!setSessionConfigOption) {
      throw new Error("agent does not support session/set_config_option");
    }
    const response = await setSessionConfigOption(
      typeof value === "boolean"
        ? { sessionId: this.#sessionId, configId, type: "boolean", value }
        : { sessionId: this.#sessionId, configId, value },
    );
    this.#setSessionStateFromResponse(response);
    return this.#configOptions;
  }

  async setMode(modeId: string): Promise<SessionModeState | undefined> {
    const setSessionMode = this.#agent.setSessionMode?.bind(this.#agent);
    if (!setSessionMode) {
      throw new Error("agent does not support session/set_mode");
    }
    await setSessionMode({ sessionId: this.#sessionId, modeId });
    if (this.#modes) this.#modes = { ...this.#modes, currentModeId: modeId };
    return this.modes;
  }

  isAlive(): boolean {
    return !this.#disposed;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#endStream();
    await this.#child.kill("SIGTERM").catch(() => { /* already gone */ });
  }

  /** Producer side of the event queue; called from Client callbacks. */
  #pushEvent(ev: AcpSessionEvent): void {
    this.#setSessionStateFromEvent(ev);
    this.#pendingEvents.push(ev);
    const w = this.#waiters.shift();
    w?.();
  }

  #setSessionStateFromResponse(value: NewSessionResponse | LoadSessionResponse | ResumeSessionResponse | { configOptions?: SessionConfigOption[] | null; modes?: SessionModeState | null } | undefined): void {
    if (Array.isArray(value?.configOptions)) this.#configOptions = value.configOptions;
    if (value?.modes) this.#modes = structuredClone(value.modes);
  }

  #setSessionStateFromEvent(ev: AcpSessionEvent): void {
    if (!("sessionUpdate" in ev)) return;
    if (ev.sessionUpdate === "config_option_update") {
      this.#configOptions = ev.configOptions;
      return;
    }
    if (ev.sessionUpdate === "current_mode_update" && this.#modes) {
      this.#modes = { ...this.#modes, currentModeId: ev.currentModeId };
    }
  }

  /** Wakes up all waiters so the iterator can observe `ended === true`. */
  #endStream(): void {
    while (this.#waiters.length > 0) {
      this.#waiters.shift()!();
    }
  }

  async #settleLoadedReplay(): Promise<void> {
    const deadline = Date.now() + LOAD_REPLAY_MAX_SETTLE_MS;
    let lastSeen = this.#lastSuppressedLoadReplayAt;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, LOAD_REPLAY_QUIET_MS));
      if (this.#lastSuppressedLoadReplayAt === lastSeen) return;
      lastSeen = this.#lastSuppressedLoadReplayAt;
    }
  }
}

function normalizePromptInput(input: AcpPromptInput): ContentBlock[] {
  if (typeof input === "string") return [{ type: "text", text: input }];
  return input.length > 0 ? input : [{ type: "text", text: "" }];
}
