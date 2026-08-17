import type * as schema from "@agentclientprotocol/sdk";

export type AcpPromptInput = string | readonly schema.ContentBlock[];
export type AcpSessionEvent = unknown;

export interface AgentSpec {
  command: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  onDiagnosticLine?: (line: string) => void;
}

export interface ChildHandle {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
  exited: Promise<{ code: number | null; signal: string | null }>;
}

export interface Spawner {
  spawn(spec: AgentSpec): Promise<ChildHandle>;
}

export interface RestartPolicy {
  mode: "never" | "on-crash" | "always";
  maxRestarts?: number;
  windowMs?: number;
}

export interface ClientCallbacks {
  requestPermission?(
    params: schema.RequestPermissionRequest,
  ): Promise<schema.RequestPermissionResponse>;
  readTextFile?(params: schema.ReadTextFileRequest): Promise<schema.ReadTextFileResponse>;
  writeTextFile?(params: schema.WriteTextFileRequest): Promise<schema.WriteTextFileResponse>;
  createTerminal?(params: schema.CreateTerminalRequest): Promise<schema.CreateTerminalResponse>;
  terminalOutput?(params: schema.TerminalOutputRequest): Promise<schema.TerminalOutputResponse>;
  releaseTerminal?(
    params: schema.ReleaseTerminalRequest,
  ): Promise<schema.ReleaseTerminalResponse | void>;
  waitForTerminalExit?(
    params: schema.WaitForTerminalExitRequest,
  ): Promise<schema.WaitForTerminalExitResponse>;
  killTerminal?(params: schema.KillTerminalRequest): Promise<schema.KillTerminalResponse | void>;
  createElicitation?(
    params: schema.CreateElicitationRequest,
  ): Promise<schema.CreateElicitationResponse>;
  completeElicitation?(
    params: schema.CompleteElicitationNotification,
  ): Promise<void> | void;
  connectMcp?(params: schema.ConnectMcpRequest): Promise<schema.ConnectMcpResponse>;
  messageMcp?(params: schema.MessageMcpRequest): Promise<schema.MessageMcpResponse>;
  notifyMcp?(params: schema.MessageMcpNotification): Promise<void> | void;
  disconnectMcp?(
    params: schema.DisconnectMcpRequest,
  ): Promise<schema.DisconnectMcpResponse | void>;
  /** Handle an agent-to-client ACP extension request. When omitted, the SDK
   * correctly returns JSON-RPC Method not found instead of inventing a
   * response for an unknown harness contract. */
  extensionRequest?(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  /** Observe an agent-to-client ACP extension notification in addition to
   * the runtime retaining it in the session event stream. */
  extensionNotification?(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> | void;
}

export interface SessionOptions {
  agent: AgentSpec;
  restart?: RestartPolicy;
  idleTimeoutMs?: number;
  perTurnTimeoutMs?: number;
  /** Hard cap on initialize/auth/session creation. `0` disables it. */
  initTimeoutMs?: number;
  resumeAcpSessionId?: string;
  forkFromAcpSessionId?: string;
  mcpServers?: schema.McpServer[];
  /** Adapter-specific metadata sent on session/new, load, resume, and fork.
   * The shared runtime transports it without interpretation; each harness
   * owns the keys it understands. */
  sessionRequestMeta?: Record<string, unknown>;
  /** NES suggestion kinds the host can render/apply. Omit when the host has
   * no editor surface; the runtime must not advertise an empty capability by
   * assumption. */
  clientNesCapabilities?: schema.ClientNesCapabilities;
  /** Position encodings understood by the host editor, in preference order. */
  positionEncodings?: schema.PositionEncodingKind[];
  /** Elicitation modes the host can faithfully render and answer. Keep this
   * explicit because receiving the optional `elicitation/complete`
   * notification is not what determines URL-mode support. */
  clientElicitationCapabilities?: schema.ElicitationCapabilities;
  clientCallbacks?: ClientCallbacks;
  /** Clash-specific capabilities merged on top of the Backchat baseline. */
  clientCapabilities?: schema.ClientCapabilities;
  /** Retry session open once with the first agent-handled auth method. Defaults to true. */
  autoAuthenticate?: boolean;
  /** Legacy compatibility only. Callback lifecycle events are always retained. */
  emitPermissionEvents?: boolean;
  /** Receives live `session/update` notifications that arrive after session
   * initialization while no host-owned `prompt()` iterator is active. The
   * runtime preserves the raw adapter payload; per-harness lifecycle meaning
   * belongs to the host adapter layer. */
  onOutOfBandSessionUpdate?(update: unknown): void;
}

export type SteeringOutcome =
  | "injected"
  | "promptRequired"
  | "startedNewTurn"
  | "failed";

export interface AcpSession {
  readonly id: string;
  readonly acpSessionId: string;
  readonly options: SessionOptions;
  readonly authMethods: readonly schema.AuthMethod[];
  readonly protocolVersion: schema.ProtocolVersion | null;
  readonly agentInfo: schema.Implementation | null;
  readonly agentCapabilities: schema.AgentCapabilities;
  readonly initializeMeta: Record<string, unknown> | null;
  /** Raw `_meta` returned by the successful session/new, load, resume, or
   * fork response. It is adapter evidence, not a GUI contract. */
  readonly sessionSetupMeta: Record<string, unknown> | null;
  readonly configOptions: readonly schema.SessionConfigOption[];
  /** ACP v1 legacy-compatible session mode state. `configOptions` remains
   * preferred when the agent exposes both contracts. */
  readonly modes: schema.SessionModeState | null;
  readonly promptCapabilities: schema.PromptCapabilities;
  readonly supportsSessionFork: boolean;
  readonly supportsSessionList: boolean;
  readonly supportsSessionDelete: boolean;
  readonly supportsSessionResume: boolean;
  readonly supportsSessionClose: boolean;
  readonly supportsLogout: boolean;
  readonly supportsProviders: boolean;
  readonly supportsNes: boolean;
  readonly nesCapabilities: schema.NesCapabilities | null;
  readonly positionEncoding: schema.PositionEncodingKind | null;
  /** Whether initialize negotiated the vendor `_session/steering` method. */
  readonly supportsSteering: boolean;
  /** Compatibility view for old Clash callers; use `drainPendingEvents()`. */
  readonly loadedReplayEvents?: readonly AcpSessionEvent[];
  prompt(
    input: string | readonly schema.ContentBlock[],
    opts?: { abortSignal?: AbortSignal },
  ): AsyncIterable<unknown>;
  steer(input: string | readonly schema.ContentBlock[]): Promise<SteeringOutcome>;
  /** Send the standard ACP `session/cancel` input even when the active turn
   * was started by an extension and has no host-owned prompt iterator. */
  cancelCurrentTurn(): Promise<void>;
  /** Compatibility hook for older hosts; ACP tool results are handled through client callbacks. */
  provideToolResult?(toolCallId: string, result: unknown): Promise<void>;
  drainPendingEvents(): unknown[];
  setConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<readonly schema.SessionConfigOption[]>;
  authenticate(methodId: string): Promise<void>;
  setMode(modeId: string): Promise<void>;
  listSessions(params?: schema.ListSessionsRequest): Promise<schema.ListSessionsResponse>;
  deleteSession(sessionId: string): Promise<void>;
  logout(): Promise<void>;
  listProviders(): Promise<schema.ListProvidersResponse>;
  setProvider(params: schema.SetProviderRequest): Promise<void>;
  disableProvider(providerId: schema.ProviderId): Promise<void>;
  requestExtension(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  notifyExtension(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<void>;
  startNes(params: schema.StartNesRequest): Promise<schema.StartNesResponse>;
  suggestNes(params: schema.SuggestNesRequest): Promise<schema.SuggestNesResponse>;
  closeNes(params: schema.CloseNesRequest): Promise<schema.CloseNesResponse | void>;
  didOpenDocument(params: schema.DidOpenDocumentNotification): Promise<void>;
  didChangeDocument(params: schema.DidChangeDocumentNotification): Promise<void>;
  didCloseDocument(params: schema.DidCloseDocumentNotification): Promise<void>;
  didSaveDocument(params: schema.DidSaveDocumentNotification): Promise<void>;
  didFocusDocument(params: schema.DidFocusDocumentNotification): Promise<void>;
  acceptNes(params: schema.AcceptNesNotification): Promise<void>;
  rejectNes(params: schema.RejectNesNotification): Promise<void>;
  isAlive(): boolean;
  dispose(): Promise<void>;
}

export interface AcpRuntime {
  start(options: SessionOptions): Promise<AcpSession>;
}
