import {
  ClientSideConnection,
  RequestError,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type Client,
} from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import { withClashAcpExtensionCapabilities } from "./client-capabilities.js";
import { isAuthRequired } from "./errors.js";
import {
  isLegacyModelConfigOption,
  responseHasSessionConfig,
  sessionConfigOptionsFromResponse,
} from "./session-state.js";
import type {
  AcpSession,
  ChildHandle,
  ClientCallbacks,
  SessionOptions,
  SteeringOutcome,
} from "./types.js";

export interface AcpSessionConstructOptions {
  child: ChildHandle;
  options: SessionOptions;
  id: string;
}

type ChildExit = Awaited<ChildHandle["exited"]>;

const ACP_NOTIFICATION_CONTEXT_KEY = "_openma.acp.notification";
const LOAD_REPLAY_QUIET_MS = 30;
const LOAD_REPLAY_MAX_SETTLE_MS = 300;
const SESSION_CLOSE_TIMEOUT_MS = 1_000;

function filterMcpServersForCapabilities(
  servers: readonly schema.McpServer[],
  capabilities: { http?: boolean; sse?: boolean } | undefined,
): schema.McpServer[] {
  return servers.filter((server) => {
    const type = "type" in server ? server.type : "stdio";
    if (type === undefined || type === "stdio") return true;
    if (type === "http") return capabilities?.http === true;
    if (type === "sse") return capabilities?.sse === true;
    return false;
  });
}

function firstAgentHandledAuthMethod(
  authMethods: readonly schema.AuthMethod[],
): schema.AuthMethod | null {
  for (const method of authMethods) {
    if (!method.id) continue;
    const value = method as schema.AuthMethod & {
      type?: unknown;
      meta?: unknown;
      _meta?: unknown;
    };
    const meta = value._meta ?? value.meta;
    const metaType = meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as { type?: unknown }).type
      : undefined;
    const type = typeof value.type === "string"
      ? value.type
      : typeof metaType === "string"
        ? metaType
        : "agent";
    if (type === "agent") return method;
  }
  return null;
}

function preserveAcpNotificationContext(params: unknown): unknown {
  if (!params || typeof params !== "object") return params;
  const notification = params as Record<string, unknown>;
  if (!("update" in notification)) return params;
  const update = notification.update;
  if (!update || typeof update !== "object") return update;
  const notificationMeta = notification._meta;
  if (!notificationMeta || typeof notificationMeta !== "object") return update;
  return {
    ...(update as Record<string, unknown>),
    [ACP_NOTIFICATION_CONTEXT_KEY]: {
      ...(typeof notification.sessionId === "string"
        ? { session_id: notification.sessionId }
        : {}),
      meta: notificationMeta,
    },
  };
}

function mergeClientCapabilities(
  callbacks: ClientCallbacks,
  inferred: schema.ClientCapabilities,
  extra: schema.ClientCapabilities | undefined,
): schema.ClientCapabilities {
  const inferredSession = inferred.session as Record<string, unknown> | undefined;
  const extraSession = extra?.session as Record<string, unknown> | undefined;
  const inferredConfigOptions = inferredSession?.configOptions as Record<string, unknown> | undefined;
  const extraConfigOptions = extraSession?.configOptions as Record<string, unknown> | undefined;
  return withClashAcpExtensionCapabilities({
    ...inferred,
    ...extra,
    fs: {
      readTextFile: Boolean(callbacks.readTextFile),
      writeTextFile: Boolean(callbacks.writeTextFile),
      ...(inferred.fs ?? {}),
      ...(extra?.fs ?? {}),
    },
    session: {
      ...(inferredSession ?? {}),
      ...(extraSession ?? {}),
      configOptions: {
        ...(inferredConfigOptions ?? {}),
        ...(extraConfigOptions ?? {}),
      },
    },
    _meta: {
      ...(inferred._meta ?? {}),
      ...(extra?._meta ?? {}),
    },
  } as schema.ClientCapabilities);
}

export class AcpSessionImpl implements AcpSession {
  readonly id: string;
  readonly options: SessionOptions;

  #child: ChildHandle;
  #childExit: ChildExit | null = null;
  #agent!: Agent;
  #sessionId!: string;
  #disposed = false;
  #disposePromise: Promise<void> | null = null;
  #acceptOutOfBandUpdates = false;
  #activePromptCount = 0;
  #pendingEvents: unknown[] = [];
  #waiters: Array<(value: IteratorResult<unknown>) => void> = [];
  #authMethods: readonly schema.AuthMethod[] = [];
  #protocolVersion: schema.ProtocolVersion | null = null;
  #agentInfo: schema.Implementation | null = null;
  #agentCapabilities: schema.AgentCapabilities = {};
  #initializeMeta: Record<string, unknown> | null = null;
  #sessionSetupMeta: Record<string, unknown> | null = null;
  #configOptions: readonly schema.SessionConfigOption[] = [];
  #modes: schema.SessionModeState | null = null;
  #promptCapabilities: schema.PromptCapabilities = {};
  #supportsSessionFork = false;
  #supportsSessionList = false;
  #supportsSessionDelete = false;
  #supportsSessionResume = false;
  #supportsSessionClose = false;
  #supportsLogout = false;
  #supportsProviders = false;
  #supportsNes = false;
  #nesCapabilities: schema.NesCapabilities | null = null;
  #positionEncoding: schema.PositionEncodingKind | null = null;
  #supportsSteering = false;
  #nextClientRequestId = 1;
  #outstandingUrlElicitations = new Set<string>();
  #loadedReplayEvents: unknown[] = [];
  #suppressLoadedReplay = false;
  #lastSuppressedLoadReplayAt = 0;

  constructor(deps: AcpSessionConstructOptions) {
    this.id = deps.id;
    this.options = deps.options;
    this.#child = deps.child;
    void deps.child.exited.then((result) => {
      this.#childExit = result;
    });
  }

  get acpSessionId(): string {
    return this.#sessionId ?? "";
  }

  get authMethods(): readonly schema.AuthMethod[] {
    return this.#authMethods;
  }

  get protocolVersion(): schema.ProtocolVersion | null {
    return this.#protocolVersion;
  }

  get agentInfo(): schema.Implementation | null {
    return this.#agentInfo;
  }

  get agentCapabilities(): schema.AgentCapabilities {
    return this.#agentCapabilities;
  }

  get initializeMeta(): Record<string, unknown> | null {
    return this.#initializeMeta;
  }

  get sessionSetupMeta(): Record<string, unknown> | null {
    return this.#sessionSetupMeta;
  }

  get configOptions(): readonly schema.SessionConfigOption[] {
    return this.#configOptions;
  }

  get modes(): schema.SessionModeState | null {
    return this.#modes;
  }

  get promptCapabilities(): schema.PromptCapabilities {
    return this.#promptCapabilities;
  }

  get supportsSessionFork(): boolean {
    return this.#supportsSessionFork;
  }

  get supportsSessionList(): boolean {
    return this.#supportsSessionList;
  }

  get supportsSessionDelete(): boolean {
    return this.#supportsSessionDelete;
  }

  get supportsSessionResume(): boolean {
    return this.#supportsSessionResume;
  }

  get supportsSessionClose(): boolean {
    return this.#supportsSessionClose;
  }

  get supportsLogout(): boolean {
    return this.#supportsLogout;
  }

  get supportsProviders(): boolean {
    return this.#supportsProviders;
  }

  get supportsNes(): boolean {
    return this.#supportsNes;
  }

  get nesCapabilities(): schema.NesCapabilities | null {
    return this.#nesCapabilities;
  }

  get positionEncoding(): schema.PositionEncodingKind | null {
    return this.#positionEncoding;
  }

  get supportsSteering(): boolean {
    return this.#supportsSteering;
  }

  get loadedReplayEvents(): readonly unknown[] {
    return this.#loadedReplayEvents.map((event) => structuredClone(event));
  }

  async init(): Promise<void> {
    const initStartedAt = Date.now();
    const callbacks: ClientCallbacks = this.options.clientCallbacks ?? {};
    const requestedElicitationCapabilities =
      this.options.clientElicitationCapabilities
      ?? (callbacks.createElicitation
        ? {
            form: {},
            ...(callbacks.completeElicitation ? { url: {} } : {}),
          }
        : undefined);
    const elicitationCapabilities = callbacks.createElicitation
      && requestedElicitationCapabilities
      && (
        requestedElicitationCapabilities.form != null
        || requestedElicitationCapabilities.url != null
      )
      ? requestedElicitationCapabilities
      : undefined;
    const connection = new ClientSideConnection(
      (): Client => this.#createClient(
        callbacks,
        elicitationCapabilities?.url != null,
      ),
      ndJsonStream(this.#child.stdin, this.#child.stdout),
    );
    this.#agent = connection;

    const inferredClientCapabilities = {
        // The existing OpenMA controls render both boolean config options and
        // structured/markdown plans. Advertising these capabilities prevents
        // agents such as codex-acp from degrading them to plain transcript
        // text even though the canonical event and GUI projections exist.
        session: {
          configOptions: {
            boolean: {},
          },
        },
        plan: {},
        // Claude Agent ACP uses this ACP-reserved extension capability to
        // forward nested subagent text, thinking, and tool updates. It is
        // harmless for agents that do not implement the extension: ACP
        // clients and agents must treat unknown `_meta` keys as optional.
        _meta: {
          "subagent-transcript": true,
          // claude-agent-acp and codex-acp use this negotiated extension to
          // send terminal snapshots instead of forcing clients to reconstruct
          // them from provider-specific delta notifications.
          terminal_output: true,
        },
        fs: {
          readTextFile: Boolean(callbacks.readTextFile),
          writeTextFile: Boolean(callbacks.writeTextFile),
        },
        terminal: Boolean(callbacks.createTerminal),
        ...(elicitationCapabilities
          ? { elicitation: elicitationCapabilities }
          : {}),
        ...(this.options.clientNesCapabilities
          ? { nes: this.options.clientNesCapabilities }
          : {}),
        ...(this.options.positionEncodings?.length
          ? { positionEncodings: this.options.positionEncodings }
          : {}),
      } satisfies schema.ClientCapabilities;
    const initialized = await this.#agent.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: mergeClientCapabilities(
        callbacks,
        inferredClientCapabilities,
        this.options.clientCapabilities,
      ),
    });
    const initializedAt = Date.now();

    this.#authMethods = initialized.authMethods ?? [];
    this.#protocolVersion = initialized.protocolVersion;
    this.#agentInfo = initialized.agentInfo ?? null;
    this.#agentCapabilities = initialized.agentCapabilities ?? {};
    this.#initializeMeta = initialized._meta ?? null;
    this.#promptCapabilities = this.#agentCapabilities.promptCapabilities ?? {};
    this.#supportsSessionFork =
      initialized.agentCapabilities?.sessionCapabilities?.fork != null;
    this.#supportsSessionList =
      initialized.agentCapabilities?.sessionCapabilities?.list != null;
    this.#supportsSessionDelete =
      initialized.agentCapabilities?.sessionCapabilities?.delete != null;
    this.#supportsSessionResume =
      initialized.agentCapabilities?.sessionCapabilities?.resume != null;
    this.#supportsSessionClose =
      initialized.agentCapabilities?.sessionCapabilities?.close != null;
    this.#supportsLogout = initialized.agentCapabilities?.auth?.logout != null;
    this.#supportsProviders = initialized.agentCapabilities?.providers != null;
    this.#nesCapabilities = initialized.agentCapabilities?.nes ?? null;
    this.#supportsNes = this.#nesCapabilities != null;
    this.#positionEncoding = initialized.agentCapabilities?.positionEncoding ?? null;
    this.#supportsSteering =
      (initialized._meta as { steering?: { supported?: unknown } } | undefined)
        ?.steering?.supported === true;

    const cwd = this.options.agent.cwd ?? process.cwd();
    const mcpServers = filterMcpServersForCapabilities(
      this.options.mcpServers ?? [],
      initialized.agentCapabilities?.mcpCapabilities,
    );
    const requestMeta = this.options.sessionRequestMeta;
    let attemptedAuth = false;
    const withAuthRetry = async <T>(request: () => T): Promise<Awaited<T>> => {
      try {
        return await request();
      } catch (error) {
        const method = firstAgentHandledAuthMethod(this.#authMethods);
        if (
          attemptedAuth
          || this.options.autoAuthenticate === false
          || !method
          || !isAuthRequired(error)
        ) {
          throw error;
        }
        attemptedAuth = true;
        await this.#agent.authenticate({ methodId: method.id });
        return await request();
      }
    };

    if (this.options.forkFromAcpSessionId) {
      if (!this.#supportsSessionFork || !this.#agent.unstable_forkSession) {
        throw new Error("ACP agent does not support unstable session/fork");
      }
      const forked = await withAuthRetry(() => this.#agent.unstable_forkSession!({
        sessionId: this.options.forkFromAcpSessionId!,
        cwd,
        mcpServers,
        ...(requestMeta ? { _meta: requestMeta } : {}),
      }));
      this.#sessionId = forked.sessionId;
      this.#setSessionStateFromResponse(forked);
      this.#sessionSetupMeta = forked._meta ?? null;
      this.#acceptOutOfBandUpdates = true;
      this.#logInit("fork", initStartedAt, initializedAt);
      return;
    }

    if (
      this.options.resumeAcpSessionId &&
      this.#supportsSessionResume &&
      this.#agent.resumeSession
    ) {
      try {
        const resumed = await withAuthRetry(() => this.#agent.resumeSession!({
          sessionId: this.options.resumeAcpSessionId!,
          cwd,
          mcpServers,
          ...(requestMeta ? { _meta: requestMeta } : {}),
        }));
        this.#sessionId = this.options.resumeAcpSessionId;
        this.#setSessionStateFromResponse(resumed);
        this.#sessionSetupMeta = resumed._meta ?? null;
        this.#acceptOutOfBandUpdates = true;
        this.#logInit("resume", initStartedAt, initializedAt);
        return;
      } catch (error) {
        console.error(
          `[acp] session/resume(${this.options.resumeAcpSessionId}) failed, falling back to load/new:`,
          error,
        );
      }
    }

    if (
      this.options.resumeAcpSessionId &&
      initialized.agentCapabilities?.loadSession === true &&
      this.#agent.loadSession
    ) {
      try {
        this.#loadedReplayEvents = [];
        this.#suppressLoadedReplay = true;
        this.#lastSuppressedLoadReplayAt = 0;
        const loaded = await withAuthRetry(() => this.#agent.loadSession!({
          sessionId: this.options.resumeAcpSessionId!,
          cwd,
          mcpServers,
          ...(requestMeta ? { _meta: requestMeta } : {}),
        }));
        this.#sessionId = this.options.resumeAcpSessionId;
        this.#setSessionStateFromResponse(loaded);
        this.#sessionSetupMeta = loaded?._meta ?? null;
        await this.#settleLoadedReplay();
        this.#acceptOutOfBandUpdates = true;
        this.#logInit("load", initStartedAt, initializedAt);
        return;
      } catch (error) {
        this.#loadedReplayEvents = [];
        console.error(
          `[acp] session/load(${this.options.resumeAcpSessionId}) failed, falling back to new:`,
          error,
        );
      } finally {
        this.#suppressLoadedReplay = false;
      }
    }

    const created = await withAuthRetry(() => this.#agent.newSession({
      cwd,
      mcpServers,
      ...(requestMeta ? { _meta: requestMeta } : {}),
    }));
    this.#sessionId = created.sessionId;
    this.#setSessionStateFromResponse(created);
    this.#sessionSetupMeta = created._meta ?? null;
    this.#acceptOutOfBandUpdates = true;
    this.#logInit("new", initStartedAt, initializedAt);
  }

  #createClient(
    callbacks: ClientCallbacks,
    supportsUrlElicitation: boolean,
  ): Client {
    return {
      sessionUpdate: async (params) => {
        const update = preserveAcpNotificationContext(params);
        if (this.#suppressLoadedReplay && isTranscriptReplayUpdate(update)) {
          this.#lastSuppressedLoadReplayAt = Date.now();
          this.#loadedReplayEvents.push(update);
          return;
        }
        this.#receiveInboundEvent(update, isIdleSessionUpdate(update));
      },
      requestPermission: async (params) => {
        return this.#runClientRequest("session/request_permission", params, async () => {
          if (!callbacks.requestPermission) {
            return { outcome: { outcome: "cancelled" as const } };
          }
          try {
            return await callbacks.requestPermission(params);
          } catch (error) {
            this.#pushEvent({ type: "requestPermissionError", error: String(error) });
            return { outcome: { outcome: "cancelled" as const } };
          }
        });
      },
      readTextFile: callbacks.readTextFile
        ? async (params) => this.#runClientRequest(
            "fs/read_text_file",
            params,
            () => callbacks.readTextFile!(params),
          )
        : undefined,
      writeTextFile: callbacks.writeTextFile
        ? async (params) => this.#runClientRequest(
            "fs/write_text_file",
            params,
            () => callbacks.writeTextFile!(params),
          )
        : undefined,
      createTerminal: callbacks.createTerminal
        ? async (params) => this.#runClientRequest(
            "terminal/create",
            params,
            () => callbacks.createTerminal!(params),
          )
        : undefined,
      terminalOutput: callbacks.terminalOutput
        ? async (params) => this.#runClientRequest(
            "terminal/output",
            params,
            () => callbacks.terminalOutput!(params),
          )
        : undefined,
      releaseTerminal: callbacks.releaseTerminal
        ? async (params) => this.#runClientRequest(
            "terminal/release",
            params,
            () => callbacks.releaseTerminal!(params),
          )
        : undefined,
      waitForTerminalExit: callbacks.waitForTerminalExit
        ? async (params) => this.#runClientRequest(
            "terminal/wait_for_exit",
            params,
            () => callbacks.waitForTerminalExit!(params),
          )
        : undefined,
      killTerminal: callbacks.killTerminal
        ? async (params) => this.#runClientRequest(
            "terminal/kill",
            params,
            () => callbacks.killTerminal!(params),
          )
        : undefined,
      unstable_createElicitation: callbacks.createElicitation
        ? async (params) => {
            const response = await this.#runClientRequest(
              "elicitation/create",
              params,
              () => callbacks.createElicitation!(params),
            );
            if (
              params.mode === "url"
              && response.action === "accept"
              && typeof params.elicitationId === "string"
            ) {
              this.#outstandingUrlElicitations.add(params.elicitationId);
            }
            return response;
          }
        : undefined,
      unstable_completeElicitation: supportsUrlElicitation
        ? async (params) => {
            if (!this.#outstandingUrlElicitations.delete(params.elicitationId)) return;
            this.#receiveClientNotification("elicitation/complete", params);
            await callbacks.completeElicitation?.(params);
            this.#receiveInboundEvent({
              type: "acp.elicitation_complete",
              method: "elicitation/complete",
              params,
            });
          }
        : undefined,
      extMethod: async (method, params) => this.#runClientRequest(
        method,
        params,
        async () => {
          if (method === "mcp/connect" && callbacks.connectMcp) {
            return callbacks.connectMcp(params as schema.ConnectMcpRequest);
          }
          if (method === "mcp/message" && callbacks.messageMcp) {
            return await callbacks.messageMcp(
              params as schema.MessageMcpRequest,
            ) as Record<string, unknown>;
          }
          if (method === "mcp/disconnect" && callbacks.disconnectMcp) {
            return (await callbacks.disconnectMcp(
              params as schema.DisconnectMcpRequest,
            )) ?? {};
          }
          this.#receiveInboundEvent({
            type: "acp.extension_request",
            method,
            params,
          });
          if (callbacks.extensionRequest) {
            return callbacks.extensionRequest(method, params);
          }
          throw RequestError.methodNotFound(method);
        },
      ),
      extNotification: async (method, params) => {
        this.#receiveClientNotification(method, params);
        try {
          if (method === "mcp/message" && callbacks.notifyMcp) {
            await callbacks.notifyMcp(params as schema.MessageMcpNotification);
            this.#receiveInboundEvent({
              type: "acp.mcp_notification",
              method,
              params,
            });
            return;
          }
          await callbacks.extensionNotification?.(method, params);
        } catch (error) {
          console.error("[acp] extension notification callback failed:", error);
        }
        this.#receiveInboundEvent({
          type: "acp.extension_notification",
          method,
          params,
        });
      },
    };
  }

  async #runClientRequest<T>(
    method: string,
    params: unknown,
    invoke: () => Promise<T> | T,
  ): Promise<T> {
    const requestId = `client-request-${this.#nextClientRequestId++}`;
    this.#receiveInboundEvent({
      type: "acp.client_request",
      requestId,
      method,
      params,
    });
    try {
      const result = await invoke();
      this.#receiveInboundEvent({
        type: "acp.client_response",
        requestId,
        method,
        result,
      });
      return result;
    } catch (error) {
      this.#receiveInboundEvent({
        type: "acp.client_error",
        requestId,
        method,
        error: clientCallbackError(error),
      });
      throw error;
    }
  }

  #receiveClientNotification(method: string, params: unknown): void {
    this.#receiveInboundEvent({
      type: "acp.client_notification",
      method,
      params,
    });
  }

  #receiveInboundEvent(event: unknown, allowedBeforeSessionReady = false): void {
    if (this.#activePromptCount === 0) {
      if (!this.#acceptOutOfBandUpdates && !allowedBeforeSessionReady) return;
      if (this.#acceptOutOfBandUpdates && this.options.onOutOfBandSessionUpdate) {
        try {
          this.options.onOutOfBandSessionUpdate(event);
        } catch (error) {
          console.error("[acp] out-of-band session update callback failed:", error);
        }
        return;
      }
    }
    this.#pushEvent(event);
  }

  #logInit(mode: "new" | "load" | "fork" | "resume", startedAt: number, initializedAt: number): void {
    if (process.env.NODE_ENV === "test") return;
    const completedAt = Date.now();
    process.stderr.write(
      `[acp-init] id=${this.id} mode=${mode} initialize_ms=${initializedAt - startedAt} session_open_ms=${completedAt - initializedAt} total_ms=${completedAt - startedAt}\n`,
    );
  }

  async authenticate(methodId: string): Promise<void> {
    if (!this.#agent) throw new Error("AcpSession not initialized");
    await this.#agent.authenticate({ methodId });
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.#agent || !this.#sessionId) throw new Error("AcpSession not initialized");
    const setSessionMode = (
      this.#agent as { setSessionMode?: (params: unknown) => Promise<unknown> }
    ).setSessionMode;
    if (typeof setSessionMode !== "function") return;
    try {
      await setSessionMode.call(this.#agent, { sessionId: this.#sessionId, modeId });
      if (this.#modes) this.#modes = { ...this.#modes, currentModeId: modeId };
    } catch (error) {
      console.warn(`[acp] setSessionMode("${modeId}") failed:`, error);
    }
  }

  async setConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<readonly schema.SessionConfigOption[]> {
    if (!this.#agent || !this.#sessionId) throw new Error("AcpSession not initialized");
    const legacyModelOption = this.#configOptions.find(
      (option) => option.id === configId && isLegacyModelConfigOption(option),
    );
    if (legacyModelOption) {
      if (typeof value !== "string") {
        throw new Error("Legacy ACP model selection requires a string model id");
      }
      if (!this.#agent.extMethod) {
        throw new Error("ACP agent does not support legacy model selection");
      }
      await this.#agent.extMethod("session/set_model", {
        sessionId: this.#sessionId,
        modelId: value,
      });
      this.#configOptions = this.#configOptions.map((option) => {
        if (option !== legacyModelOption || option.type !== "select") return option;
        return { ...option, currentValue: value };
      });
      return this.#configOptions;
    }
    const setSessionConfigOption = (
      this.#agent as {
        setSessionConfigOption?: (
          params: schema.SetSessionConfigOptionRequest,
        ) => Promise<schema.SetSessionConfigOptionResponse>;
      }
    ).setSessionConfigOption;
    if (typeof setSessionConfigOption !== "function") {
      throw new Error("ACP agent does not support session config options");
    }
    const response = await setSessionConfigOption.call(this.#agent, {
      sessionId: this.#sessionId,
      configId,
      ...(typeof value === "boolean" ? { type: "boolean" as const, value } : { value }),
    });
    this.#setSessionStateFromResponse(response);
    return this.#configOptions;
  }

  async listSessions(
    params: schema.ListSessionsRequest = {},
  ): Promise<schema.ListSessionsResponse> {
    if (!this.#supportsSessionList || !this.#agent?.listSessions) {
      throw new Error("ACP agent does not support session/list");
    }
    return this.#agent.listSessions(params);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.#supportsSessionDelete || !this.#agent?.deleteSession) {
      throw new Error("ACP agent does not support session/delete");
    }
    await this.#agent.deleteSession({ sessionId });
  }

  async logout(): Promise<void> {
    if (!this.#supportsLogout || !this.#agent?.logout) {
      throw new Error("ACP agent does not support logout");
    }
    await this.#agent.logout({});
  }

  async listProviders(): Promise<schema.ListProvidersResponse> {
    if (!this.#supportsProviders || !this.#agent?.unstable_listProviders) {
      throw new Error("ACP agent does not support providers/list");
    }
    return this.#agent.unstable_listProviders({});
  }

  async setProvider(params: schema.SetProviderRequest): Promise<void> {
    if (!this.#supportsProviders || !this.#agent?.unstable_setProvider) {
      throw new Error("ACP agent does not support providers/set");
    }
    await this.#agent.unstable_setProvider(params);
  }

  async disableProvider(providerId: schema.ProviderId): Promise<void> {
    if (!this.#supportsProviders || !this.#agent?.unstable_disableProvider) {
      throw new Error("ACP agent does not support providers/disable");
    }
    await this.#agent.unstable_disableProvider({ providerId });
  }

  async requestExtension(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (!this.#agent?.extMethod) {
      throw new Error("ACP connection does not support extension requests");
    }
    return this.#agent.extMethod(method, params);
  }

  async notifyExtension(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.#agent?.extNotification) {
      throw new Error("ACP connection does not support extension notifications");
    }
    await this.#agent.extNotification(method, params);
  }

  async startNes(
    params: schema.StartNesRequest,
  ): Promise<schema.StartNesResponse> {
    this.#assertNesMethod(this.#agent?.unstable_startNes, "nes/start");
    return this.#agent.unstable_startNes(params);
  }

  async suggestNes(
    params: schema.SuggestNesRequest,
  ): Promise<schema.SuggestNesResponse> {
    this.#assertNesMethod(this.#agent?.unstable_suggestNes, "nes/suggest");
    return this.#agent.unstable_suggestNes(params);
  }

  async closeNes(
    params: schema.CloseNesRequest,
  ): Promise<schema.CloseNesResponse | void> {
    this.#assertNesMethod(this.#agent?.unstable_closeNes, "nes/close");
    return this.#agent.unstable_closeNes(params);
  }

  async didOpenDocument(
    params: schema.DidOpenDocumentNotification,
  ): Promise<void> {
    this.#assertNesDocumentEvent("didOpen", this.#agent?.unstable_didOpenDocument);
    await this.#agent.unstable_didOpenDocument(params);
  }

  async didChangeDocument(
    params: schema.DidChangeDocumentNotification,
  ): Promise<void> {
    this.#assertNesDocumentEvent("didChange", this.#agent?.unstable_didChangeDocument);
    await this.#agent.unstable_didChangeDocument(params);
  }

  async didCloseDocument(
    params: schema.DidCloseDocumentNotification,
  ): Promise<void> {
    this.#assertNesDocumentEvent("didClose", this.#agent?.unstable_didCloseDocument);
    await this.#agent.unstable_didCloseDocument(params);
  }

  async didSaveDocument(
    params: schema.DidSaveDocumentNotification,
  ): Promise<void> {
    this.#assertNesDocumentEvent("didSave", this.#agent?.unstable_didSaveDocument);
    await this.#agent.unstable_didSaveDocument(params);
  }

  async didFocusDocument(
    params: schema.DidFocusDocumentNotification,
  ): Promise<void> {
    this.#assertNesDocumentEvent("didFocus", this.#agent?.unstable_didFocusDocument);
    await this.#agent.unstable_didFocusDocument(params);
  }

  async acceptNes(params: schema.AcceptNesNotification): Promise<void> {
    this.#assertNesMethod(this.#agent?.unstable_acceptNes, "nes/accept");
    await this.#agent.unstable_acceptNes(params);
  }

  async rejectNes(params: schema.RejectNesNotification): Promise<void> {
    this.#assertNesMethod(this.#agent?.unstable_rejectNes, "nes/reject");
    await this.#agent.unstable_rejectNes(params);
  }

  #assertNesMethod(
    method: ((params: never) => unknown) | undefined,
    name: string,
  ): asserts method is (params: never) => unknown {
    if (!this.#supportsNes || typeof method !== "function") {
      throw new Error(`ACP agent does not support ${name}`);
    }
  }

  #assertNesDocumentEvent(
    event: keyof schema.NesDocumentEventCapabilities,
    method: ((params: never) => unknown) | undefined,
  ): asserts method is (params: never) => unknown {
    const capability = this.#nesCapabilities?.events?.document?.[event];
    if (capability == null || typeof method !== "function") {
      throw new Error(`ACP agent does not support document/${event}`);
    }
  }

  prompt(
    input: string | readonly schema.ContentBlock[],
    options?: { abortSignal?: AbortSignal },
  ): AsyncIterable<unknown> {
    if (this.#disposed) throw new Error(`AcpSession ${this.id} is disposed`);
    return this.#guardPrompt(this.#prompt(input, options));
  }

  async *#guardPrompt(stream: AsyncIterable<unknown>): AsyncIterable<unknown> {
    let promptFailure: unknown;
    for await (const event of stream) {
      if ((event as { type?: unknown } | null)?.type === "promptError") {
        promptFailure = (event as { error?: unknown }).error;
      }
      yield event;
    }
    if (promptFailure === undefined) return;
    const exit = this.#childExit ?? await settledChildExit(this.#child.exited);
    if (exit || isBrokenPipe(promptFailure)) {
      throw agentProcessExitError(this.options.agent.command, exit, promptFailure);
    }
  }

  async steer(input: string | readonly schema.ContentBlock[]): Promise<SteeringOutcome> {
    if (!this.#agent || !this.#sessionId) throw new Error("AcpSession not initialized");
    if (!this.#supportsSteering) {
      throw new Error("ACP agent did not negotiate _session/steering");
    }
    if (!this.#agent.extMethod) throw new Error("ACP connection does not support extensions");
    const prompt =
      typeof input === "string"
        ? [{ type: "text" as const, text: input }]
        : [...input];
    const response = await this.#agent.extMethod("_session/steering", {
      sessionId: this.#sessionId,
      prompt,
      _meta: { steering: { idleBehavior: "promptRequired" } },
    });
    const outcome = response.outcome;
    if (
      outcome !== "injected"
      && outcome !== "promptRequired"
      && outcome !== "startedNewTurn"
      && outcome !== "failed"
    ) {
      throw new Error(`Invalid _session/steering outcome: ${String(outcome)}`);
    }
    return outcome;
  }

  async cancelCurrentTurn(): Promise<void> {
    if (!this.#agent || !this.#sessionId) throw new Error("AcpSession not initialized");
    await this.#agent.cancel({ sessionId: this.#sessionId });
  }

  async provideToolResult(toolCallId: string, result: unknown): Promise<void> {
    void toolCallId;
    void result;
    throw new Error("provideToolResult not implemented; ACP tools use client callbacks");
  }

  drainPendingEvents(): unknown[] {
    return this.#pendingEvents.splice(0);
  }

  async *#prompt(
    input: string | readonly schema.ContentBlock[],
    options?: { abortSignal?: AbortSignal },
  ): AsyncIterable<unknown> {
    const timeoutAbort = new AbortController();
    const cancelAgent = () => {
      void Promise.resolve(this.#agent.cancel({ sessionId: this.#sessionId }))
        .catch(() => undefined);
    };
    const abortByCaller = () => cancelAgent();
    const timer = this.options.perTurnTimeoutMs
      ? setTimeout(() => timeoutAbort.abort(), this.options.perTurnTimeoutMs)
      : undefined;
    timer?.unref?.();
    options?.abortSignal?.addEventListener("abort", abortByCaller, { once: true });
    timeoutAbort.signal.addEventListener("abort", cancelAgent, { once: true });
    if (options?.abortSignal?.aborted) abortByCaller();

    this.#activePromptCount += 1;
    const prompt = typeof input === "string" ? [{ type: "text" as const, text: input }] : [...input];
    const agentPrompt = Promise.resolve(
      this.#agent.prompt({ sessionId: this.#sessionId, prompt }),
    );
    void agentPrompt.catch(() => undefined);
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutAbort.signal.addEventListener("abort", () => {
        reject(new Error(`ACP prompt timed out after ${this.options.perTurnTimeoutMs}ms`));
      }, { once: true });
    });
    const done = Promise.race([agentPrompt, timeout])
      .finally(() => {
        this.#activePromptCount = Math.max(0, this.#activePromptCount - 1);
        if (timer) clearTimeout(timer);
        options?.abortSignal?.removeEventListener("abort", abortByCaller);
        timeoutAbort.signal.removeEventListener("abort", cancelAgent);
      });

    let ended = false;
    const endPromise = done.then(
      (response) => {
        ended = true;
        this.#pushEvent({ type: "promptComplete", response });
        this.#endStream();
      },
      (error) => {
        ended = true;
        this.#pushEvent({ type: "promptError", error: String(error) });
        this.#endStream();
      },
    );

    while (true) {
      if (this.#pendingEvents.length > 0) {
        yield this.#pendingEvents.shift();
      } else if (ended) {
        break;
      } else {
        await new Promise<void>((resolve) => {
          this.#waiters.push(() => resolve());
        });
      }
    }
    await endPromise;
  }

  isAlive(): boolean {
    return !this.#disposed && this.#childExit === null;
  }

  dispose(): Promise<void> {
    this.#disposePromise ??= this.#disposeOnce();
    return this.#disposePromise;
  }

  async #disposeOnce(): Promise<void> {
    this.#disposed = true;
    this.#outstandingUrlElicitations.clear();
    this.#endStream();
    if (this.#supportsSessionClose && this.#sessionId && this.#agent?.closeSession) {
      try {
        await withTimeout(
          Promise.resolve(this.#agent.closeSession({ sessionId: this.#sessionId })),
          SESSION_CLOSE_TIMEOUT_MS,
          `ACP session close timed out after ${SESSION_CLOSE_TIMEOUT_MS}ms`,
        );
      } catch (error) {
        console.warn(`[acp] session/close(${this.#sessionId}) failed:`, error);
      }
    }
    await this.#child.kill("SIGTERM").catch(() => {});
  }

  #pushEvent(event: unknown): void {
    this.#setSessionStateFromEvent(event);
    this.#pendingEvents.push(event);
    this.#waiters.shift()?.({ value: undefined, done: false });
  }

  #endStream(): void {
    while (this.#waiters.length > 0) {
      this.#waiters.shift()?.({ value: undefined, done: true });
    }
  }

  #setSessionStateFromResponse(value: unknown): void {
    if (responseHasSessionConfig(value)) {
      this.#configOptions = sessionConfigOptionsFromResponse(value);
    }
    const modes = value && typeof value === "object"
      ? (value as { modes?: schema.SessionModeState | null }).modes
      : undefined;
    if (modes) this.#modes = structuredClone(modes);
  }

  #setSessionStateFromEvent(event: unknown): void {
    if (!event || typeof event !== "object") return;
    const update = event as {
      sessionUpdate?: unknown;
      configOptions?: unknown;
      currentModeId?: unknown;
    };
    if (
      update.sessionUpdate === "config_option_update"
      && Array.isArray(update.configOptions)
    ) {
      this.#configOptions = update.configOptions.map((option) => structuredClone(option));
      return;
    }
    if (
      update.sessionUpdate === "current_mode_update"
      && this.#modes
      && typeof update.currentModeId === "string"
    ) {
      this.#modes = { ...this.#modes, currentModeId: update.currentModeId };
    }
  }

  async #settleLoadedReplay(): Promise<void> {
    const deadline = Date.now() + LOAD_REPLAY_MAX_SETTLE_MS;
    let lastSeen = this.#lastSuppressedLoadReplayAt;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, LOAD_REPLAY_QUIET_MS));
      if (this.#lastSuppressedLoadReplayAt === lastSeen) return;
      lastSeen = this.#lastSuppressedLoadReplayAt;
    }
  }
}

function clientCallbackError(error: unknown): { message: string; code?: number } {
  const code =
    error !== null
    && typeof error === "object"
    && typeof (error as { code?: unknown }).code === "number"
      ? (error as { code: number }).code
      : undefined;
  const message = code === -32601
    ? "Method not found"
    : error instanceof Error
      ? error.message
      : String(error);
  return {
    message,
    ...(code !== undefined ? { code } : {}),
  };
}

const IDLE_SESSION_UPDATES = new Set([
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
  "session_info_update",
  "usage_update",
]);

function isTranscriptReplayUpdate(update: unknown): boolean {
  const tag = (update as { sessionUpdate?: unknown } | null)?.sessionUpdate;
  return typeof tag !== "string" || !IDLE_SESSION_UPDATES.has(tag);
}

function isIdleSessionUpdate(update: unknown): boolean {
  const tag = (update as { sessionUpdate?: unknown } | null)?.sessionUpdate;
  return typeof tag === "string" && IDLE_SESSION_UPDATES.has(tag);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function settledChildExit(
  exited: ChildHandle["exited"],
): Promise<ChildExit | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 25);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isBrokenPipe(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "EPIPE"
    || code === "ERR_STREAM_DESTROYED"
    || /\bEPIPE\b|broken pipe|stream (?:is )?(?:closed|destroyed)/i.test(message);
}

function agentProcessExitError(
  command: string,
  exit: ChildExit | null,
  cause: unknown,
): Error {
  const status = exit?.signal
    ? `signal ${exit.signal}`
    : exit?.code != null
      ? `exit code ${exit.code}`
      : "no exit status";
  return new Error(
    `The agent process exited before it could accept the prompt (${command}, ${status}). `
      + "Reopen the task to restart it, or check this agent's setup and sign-in.",
    { cause },
  );
}
