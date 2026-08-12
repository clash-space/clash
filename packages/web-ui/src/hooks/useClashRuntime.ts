import { useCallback, useEffect, useRef, useState } from 'react';
import { visibleUserPromptText } from '@clash/shared-runtime';
import {
  appendAcpEvent,
  getAcpEventBlockKey,
  goalStateFromSessionInfoMetadata,
  mergeSessionInfoMetadata,
  parseAcpEvent,
  sessionInfoStateFromAcpEvent,
  usageStateFromAcpEvent,
  type ByoMessage,
  type AvailableCommand,
  type RuntimeGoalState,
  type RuntimeSessionUsage,
} from '@clash/web-ui/lib/acpEvents';
import type { RuntimeResumeSession } from '@clash/web-ui/lib/runtimeResume';
import { runtimeApiUrl, runtimeWebSocketUrl } from '../lib/runtimeConfig';
import {
  HARNESS_UPDATED_EVENT,
  SESSION_RESTART_COMPLETE_VISIBLE_MS,
  type SessionRestartMode,
  type SessionRestartPhase,
  type SessionRuntimeStatus,
} from '../lib/sessionRuntime';
import {
  applyRecentConfigPreferences,
  applyRecentModePreference,
  configValuesFromOptions,
  preferredRecentAgentId,
  type RunConfigValue,
} from '../lib/recentRunPreferences';

/**
 * useClashRuntime — chat through a registered local-runtime daemon.
 *
 * This hook drives the persistent-runtime path: list runtimes the user has registered →
 * pick one → POST /api/v1/runtimes/:rid/sessions → open WS to
 * /api/v1/local-sessions/:sid/_stream → relay prompts ↔ events.
 *
 * Same `ByoMessage[]` output shape so ChatbotCopilot's existing list
 * renderer works without changes.
 *
 * v1 scope:
 *   - One attached browser socket at a time. Switching sessions detaches
 *     the socket; the local ACP child stays alive until explicit shutdown.
 *   - No reconnect of the WS — drop = "disconnected", user re-selects
 *     the runtime to retry.
 */

export type RuntimeStatus = 'online' | 'offline';

export interface RuntimeAgentAuth {
  status: 'configured' | 'needs-auth' | 'unknown';
  message: string;
  command?: string;
}

export interface RuntimeProbeOptions {
  probe?: boolean | 'auth' | 'config' | 'none';
  refresh?: boolean;
}

export interface RuntimeAgent {
  id: string;
  label?: string;
  binary?: string;
  version?: string;
  config_options?: AcpSessionConfigOption[];
  available_commands?: AvailableCommand[];
  session_modes?: AcpSessionModeState;
  auth?: RuntimeAgentAuth;
}

export interface RuntimeRunPreferences {
  agent_id?: string;
  config_by_agent: Record<string, Record<string, RunConfigValue>>;
  mode_by_agent: Record<string, string>;
}

export interface Runtime {
  id: string;
  machine_id: string;
  hostname: string;
  os: string;
  agents: RuntimeAgent[];
  preferences?: RuntimeRunPreferences;
  version: string;
  status: RuntimeStatus;
  last_heartbeat: number | null;
  created_at: number;
}

export type ClashRuntimeStatus =
  | 'idle'              // no runtime selected
  | 'draft'             // runtime/agent chosen, no ACP session created yet
  | 'connecting'        // POST /sessions in flight or waiting for session.ready
  | 'connected'         // session.ready received
  | 'sending'           // user prompt in flight
  | 'streaming'         // events arriving
  | 'disconnected'      // WS dropped or daemon went offline
  | 'error';

export interface RuntimeTransientStatus {
  kind: 'reconnecting' | 'transport_fallback';
  message: string;
  detail?: string;
  attempt?: number;
  maxAttempts?: number;
}

export interface RuntimeDiagnostic {
  stream: 'stderr';
  severity: 'debug' | 'info' | 'warning' | 'error';
  raw: string;
  message: string;
  transientStatus?: {
    status: RuntimeTransientStatus['kind'];
    message: string;
    detail?: string;
    attempt?: number;
    maxAttempts?: number;
  };
}

export type RuntimePromptQueueMode = 'single' | 'flush';

export interface RuntimeQueuedPrompt {
  id: string;
  turnId: string;
  text: string;
  createdAt: number;
}

interface RuntimeQueueUpdateQueuedPrompt {
  turn_id?: unknown;
  text?: unknown;
  created_at?: unknown;
}

export interface ClashRuntimeSelectOptions {
  projectId?: string;
  resumeAcpSessionId?: string;
  freshSession?: boolean;
  agentId?: string;
  permissionModeId?: string;
}

export interface RuntimeSessionInfo {
  id: string;
  threadId: string;
  title?: string;
  type: 'runtime';
  projectId?: string;
  runtimeId: string;
  agentId?: string | null;
  agentMemberId?: string;
  permissionMode?: string;
  acpSessionId?: string;
  status?: string;
  updatedAt?: string;
}

export interface AcpSessionConfigSelectValue {
  value: string;
  name: string;
  description?: string | null;
}

export interface AcpSessionConfigSelectGroup {
  group: string;
  name: string;
  options: AcpSessionConfigSelectValue[];
}

export interface AcpSessionConfigOption {
  id: string;
  name: string;
  type: string;
  category?: string | null;
  description?: string | null;
  currentValue?: string | boolean;
  options?: Array<AcpSessionConfigSelectValue | AcpSessionConfigSelectGroup>;
}

export interface AcpSessionMode {
  id: string;
  name: string;
  description?: string | null;
}

export interface AcpSessionModeState {
  currentModeId: string;
  availableModes: AcpSessionMode[];
}

export interface RuntimePermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface RuntimePermissionRequest {
  requestId: string;
  sessionId: string;
  toolCall: Record<string, unknown>;
  options: RuntimePermissionOption[];
}

export type RuntimeStartupStatus = 'loading' | 'ready' | 'error';

export interface UseClashRuntimeReturn {
  /** All runtimes the user has registered (any status). */
  runtimes: Runtime[];
  /** Cold-start capability snapshot lifecycle. UI must not expose agent controls while loading. */
  startupStatus: RuntimeStartupStatus;
  /** id of the runtime the user picked, or null = none / cloud. */
  selectedRuntimeId: string | null;
  /** ACP agent id selected for the current local-runtime session. */
  selectedAgentId: string | null;
  /** id of the currently-open session (one at a time in v1). */
  sessionId: string | null;
  /** Current local-runtime task/session, if one is attached. */
  currentSession: RuntimeSessionInfo | null;
  status: ClashRuntimeStatus;
  errorMessage: string | null;
  transientStatus: RuntimeTransientStatus | null;
  diagnostics: RuntimeDiagnostic[];
  messages: ByoMessage[];
  /** Slash commands the agent currently advertises (replaced per
   *  available_commands_update event). UI uses this for the `/` picker. */
  availableCommands: AvailableCommand[];
  /** User prompts waiting for a safe point before being sent through ACP prompt. */
  promptQueue: RuntimeQueuedPrompt[];
  /** Whether follow-up prompts are product-queued while the current agent turn is running. */
  promptQueueEnabled: boolean;
  /** `single` drains one queued prompt per agent loop; `flush` drains all after the current loop. */
  promptQueueMode: RuntimePromptQueueMode;
  /** ACP-native session config options reported by the current agent. */
  sessionConfigOptions: AcpSessionConfigOption[];
  /** ACP-native session modes reported by the current agent. */
  sessionModes: AcpSessionModeState | null;
  /** Lossless, namespaced metadata announced through ACP session_info_update. */
  sessionInfoMeta: Record<string, unknown> | null;
  /** Harness-owned long-running Goal snapshot announced through session_info_update. */
  goal: RuntimeGoalState | null;
  /** Latest standard ACP context-window usage snapshot, kept outside the transcript. */
  sessionUsage: RuntimeSessionUsage | null;
  /** Blocking ACP permission requests, kept outside the transcript. */
  permissionRequests: RuntimePermissionRequest[];
  /** Version state of the ACP child currently holding this session. */
  sessionRuntimeStatus: SessionRuntimeStatus | null;
  /** Restart lifecycle shown in the session-scoped update notice. */
  sessionRestartPhase: SessionRestartPhase;
  /** True iff status === connected/sending/streaming. */
  ready: boolean;
  /** Re-fetch the runtime list. Cheap; safe to call from a settings page. */
  refresh: (opts?: RuntimeProbeOptions) => Promise<void>;
  /** Pick a runtime + optional legacy agent context + project/resume target.
   *  Current Copilot starts from the selected ACP agent; agentMemberId is only
   *  kept for legacy group-chat/session resume paths. */
  select: (runtimeId: string | null, agentMemberId?: string, opts?: ClashRuntimeSelectOptions) => Promise<void>;
  /** Prepare a blank local-runtime draft. The ACP session is created on first prompt. */
  startDraft: (runtimeId: string | null, agentMemberId?: string, opts?: ClashRuntimeSelectOptions) => void;
  /** Start the selected ACP draft without sending a user prompt (for capability-driven UI such as slash commands). */
  prepareSession?: () => void;
  /** Attach to an already-created local runtime session without creating or disposing it. */
  attachSession: (session: RuntimeSessionInfo) => Promise<void>;
  /** RPC the daemon for resumeable local CC sessions. Returns [] if the
   *  runtime is offline or the daemon doesn't respond. Used by the
   *  picker dialog so the user can pick "Resume X" instead of fresh. */
  loadResumeOptions: (runtimeId: string) => Promise<RuntimeResumeSession[]>;
  sendMessage: (text: string) => void;
  setPromptQueueEnabled: (enabled: boolean) => void;
  setPromptQueueMode: (mode: RuntimePromptQueueMode) => void;
  steerQueuedPrompt: (turnId: string) => void;
  updateQueuedPrompt: (turnId: string, text: string) => void;
  removeQueuedPrompt: (turnId: string) => void;
  reorderPromptQueue: (turnIds: string[]) => void;
  clearPromptQueue: () => void;
  setConfigOption: (configId: string, value: string | boolean) => void;
  setSessionMode: (modeId: string) => void;
  respondPermission: (requestId: string, optionId: string | null) => void;
  restartSession: (mode: SessionRestartMode) => Promise<void>;
  cancel: () => void;
  shutdown: () => void;
}

const RUNTIMES_PATH = '/api/v1/runtimes';
const SESSIONS_BASE = '/api/v1/local-sessions';
const PROMPT_QUEUE_ENABLED_STORAGE_KEY = 'clash.runtimePromptQueue.enabled';
const PROMPT_QUEUE_ENABLED_EVENT = 'clash-runtime-prompt-queue-enabled';

function readPromptQueueEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(PROMPT_QUEUE_ENABLED_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function runtimeTitleFromPrompt(text: string): string | null {
  const trimmed = visibleUserPromptText(text);
  if (!trimmed) return null;
  return trimmed.length > 52 ? `${trimmed.slice(0, 52)}...` : trimmed;
}

function shouldReplaceRuntimeSessionTitle(title: string | undefined): boolean {
  const trimmed = title?.trim();
  return !trimmed || trimmed === 'New session';
}

function isAuthSetupMessage(message: string): boolean {
  return /\b(auth|authenticate|authentication|login|sign in)\b/i.test(message);
}

async function readRuntimeErrorMessage(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const fallback = res.clone();
    try {
      const json = await res.json() as { error?: unknown; message?: unknown };
      if (typeof json.error === 'string' && json.error.trim()) return json.error;
      if (typeof json.message === 'string' && json.message.trim()) return json.message;
    } catch {
      return fallback.text();
    }
  }
  return res.text();
}

interface CreateSessionResponse {
  session_id: string;
}

async function fetchRuntimeSessionMessages(sessionId: string): Promise<ByoMessage[] | null> {
  let res: Response;
  try {
    res = await fetch(runtimeApiUrl(`${SESSIONS_BASE}/${encodeURIComponent(sessionId)}/messages`), {
      credentials: 'include',
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let json: {
    messages?: Array<{
      id: string;
      sender_kind: 'user' | 'agent';
      sender_id: string;
      turn_id: string | null;
      events: unknown[];
      created_at: number;
    }>;
  };
  try {
    json = await res.json();
  } catch {
    return null;
  }
  const bubbles: ByoMessage[] = [];
  for (const row of json.messages ?? []) {
    if (row.sender_kind === 'user') {
      const parts = (row.events ?? [])
        .map((part) => part as { type?: string; text?: string })
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => ({ type: 'text' as const, text: part.text! }));
      bubbles.push({
        id: row.turn_id ? `user-${row.turn_id}` : row.id,
        role: 'user',
        parts,
      });
      continue;
    }

    const turnId = row.turn_id ?? row.id;
    let knownIdx: number | undefined;
    for (const event of row.events ?? []) {
      const result = appendAcpEvent(bubbles, turnId, knownIdx, event);
      if (knownIdx === undefined && result.idx >= 0) knownIdx = result.idx;
    }
  }
  return bubbles;
}

function runtimeTranscriptCompleteness(messages: ByoMessage[]) {
  let userParts = 0;
  let userTextLength = 0;
  let assistantParts = 0;
  let assistantTextLength = 0;

  for (const message of messages) {
    for (const part of message.parts) {
      const textLength = part.type === 'text' || part.type === 'thought'
        ? part.text.length
        : part.type === 'event_note'
          ? part.title.length + (part.detail?.length ?? 0)
          : 0;
      if (message.role === 'user') {
        userParts += 1;
        userTextLength += textLength;
      } else {
        assistantParts += 1;
        assistantTextLength += textLength;
      }
    }
  }

  return { userParts, userTextLength, assistantParts, assistantTextLength };
}

function persistedTranscriptCanReplaceLive(history: ByoMessage[], live: ByoMessage[]): boolean {
  if (live.length === 0) return true;
  const persistedAssistantMessages = history.filter((message) => message.role === 'assistant').length;
  const liveAssistantMessages = live.filter((message) => message.role === 'assistant').length;
  if (persistedAssistantMessages < liveAssistantMessages) return false;
  const persisted = runtimeTranscriptCompleteness(history);
  const streamed = runtimeTranscriptCompleteness(live);
  return persisted.userParts >= streamed.userParts
    && persisted.userTextLength >= streamed.userTextLength
    && persisted.assistantParts >= streamed.assistantParts
    && persisted.assistantTextLength >= streamed.assistantTextLength;
}

function appendRuntimeError(messages: ByoMessage[], turnId: string | undefined, message: string): ByoMessage[] {
  const id = turnId ? `runtime-error-${turnId}` : `runtime-error-${Date.now().toString(36)}`;
  if (messages.some((candidate) => candidate.id === id)) return messages;
  return [
    ...messages,
    {
      id,
      role: 'assistant',
      parts: [{ type: 'event_note', title: message, tone: 'error' }],
    },
  ];
}

function normalizeSessionConfigOptions(value: unknown): AcpSessionConfigOption[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((option): option is Record<string, unknown> => !!option && typeof option === 'object')
    .filter((option) => typeof option.id === 'string' && typeof option.name === 'string' && typeof option.type === 'string')
    .map((option) => ({
      id: String(option.id),
      name: String(option.name),
      type: String(option.type),
      ...(typeof option.category === 'string' || option.category === null ? { category: option.category } : {}),
      ...(typeof option.description === 'string' || option.description === null ? { description: option.description } : {}),
      ...(typeof option.currentValue === 'string' || typeof option.currentValue === 'boolean'
        ? { currentValue: option.currentValue }
        : typeof option.current_value === 'string' || typeof option.current_value === 'boolean'
          ? { currentValue: option.current_value }
          : {}),
      ...(Array.isArray(option.options) ? { options: option.options as AcpSessionConfigOption['options'] } : {}),
    }));
}

function normalizeSessionModes(value: unknown): AcpSessionModeState | null {
  if (!value || typeof value !== 'object') return null;
  const modes = value as Record<string, unknown>;
  if (typeof modes.currentModeId !== 'string' || !Array.isArray(modes.availableModes)) return null;
  const availableModes = modes.availableModes
    .filter((mode): mode is Record<string, unknown> => !!mode && typeof mode === 'object')
    .filter((mode) => typeof mode.id === 'string' && typeof mode.name === 'string')
    .map((mode) => ({
      id: String(mode.id),
      name: String(mode.name),
      ...(typeof mode.description === 'string' || mode.description === null ? { description: mode.description } : {}),
    }));
  return {
    currentModeId: modes.currentModeId,
    availableModes,
  };
}

function normalizeAvailableCommands(value: unknown): AvailableCommand[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((command): command is Record<string, unknown> => (
      !!command &&
      typeof command === 'object' &&
      typeof (command as Record<string, unknown>).name === 'string'
    ))
    .map((command) => ({
      name: String(command.name),
      ...(typeof command.description === 'string' ? { description: command.description } : {}),
      ...(command.input && typeof command.input === 'object'
        ? { input: command.input as AvailableCommand['input'] }
        : {}),
      ...(typeof command.kind === 'string' ? { kind: command.kind } : {}),
      ...(typeof command.type === 'string' ? { type: command.type } : {}),
      ...(typeof command.category === 'string' ? { category: command.category } : {}),
      ...(typeof command.source === 'string' ? { source: command.source } : {}),
      ...(command._meta && typeof command._meta === 'object' && !Array.isArray(command._meta)
        ? { _meta: command._meta as Record<string, unknown> }
        : {}),
      ...(command.metadata && typeof command.metadata === 'object'
        ? { metadata: command.metadata as Record<string, unknown> }
        : {}),
    }));
}

function normalizeRuntimeAgent(value: unknown): RuntimeAgent | null {
  if (!value || typeof value !== 'object') return null;
  const agent = value as Record<string, unknown>;
  if (typeof agent.id !== 'string') return null;
  const configOptions = normalizeSessionConfigOptions(agent.config_options ?? agent.configOptions);
  const availableCommands = normalizeAvailableCommands(
    agent.available_commands ?? agent.availableCommands,
  );
  const sessionModes = normalizeSessionModes(agent.session_modes ?? agent.sessionModes);
  const rawAuth = agent.auth && typeof agent.auth === 'object' ? agent.auth as Record<string, unknown> : null;
  const auth = rawAuth && (
    rawAuth.status === 'configured' ||
    rawAuth.status === 'needs-auth' ||
    rawAuth.status === 'unknown'
  ) && typeof rawAuth.message === 'string'
    ? {
        status: rawAuth.status,
        message: rawAuth.message,
        ...(typeof rawAuth.command === 'string' ? { command: rawAuth.command } : {}),
      } satisfies RuntimeAgentAuth
    : null;
  return {
    id: agent.id,
    ...(typeof agent.label === 'string' ? { label: agent.label } : {}),
    ...(typeof agent.binary === 'string' ? { binary: agent.binary } : {}),
    ...(typeof agent.version === 'string' ? { version: agent.version } : {}),
    ...(configOptions && configOptions.length > 0 ? { config_options: configOptions } : {}),
    ...(availableCommands ? { available_commands: availableCommands } : {}),
    ...(sessionModes ? { session_modes: sessionModes } : {}),
    ...(auth ? { auth } : {}),
  };
}

function normalizeRunPreferences(value: unknown): RuntimeRunPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const configByAgent: RuntimeRunPreferences['config_by_agent'] = {};
  if (
    raw.config_by_agent
    && typeof raw.config_by_agent === 'object'
    && !Array.isArray(raw.config_by_agent)
  ) {
    for (const [agentId, candidate] of Object.entries(raw.config_by_agent)) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      configByAgent[agentId] = Object.fromEntries(
        Object.entries(candidate).filter(
          (entry): entry is [string, RunConfigValue] => (
            typeof entry[1] === 'string' || typeof entry[1] === 'boolean'
          ),
        ),
      );
    }
  }
  const modeByAgent =
    raw.mode_by_agent
    && typeof raw.mode_by_agent === 'object'
    && !Array.isArray(raw.mode_by_agent)
      ? Object.fromEntries(
          Object.entries(raw.mode_by_agent).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};
  return {
    ...(typeof raw.agent_id === 'string' && raw.agent_id.trim()
      ? { agent_id: raw.agent_id.trim() }
      : {}),
    config_by_agent: configByAgent,
    mode_by_agent: modeByAgent,
  };
}

function normalizeRuntime(value: unknown): Runtime | null {
  if (!value || typeof value !== 'object') return null;
  const runtime = value as Record<string, unknown>;
  if (
    typeof runtime.id !== 'string' ||
    typeof runtime.machine_id !== 'string' ||
    typeof runtime.hostname !== 'string' ||
    typeof runtime.os !== 'string' ||
    typeof runtime.version !== 'string' ||
    (runtime.status !== 'online' && runtime.status !== 'offline') ||
    typeof runtime.created_at !== 'number'
  ) {
    return null;
  }
  const agents = Array.isArray(runtime.agents)
    ? runtime.agents.map(normalizeRuntimeAgent).filter((agent): agent is RuntimeAgent => agent !== null)
    : [];
  const preferences = normalizeRunPreferences(runtime.preferences);
  return {
    id: runtime.id,
    machine_id: runtime.machine_id,
    hostname: runtime.hostname,
    os: runtime.os,
    agents,
    ...(preferences ? { preferences } : {}),
    version: runtime.version,
    status: runtime.status,
    last_heartbeat: typeof runtime.last_heartbeat === 'number' ? runtime.last_heartbeat : null,
    created_at: runtime.created_at,
  };
}

function resolveRuntimeAgent(runtime: Runtime | undefined, agentId?: string | null): RuntimeAgent | null {
  if (!runtime) return null;
  if (agentId) {
    const match = runtime.agents.find((agent) => agent.id === agentId);
    if (match) return match;
  }
  const preferredId = preferredRecentAgentId(
    runtime.agents,
    runtime.preferences?.agent_id,
  );
  return runtime.agents.find((agent) => agent.id === preferredId) ?? null;
}

function seedConfigOptionsForAgent(runtime: Runtime | undefined, agentId?: string | null): AcpSessionConfigOption[] {
  const agent = resolveRuntimeAgent(runtime, agentId);
  if (!agent) return [];
  return applyRecentConfigPreferences(
    agent.config_options,
    runtime?.preferences?.config_by_agent[agent.id],
  );
}

function seedAvailableCommandsForAgent(
  runtime: Runtime | undefined,
  agentId?: string | null,
): AvailableCommand[] {
  return resolveRuntimeAgent(runtime, agentId)?.available_commands ?? [];
}

function seedSessionModesForAgent(runtime: Runtime | undefined, agentId?: string | null): AcpSessionModeState | null {
  const agent = resolveRuntimeAgent(runtime, agentId);
  if (!agent) return null;
  return applyRecentModePreference(
    agent.session_modes,
    runtime?.preferences?.mode_by_agent[agent.id],
  );
}

function configOptionsFromAcpEvent(event: unknown): AcpSessionConfigOption[] | null {
  const update = (event as { update?: unknown } | null | undefined)?.update ?? event;
  if ((update as { sessionUpdate?: unknown } | null | undefined)?.sessionUpdate !== 'config_option_update') return null;
  return normalizeSessionConfigOptions((update as { configOptions?: unknown } | null | undefined)?.configOptions);
}

function modeIdFromAcpEvent(event: unknown): string | null {
  const update = (event as { update?: unknown } | null | undefined)?.update ?? event;
  if ((update as { sessionUpdate?: unknown } | null | undefined)?.sessionUpdate !== 'current_mode_update') return null;
  const modeId = (update as { currentModeId?: unknown } | null | undefined)?.currentModeId;
  return typeof modeId === 'string' && modeId.length > 0 ? modeId : null;
}

function normalizePromptQueue(value: unknown): RuntimeQueuedPrompt[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((prompt): prompt is RuntimeQueueUpdateQueuedPrompt => !!prompt && typeof prompt === 'object')
    .filter((prompt) => (
      typeof prompt.turn_id === 'string' &&
      typeof prompt.text === 'string'
    ))
    .map((prompt) => ({
      id: `queued-${prompt.turn_id}`,
      turnId: prompt.turn_id as string,
      text: prompt.text as string,
      createdAt: typeof prompt.created_at === 'number' ? prompt.created_at : Date.now(),
    }));
}

export function useClashRuntime(): UseClashRuntimeReturn {
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [startupStatus, setStartupStatus] = useState<RuntimeStartupStatus>('loading');
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<RuntimeSessionInfo | null>(null);
  const [status, setStatus] = useState<ClashRuntimeStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transientStatus, setTransientStatus] = useState<RuntimeTransientStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostic[]>([]);
  const [messages, setMessages] = useState<ByoMessage[]>([]);
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([]);
  const [promptQueue, setPromptQueue] = useState<RuntimeQueuedPrompt[]>([]);
  const [promptQueueEnabled, setPromptQueueEnabledState] = useState(readPromptQueueEnabled);
  const [promptQueueMode, setPromptQueueModeState] = useState<RuntimePromptQueueMode>('single');
  const [sessionConfigOptions, setSessionConfigOptions] = useState<AcpSessionConfigOption[]>([]);
  const [sessionModes, setSessionModes] = useState<AcpSessionModeState | null>(null);
  const [sessionInfoMeta, setSessionInfoMeta] = useState<Record<string, unknown> | null>(null);
  const [goal, setGoal] = useState<RuntimeGoalState | null>(null);
  const [sessionUsage, setSessionUsage] = useState<RuntimeSessionUsage | null>(null);
  const [permissionRequests, setPermissionRequests] = useState<RuntimePermissionRequest[]>([]);
  const [sessionRuntimeStatus, setSessionRuntimeStatus] = useState<SessionRuntimeStatus | null>(null);
  const [sessionRestartPhase, setSessionRestartPhase] = useState<SessionRestartPhase>('idle');

  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const statusRef = useRef<ClashRuntimeStatus>('idle');
  const acpSessionIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ByoMessage[]>([]);
  const promptQueueRef = useRef<RuntimeQueuedPrompt[]>([]);
  const queuedPromptLookupRef = useRef(new Map<string, RuntimeQueuedPrompt>());
  const promptQueueEnabledRef = useRef(readPromptQueueEnabled());
  const promptQueueModeRef = useRef<RuntimePromptQueueMode>('single');
  const sessionInfoMetaRef = useRef<Record<string, unknown> | null>(null);
  const draftRef = useRef<{ runtimeId: string; agentMemberId?: string; opts?: ClashRuntimeSelectOptions } | null>(null);
  const pendingPromptRef = useRef<{ turnId: string; text: string } | null>(null);
  const pendingTitleRef = useRef<string | null>(null);
  const pendingConfigOptionsRef = useRef(new Map<string, string | boolean>());
  const pendingSessionModeRef = useRef<string | null>(null);
  const runtimeSnapshotErrorRef = useRef<string | null>(null);
  const resendQueuedAfterRestartRef = useRef(false);
  const turnSeq = useRef(0);
  const queuedPromptSeq = useRef(0);
  const turnToMsgIdx = useRef(new Map<string, number>());
  const toolCallToMsgIdx = useRef(new Map<string, number>());
  const turnAssistantSegment = useRef(new Map<string, number>());
  const activeTurnIds = useRef(new Set<string>());
  /** Monotonic selection token. Backchat keys lifecycle state by session;
   * this single-session surface uses the same rule by rejecting async work
   * started for an older selection. */
  const sessionOperationSeq = useRef(0);
  const restartSessionRef = useRef<((mode: SessionRestartMode) => Promise<void>) | null>(null);
  const restartCompletionTimerRef = useRef<number | null>(null);

  const ready = status === 'connected' || status === 'sending' || status === 'streaming';

  const setRuntimeSessionId = useCallback((next: string | null) => {
    sessionIdRef.current = next;
    setSessionId(next);
  }, []);

  const hydrateMessagesFromStore = useCallback(async (targetSessionId: string) => {
    const history = await fetchRuntimeSessionMessages(targetSessionId);
    if (!history || sessionIdRef.current !== targetSessionId || history.length === 0) return;
    if (!persistedTranscriptCanReplaceLive(history, messagesRef.current)) return;
    messagesRef.current = history;
    setMessages(history);
  }, []);

  const setRuntimeStatus = useCallback((next: ClashRuntimeStatus | ((prev: ClashRuntimeStatus) => ClashRuntimeStatus)) => {
    const resolved = typeof next === 'function' ? next(statusRef.current) : next;
    statusRef.current = resolved;
    setStatus(resolved);
  }, []);

  const refresh = useCallback(async (opts: RuntimeProbeOptions = {}) => {
    try {
      const query = new URLSearchParams();
      if (opts.probe === true) query.set('probe', '1');
      else if (opts.probe && opts.probe !== 'none') query.set('probe', opts.probe);
      if (opts.refresh) query.set('refresh', '1');
      const path = query.toString() ? `${RUNTIMES_PATH}?${query.toString()}` : RUNTIMES_PATH;
      const res = await fetch(runtimeApiUrl(path), { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`Runtime snapshot request failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as { runtimes?: unknown[] };
      const next = Array.isArray(json.runtimes)
        ? json.runtimes.map(normalizeRuntime).filter((runtime): runtime is Runtime => runtime !== null)
        : [];
      setRuntimes(next);
      const draft = draftRef.current;
      if (statusRef.current === 'draft' && draft) {
        const runtime = next.find((candidate) => candidate.id === draft.runtimeId);
        const agentId = draft.opts?.agentId;
        const configOptions = seedConfigOptionsForAgent(runtime, agentId).map((option) => {
          const pendingValue = pendingConfigOptionsRef.current.get(option.id);
          return typeof pendingValue === 'string' || typeof pendingValue === 'boolean'
            ? { ...option, currentValue: pendingValue }
            : option;
        });
        setSessionConfigOptions(configOptions);
        setAvailableCommands(seedAvailableCommandsForAgent(runtime, agentId));
        setSessionModes(seedSessionModesForAgent(runtime, agentId));
      }
      const priorSnapshotError = runtimeSnapshotErrorRef.current;
      runtimeSnapshotErrorRef.current = null;
      if (priorSnapshotError) {
        setErrorMessage((current) => current === priorSnapshotError ? null : current);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtimeSnapshotErrorRef.current = message;
      setErrorMessage(message);
      throw error;
    }
  }, []);

  const refreshSessionRuntimeStatus = useCallback(async (targetSessionId: string) => {
    try {
      const response = await fetch(runtimeApiUrl(
        `${SESSIONS_BASE}/${encodeURIComponent(targetSessionId)}/runtime-status`,
      ), { credentials: 'include' });
      if (!response.ok || sessionIdRef.current !== targetSessionId) return;
      setSessionRuntimeStatus(await response.json() as SessionRuntimeStatus);
    } catch {
      // A status check must never disconnect an otherwise healthy ACP chat.
    }
  }, []);

  // The local host owns the cold-start capability barrier. Its ordinary
  // runtime list does not resolve until the single startup warmup settles.
  useEffect(() => {
    let cancelled = false;
    void refresh().then(
      () => {
        if (!cancelled) setStartupStatus('ready');
      },
      () => {
        if (!cancelled) setStartupStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!sessionId) {
      setSessionRuntimeStatus(null);
      setSessionRestartPhase('idle');
      return undefined;
    }
    void refreshSessionRuntimeStatus(sessionId);
    const onHarnessUpdated = (event: Event) => {
      const harnessId = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof harnessId !== 'string' || !currentSession?.agentId || harnessId === currentSession.agentId) {
        void refreshSessionRuntimeStatus(sessionId);
      }
    };
    window.addEventListener(HARNESS_UPDATED_EVENT, onHarnessUpdated);
    return () => window.removeEventListener(HARNESS_UPDATED_EVENT, onHarnessUpdated);
  }, [currentSession?.agentId, refreshSessionRuntimeStatus, sessionId]);

  // Tear down on unmount so the WS doesn't leak across page changes.
  useEffect(() => {
    return () => {
      sessionOperationSeq.current += 1;
      try { wsRef.current?.close(); } catch { /* ignore */ }
      if (restartCompletionTimerRef.current !== null) {
        window.clearTimeout(restartCompletionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const syncEnabled = (enabled: boolean) => {
      promptQueueEnabledRef.current = enabled;
      setPromptQueueEnabledState(enabled);
    };
    const onCustom = (event: Event) => {
      const enabled = (event as CustomEvent<{ enabled?: unknown }>).detail?.enabled;
      if (typeof enabled === 'boolean') syncEnabled(enabled);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROMPT_QUEUE_ENABLED_STORAGE_KEY) syncEnabled(event.newValue !== 'false');
    };
    window.addEventListener(PROMPT_QUEUE_ENABLED_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PROMPT_QUEUE_ENABLED_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const handleAcpEvent = useCallback((turnId: string, event: unknown) => {
    setMessages((prev) => {
      const messages = prev.slice();
      const toolBlockKey = getAcpEventBlockKey(event);
      const toolKey = toolBlockKey ? `${turnId}:${toolBlockKey}` : null;
      const knownToolIdx = toolKey ? toolCallToMsgIdx.current.get(toolKey) : undefined;
      const knownTurnIdx = turnToMsgIdx.current.get(turnId);
      const knownIdx = knownToolIdx ?? knownTurnIdx;
      const segment = turnAssistantSegment.current.get(turnId) ?? 0;
      const messageId = segment > 0 ? `asst-${turnId}-${segment}` : `asst-${turnId}`;
      const result = appendAcpEvent(messages, turnId, knownIdx, event, messageId);
      if (result.idx >= 0) {
        if (toolKey) toolCallToMsgIdx.current.set(toolKey, result.idx);
        if (knownToolIdx === undefined) turnToMsgIdx.current.set(turnId, result.idx);
      }
      if (result.commands) setAvailableCommands(result.commands);
      messagesRef.current = messages;
      return messages;
    });
  }, []);

  const replacePromptQueue = useCallback((next: RuntimeQueuedPrompt[]) => {
    for (const prompt of next) queuedPromptLookupRef.current.set(prompt.turnId, prompt);
    promptQueueRef.current = next;
    setPromptQueue(next);
  }, []);

  const clearPromptQueue = useCallback(() => {
    queuedPromptLookupRef.current.clear();
    replacePromptQueue([]);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'clear_prompt_queue' }));
    }
  }, [replacePromptQueue]);

  const makePrompt = useCallback((text: string): RuntimeQueuedPrompt => ({
    id: `queued-${++queuedPromptSeq.current}-${Date.now().toString(36)}`,
    turnId: `t-${++turnSeq.current}-${Date.now().toString(36)}`,
    text,
    createdAt: Date.now(),
  }), []);

  const appendUserMessage = useCallback((turnId: string, text: string) => {
    setMessages((prev) => {
      if (prev.some((message) => message.id === `user-${turnId}`)) return prev;
      const next: ByoMessage[] = [...prev, { id: `user-${turnId}`, role: 'user', parts: [{ type: 'text', text }] }];
      messagesRef.current = next;
      return next;
    });
    const nextTitle = runtimeTitleFromPrompt(text);
    if (nextTitle) {
      pendingTitleRef.current = nextTitle;
      setCurrentSession((session) => {
        if (!session || !shouldReplaceRuntimeSessionTitle(session.title)) return session;
        return { ...session, title: nextTitle };
      });
    }
  }, []);

  const sendPromptFrame = useCallback((
    prompt: Pick<RuntimeQueuedPrompt, 'turnId' | 'text'>,
    opts: {
      queueMode?: RuntimePromptQueueMode;
      markActive?: boolean;
    } = {},
  ): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (opts.markActive !== false) {
      appendUserMessage(prompt.turnId, prompt.text);
      activeTurnIds.current.add(prompt.turnId);
      setTransientStatus(null);
      setRuntimeStatus('sending');
    }
    ws.send(JSON.stringify({
      type: 'prompt',
      turn_id: prompt.turnId,
      text: prompt.text,
      ...(opts.queueMode ? { queue_mode: opts.queueMode } : {}),
    }));
    return true;
  }, [appendUserMessage, setRuntimeStatus]);

  const enqueuePrompt = useCallback((prompt: RuntimeQueuedPrompt) => {
    if (promptQueueRef.current.some((queued) => queued.turnId === prompt.turnId)) return;
    replacePromptQueue([...promptQueueRef.current, prompt]);
  }, [replacePromptQueue]);

  const sendQueuedPromptFrame = useCallback((prompt: RuntimeQueuedPrompt): boolean => {
    const sent = sendPromptFrame(prompt, {
      queueMode: promptQueueModeRef.current,
      markActive: false,
    });
    if (sent) enqueuePrompt(prompt);
    return sent;
  }, [enqueuePrompt, sendPromptFrame]);

  const setPromptQueueMode = useCallback((mode: RuntimePromptQueueMode) => {
    promptQueueModeRef.current = mode;
    setPromptQueueModeState(mode);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_prompt_queue_mode', queue_mode: mode }));
    }
  }, []);

  const setPromptQueueEnabled = useCallback((enabled: boolean) => {
    promptQueueEnabledRef.current = enabled;
    setPromptQueueEnabledState(enabled);
    try {
      window.localStorage.setItem(PROMPT_QUEUE_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      /* ignore unavailable storage */
    }
    window.dispatchEvent(new CustomEvent(PROMPT_QUEUE_ENABLED_EVENT, { detail: { enabled } }));
  }, []);

  const closeSessionSocket = useCallback((opts: { dispose?: boolean } = {}) => {
    const ws = wsRef.current;
    if (opts.dispose && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'dispose' }));
    }
    try { ws?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  const resetRuntimeState = useCallback((opts: { disposeSocket?: boolean } = {}) => {
    closeSessionSocket({ dispose: opts.disposeSocket });
    turnToMsgIdx.current.clear();
    toolCallToMsgIdx.current.clear();
    turnAssistantSegment.current.clear();
    activeTurnIds.current.clear();
    queuedPromptLookupRef.current.clear();
    pendingPromptRef.current = null;
    pendingTitleRef.current = null;
    pendingSessionModeRef.current = null;
    runtimeSnapshotErrorRef.current = null;
    messagesRef.current = [];
    setMessages([]);
    setAvailableCommands([]);
    replacePromptQueue([]);
    setSessionConfigOptions([]);
    setSessionModes(null);
    sessionInfoMetaRef.current = null;
    setSessionInfoMeta(null);
    setGoal(null);
    setSessionUsage(null);
    setPermissionRequests([]);
    setSessionRuntimeStatus(null);
    setSessionRestartPhase('idle');
    setErrorMessage(null);
    setTransientStatus(null);
    setDiagnostics([]);
  }, [closeSessionSocket, replacePromptQueue]);

  const onWsMessage = useCallback((data: unknown) => {
    let msg: {
      type: string;
      session_id?: string;
      acp_session_id?: string;
      turn_id?: string;
      event?: unknown;
      config_options?: unknown;
      modes?: unknown;
      message?: string;
      detail?: string;
      status?: string;
      attempt?: number;
      maxAttempts?: number;
      diagnostic?: RuntimeDiagnostic;
      daemon_online?: boolean;
      mode?: string;
      active_turn_id?: string | null;
      queued?: unknown;
      code?: string;
      agent_id?: string;
      auth?: unknown;
      request_id?: string;
      tool_call?: unknown;
      options?: unknown;
      option_id?: string | null;
    };
    try { msg = JSON.parse(typeof data === 'string' ? data : ''); }
    catch { return; }

    switch (msg.type) {
      case 'attached':
        // Daemon may or may not be online at this moment — we already
        // gated on `runtime.status === 'online'` before POSTing /sessions,
        // so don't re-surface here.
        return;
      case 'session.ready':
        {
          const configOptions = normalizeSessionConfigOptions(msg.config_options);
          if (configOptions) setSessionConfigOptions(configOptions);
          const modes = normalizeSessionModes(msg.modes);
          if (modes) setSessionModes(modes);
        }
        if (typeof msg.acp_session_id === 'string' && msg.acp_session_id.length > 0) {
          acpSessionIdRef.current = msg.acp_session_id;
          setCurrentSession((session) => session ? { ...session, acpSessionId: msg.acp_session_id, status: 'active' } : session);
        }
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          for (const [configId, value] of pendingConfigOptionsRef.current) {
            wsRef.current.send(JSON.stringify({ type: 'set_config_option', config_id: configId, value }));
          }
          pendingConfigOptionsRef.current.clear();
          const pendingModeId = pendingSessionModeRef.current;
          if (pendingModeId) {
            wsRef.current.send(JSON.stringify({ type: 'set_session_mode', mode_id: pendingModeId }));
            pendingSessionModeRef.current = null;
          }
          const pendingPrompt = pendingPromptRef.current;
          if (pendingPrompt) {
            pendingPromptRef.current = null;
            sendPromptFrame(pendingPrompt);
            for (const queued of promptQueueRef.current) {
              if (promptQueueEnabledRef.current) {
                sendPromptFrame(queued, {
                  queueMode: promptQueueModeRef.current,
                  markActive: false,
                });
              } else {
                sendPromptFrame(queued);
              }
            }
            if (!promptQueueEnabledRef.current) {
              queuedPromptLookupRef.current.clear();
              replacePromptQueue([]);
            }
            return;
          }
          if (resendQueuedAfterRestartRef.current) {
            resendQueuedAfterRestartRef.current = false;
            for (const queued of promptQueueRef.current) {
              sendPromptFrame(queued, {
                queueMode: promptQueueModeRef.current,
                markActive: false,
              });
            }
          }
        }
        setRuntimeStatus('connected');
        return;
      case 'session.config_options':
        {
          const configOptions = normalizeSessionConfigOptions(msg.config_options);
          if (configOptions) setSessionConfigOptions(configOptions);
        }
        return;
      case 'session.mode':
        {
          const modes = normalizeSessionModes(msg.modes);
          if (modes) setSessionModes(modes);
        }
        return;
      case 'session.permission_request':
        if (
          typeof msg.request_id === 'string' &&
          typeof msg.session_id === 'string' &&
          msg.tool_call &&
          typeof msg.tool_call === 'object' &&
          !Array.isArray(msg.tool_call) &&
          Array.isArray(msg.options)
        ) {
          const options = msg.options
            .filter((option): option is Record<string, unknown> => (
              !!option && typeof option === 'object' && !Array.isArray(option)
            ))
            .filter((option) => (
              typeof option.optionId === 'string' &&
              typeof option.name === 'string' &&
              typeof option.kind === 'string'
            ))
            .map((option) => ({
              optionId: option.optionId as string,
              name: option.name as string,
              kind: option.kind as string,
            }));
          if (options.length > 0) {
            const request: RuntimePermissionRequest = {
              requestId: msg.request_id,
              sessionId: msg.session_id,
              toolCall: msg.tool_call as Record<string, unknown>,
              options,
            };
            setPermissionRequests((current) => [
              ...current.filter((candidate) => candidate.requestId !== request.requestId),
              request,
            ]);
          }
        }
        return;
      case 'session.permission_resolved':
        if (typeof msg.request_id === 'string') {
          setPermissionRequests((current) => (
            current.filter((request) => request.requestId !== msg.request_id)
          ));
        }
        return;
      case 'session.queue_update':
        if (msg.mode === 'single' || msg.mode === 'flush') {
          promptQueueModeRef.current = msg.mode;
          setPromptQueueModeState(msg.mode);
        }
        {
          const activeQueued = typeof msg.active_turn_id === 'string' && msg.active_turn_id.length > 0
            ? promptQueueRef.current.find((queued) => queued.turnId === msg.active_turn_id)
              ?? queuedPromptLookupRef.current.get(msg.active_turn_id)
            : null;
          if (activeQueued) {
            appendUserMessage(activeQueued.turnId, activeQueued.text);
            queuedPromptLookupRef.current.delete(activeQueued.turnId);
          }
          const queue = normalizePromptQueue(msg.queued);
          if (queue) replacePromptQueue(queue);
        }
        if (typeof msg.active_turn_id === 'string' && msg.active_turn_id.length > 0) {
          activeTurnIds.current.clear();
          activeTurnIds.current.add(msg.active_turn_id);
          setRuntimeStatus('sending');
        } else {
          activeTurnIds.current.clear();
          if (!promptQueueRef.current.length) setRuntimeStatus('connected');
        }
        return;
      case 'session.status':
        if (msg.status === 'reconnecting' || msg.status === 'transport_fallback') {
          setTransientStatus({
            kind: msg.status,
            message: msg.message ?? (msg.status === 'reconnecting' ? 'Reconnecting' : 'Switching transport'),
            ...(typeof msg.detail === 'string' ? { detail: msg.detail } : {}),
            ...(typeof msg.attempt === 'number' ? { attempt: msg.attempt } : {}),
            ...(typeof msg.maxAttempts === 'number' ? { maxAttempts: msg.maxAttempts } : {}),
          });
        }
        return;
      case 'session.diagnostic':
        if (msg.diagnostic) {
          setDiagnostics((prev) => [...prev.slice(-99), msg.diagnostic as RuntimeDiagnostic]);
          const status = msg.diagnostic.transientStatus;
          if (status?.status === 'reconnecting' || status?.status === 'transport_fallback') {
            setTransientStatus({
              kind: status.status,
              message: status.message,
              ...(typeof status.detail === 'string' ? { detail: status.detail } : {}),
              ...(typeof status.attempt === 'number' ? { attempt: status.attempt } : {}),
              ...(typeof status.maxAttempts === 'number' ? { maxAttempts: status.maxAttempts } : {}),
            });
          }
        }
        return;
      case 'session.event':
        {
          const configOptions = configOptionsFromAcpEvent(msg.event);
          if (configOptions) setSessionConfigOptions(configOptions);
          const currentModeId = modeIdFromAcpEvent(msg.event);
          if (currentModeId) {
            setSessionModes((prev) => prev ? { ...prev, currentModeId } : prev);
          }
          const sessionInfoPatch = sessionInfoStateFromAcpEvent(msg.event);
          const usagePatch = usageStateFromAcpEvent(msg.event);
          if (usagePatch) setSessionUsage(usagePatch);
          if (
            sessionInfoPatch
            && (sessionInfoPatch.title !== undefined || sessionInfoPatch.updatedAt !== undefined)
          ) {
            setCurrentSession((current) => {
              if (!current) return current;
              return {
                ...current,
                ...(sessionInfoPatch.title !== undefined
                  ? { title: sessionInfoPatch.title ?? undefined }
                  : {}),
                ...(sessionInfoPatch.updatedAt !== undefined
                  ? { updatedAt: sessionInfoPatch.updatedAt ?? undefined }
                  : {}),
              };
            });
          }
          if (sessionInfoPatch?.metadata !== undefined) {
            const nextMetadata = sessionInfoPatch.metadata === null
              ? null
              : mergeSessionInfoMetadata(sessionInfoMetaRef.current, sessionInfoPatch.metadata);
            sessionInfoMetaRef.current = nextMetadata;
            setSessionInfoMeta(nextMetadata);
            setGoal(goalStateFromSessionInfoMetadata(nextMetadata));
          }
          const parsed = parseAcpEvent(msg.event);
          if (parsed.commands) setAvailableCommands(parsed.commands);
          if (!msg.turn_id) {
            return;
          }
        }
        handleAcpEvent(msg.turn_id, msg.event);
        setRuntimeStatus('streaming');
        return;
      case 'session.complete':
        if (msg.turn_id) {
          turnToMsgIdx.current.delete(msg.turn_id);
          turnAssistantSegment.current.delete(msg.turn_id);
          for (const key of toolCallToMsgIdx.current.keys()) {
            if (key.startsWith(`${msg.turn_id}:`)) toolCallToMsgIdx.current.delete(key);
          }
          activeTurnIds.current.delete(msg.turn_id);
        }
        {
          const completedSessionId = typeof msg.session_id === 'string' && msg.session_id.length > 0
            ? msg.session_id
            : sessionIdRef.current;
          if (completedSessionId) void hydrateMessagesFromStore(completedSessionId);
        }
        setTransientStatus(null);
        if (activeTurnIds.current.size === 0) {
          if (promptQueueRef.current.length > 0) setRuntimeStatus('sending');
          else setRuntimeStatus('connected');
        }
        return;
      case 'session.restart_ready':
        void restartSessionRef.current?.('now');
        return;
      case 'session.error':
        {
          const message = msg.message ?? 'unknown error';
          if (msg.turn_id) activeTurnIds.current.delete(msg.turn_id);
          setErrorMessage(message);
          if (msg.code === 'auth_required') {
            void refresh({ probe: 'config', refresh: true });
          }
          setTransientStatus(null);
          setMessages((prev) => {
            const next = appendRuntimeError(prev, msg.turn_id, message);
            messagesRef.current = next;
            return next;
          });
          setCurrentSession((session) => session ? { ...session, status: 'error' } : session);
        }
        setRuntimeStatus('error');
        return;
      case 'session.disposed':
        setTransientStatus(null);
        setRuntimeStatus('idle');
        setRuntimeSessionId(null);
        setCurrentSession(null);
        return;
      case 'daemon_offline':
        setTransientStatus(null);
        setRuntimeStatus('disconnected');
        setErrorMessage('runtime went offline');
        return;
      case 'daemon_online':
        // No state change — we'd need to re-select to start a new session.
        return;
    }
  }, [appendUserMessage, handleAcpEvent, hydrateMessagesFromStore, refresh, replacePromptQueue, sendPromptFrame]);

  const openSessionStream = useCallback((id: string, opts: { replayBacklog?: boolean } = {}) => {
    const replayQuery = opts.replayBacklog === false ? '?replay=0' : '';
    const ws = new WebSocket(runtimeWebSocketUrl(`${SESSIONS_BASE}/${encodeURIComponent(id)}/_stream${replayQuery}`));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      if (wsRef.current !== ws) return;
      onWsMessage(ev.data);
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setRuntimeStatus((s) => (s === 'idle' ? s : 'disconnected'));
    };
  }, [onWsMessage]);

  const restartSession = useCallback(async (mode: SessionRestartMode) => {
    const targetSessionId = sessionIdRef.current;
    if (!targetSessionId) return;
    setSessionRestartPhase(mode === 'after-turn' ? 'pending' : 'restarting');
    try {
      const response = await fetch(runtimeApiUrl(
        `${SESSIONS_BASE}/${encodeURIComponent(targetSessionId)}/restart`,
      ), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) throw new Error(await readRuntimeErrorMessage(response));
      const result = await response.json() as { status?: unknown };
      if (result.status === 'pending') {
        setSessionRuntimeStatus((current) => current ? {
          ...current,
          restart_pending: true,
        } : current);
        setSessionRestartPhase('pending');
        return;
      }

      closeSessionSocket();
      setRuntimeStatus('connecting');
      resendQueuedAfterRestartRef.current = promptQueueRef.current.length > 0;
      setSessionRuntimeStatus((current) => current ? {
        ...current,
        running_version: current.installed_version ?? current.running_version,
        restart_required: false,
        restart_pending: false,
        busy: false,
      } : current);
      openSessionStream(targetSessionId, { replayBacklog: false });
      setSessionRestartPhase('complete');
      if (restartCompletionTimerRef.current !== null) {
        window.clearTimeout(restartCompletionTimerRef.current);
      }
      restartCompletionTimerRef.current = window.setTimeout(() => {
        setSessionRestartPhase('idle');
        restartCompletionTimerRef.current = null;
      }, SESSION_RESTART_COMPLETE_VISIBLE_MS);
    } catch (error) {
      setSessionRestartPhase('idle');
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [closeSessionSocket, openSessionStream, setRuntimeStatus]);
  restartSessionRef.current = restartSession;

  const createRuntimeSession = useCallback(async (
    runtimeId: string | null,
    agentMemberId?: string,
    opts?: ClashRuntimeSelectOptions,
  ) => {
    const operation = ++sessionOperationSeq.current;
    setRuntimeSessionId(null);
    const runtime = runtimeId ? runtimes.find((candidate) => candidate.id === runtimeId) : undefined;
    const resolvedAgent = resolveRuntimeAgent(runtime, opts?.agentId);
    const resolvedAgentId = resolvedAgent?.id ?? opts?.agentId ?? null;
    const effectiveConfigOptions = runtimeId
      ? seedConfigOptionsForAgent(runtime, resolvedAgentId).map((option) => {
          const pendingValue = pendingConfigOptionsRef.current.get(option.id);
          return typeof pendingValue === 'string' || typeof pendingValue === 'boolean'
            ? { ...option, currentValue: pendingValue }
            : option;
        })
      : [];
    const effectiveModes = runtimeId
      ? seedSessionModesForAgent(runtime, resolvedAgentId)
      : null;
    const resolvedModeId =
      opts?.permissionModeId
      ?? pendingSessionModeRef.current
      ?? effectiveModes?.currentModeId;
    const resolvedOpts: ClashRuntimeSelectOptions | undefined = resolvedAgentId
      ? {
          ...(opts ?? {}),
          agentId: resolvedAgentId,
          ...(resolvedModeId ? { permissionModeId: resolvedModeId } : {}),
        }
      : opts;
    setSelectedRuntimeId(runtimeId);
    setSelectedAgentId(runtimeId ? resolvedAgentId : null);
    setSessionConfigOptions(effectiveConfigOptions);
    setAvailableCommands(runtimeId ? seedAvailableCommandsForAgent(runtime, resolvedAgentId) : []);
    setSessionModes(effectiveModes);
    if (!runtimeId) {
      acpSessionIdRef.current = null;
      setCurrentSession(null);
      setRuntimeStatus('idle');
      return;
    }

    for (const option of effectiveConfigOptions) {
      if (
        typeof option.currentValue === 'string'
        || typeof option.currentValue === 'boolean'
      ) {
        pendingConfigOptionsRef.current.set(option.id, option.currentValue);
      }
    }
    setRuntimeStatus('connecting');
    try {
      const sessionContextId = agentMemberId?.trim() || undefined;
      const resumeAcpSessionId = resolvedOpts?.freshSession ? undefined : resolvedOpts?.resumeAcpSessionId;
      acpSessionIdRef.current = resumeAcpSessionId ?? null;
      const res = await fetch(runtimeApiUrl(`${RUNTIMES_PATH}/${runtimeId}/sessions`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(sessionContextId ? { agent_member_id: sessionContextId } : {}),
          ...(resolvedOpts?.agentId ? { agent_id: resolvedOpts.agentId } : {}),
          ...(effectiveConfigOptions.length > 0
            ? { config_values: configValuesFromOptions(effectiveConfigOptions) }
            : {}),
          ...(resolvedOpts?.permissionModeId ? { permission_mode: resolvedOpts.permissionModeId } : {}),
          ...(resolvedOpts?.projectId ? { project_id: resolvedOpts.projectId } : {}),
          ...(resumeAcpSessionId ? { resume_session_id: resumeAcpSessionId } : {}),
        }),
      });
      if (sessionOperationSeq.current !== operation) return;
      if (!res.ok) {
        const message = await readRuntimeErrorMessage(res);
        if (isAuthSetupMessage(message)) {
          void refresh({ probe: 'config', refresh: true });
        }
        setErrorMessage(`session create failed: ${message.slice(0, 200)}`);
        setRuntimeStatus('error');
        return;
      }
      const json = (await res.json()) as CreateSessionResponse;
      if (sessionOperationSeq.current !== operation) return;
      setRuntimeSessionId(json.session_id);
      setCurrentSession({
        id: json.session_id,
        threadId: json.session_id,
        type: 'runtime',
        title: pendingTitleRef.current ?? 'New session',
        ...(resolvedOpts?.projectId ? { projectId: resolvedOpts.projectId } : {}),
        runtimeId,
        agentId: resolvedAgentId,
        ...(sessionContextId ? { agentMemberId: sessionContextId } : {}),
        ...(resolvedOpts?.permissionModeId ? { permissionMode: resolvedOpts.permissionModeId } : {}),
        ...(resumeAcpSessionId ? { acpSessionId: resumeAcpSessionId } : {}),
        status: 'active',
      });

      openSessionStream(json.session_id);
    } catch (e) {
      if (sessionOperationSeq.current !== operation) return;
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setRuntimeStatus('error');
    }
  }, [openSessionStream, runtimes]);

  const select = useCallback(async (
    runtimeId: string | null,
    agentMemberId?: string,
    opts?: ClashRuntimeSelectOptions,
  ) => {
    resetRuntimeState();
    draftRef.current = null;
    pendingConfigOptionsRef.current.clear();
    await createRuntimeSession(runtimeId, agentMemberId, opts);
  }, [createRuntimeSession, resetRuntimeState]);

  const startDraft = useCallback((
    runtimeId: string | null,
    agentMemberId?: string,
    opts?: ClashRuntimeSelectOptions,
  ) => {
    sessionOperationSeq.current += 1;
    resetRuntimeState();
    acpSessionIdRef.current = null;
    pendingConfigOptionsRef.current.clear();
    setRuntimeSessionId(null);
    setCurrentSession(null);
    const runtime = runtimeId ? runtimes.find((candidate) => candidate.id === runtimeId) : undefined;
    const resolvedAgent = resolveRuntimeAgent(runtime, opts?.agentId);
    const resolvedAgentId = resolvedAgent?.id ?? opts?.agentId ?? null;
    const effectiveConfigOptions = runtimeId
      ? seedConfigOptionsForAgent(runtime, resolvedAgentId)
      : [];
    const effectiveModes = runtimeId
      ? seedSessionModesForAgent(runtime, resolvedAgentId)
      : null;
    const resolvedModeId = opts?.permissionModeId ?? effectiveModes?.currentModeId;
    const resolvedOpts: ClashRuntimeSelectOptions | undefined = resolvedAgentId
      ? {
          ...(opts ?? {}),
          agentId: resolvedAgentId,
          ...(resolvedModeId ? { permissionModeId: resolvedModeId } : {}),
        }
      : opts;
    setSelectedRuntimeId(runtimeId);
    setSelectedAgentId(runtimeId ? resolvedAgentId : null);
    setSessionConfigOptions(effectiveConfigOptions);
    setAvailableCommands(runtimeId ? seedAvailableCommandsForAgent(runtime, resolvedAgentId) : []);
    setSessionModes(effectiveModes);
    if (!runtimeId) {
      draftRef.current = null;
      setRuntimeStatus('idle');
      return;
    }
    draftRef.current = { runtimeId, ...(agentMemberId ? { agentMemberId } : {}), opts: resolvedOpts };
    setRuntimeStatus('draft');
  }, [resetRuntimeState, runtimes]);

  const attachSession = useCallback(async (session: RuntimeSessionInfo) => {
    const operation = ++sessionOperationSeq.current;
    resetRuntimeState();
    const runtime = runtimes.find((candidate) => candidate.id === session.runtimeId);
    setSelectedRuntimeId(session.runtimeId);
    setSelectedAgentId(session.agentId ?? null);
    setSessionConfigOptions(seedConfigOptionsForAgent(runtime, session.agentId));
    setAvailableCommands(seedAvailableCommandsForAgent(runtime, session.agentId));
    setSessionModes(seedSessionModesForAgent(runtime, session.agentId));
    setRuntimeSessionId(session.id);
    setCurrentSession(session);
    acpSessionIdRef.current = session.acpSessionId ?? null;
    setRuntimeStatus('connecting');

    const history = await fetchRuntimeSessionMessages(session.id);
    if (sessionOperationSeq.current !== operation) return;
    const historyLoaded = history !== null;
    if (historyLoaded) {
      messagesRef.current = history;
      setMessages(history);
      setRuntimeStatus('connected');
    }

    const attach = await fetch(runtimeApiUrl(`/api/v1/local-sessions/${encodeURIComponent(session.id)}/_attach`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (sessionOperationSeq.current !== operation) return;
    if (!attach.ok) {
      const message = await readRuntimeErrorMessage(attach);
      setErrorMessage(`session attach failed: ${message.slice(0, 200)}`);
      setRuntimeStatus('error');
      return;
    }
    if (historyLoaded) {
      setRuntimeStatus('connected');
    }

    openSessionStream(session.id, { replayBacklog: !historyLoaded });
  }, [openSessionStream, resetRuntimeState, runtimes]);

  const sendMessage = useCallback((text: string) => {
    const prompt = makePrompt(text);

    const ws = wsRef.current;
    if ((!ws || ws.readyState !== WebSocket.OPEN) && draftRef.current) {
      if (pendingPromptRef.current) {
        appendUserMessage(prompt.turnId, prompt.text);
        enqueuePrompt(prompt);
        return;
      }
      pendingPromptRef.current = { turnId: prompt.turnId, text: prompt.text };
      appendUserMessage(prompt.turnId, prompt.text);
      setTransientStatus(null);
      setRuntimeStatus('connecting');
      const draft = draftRef.current;
      void createRuntimeSession(draft.runtimeId, draft.agentMemberId, draft.opts);
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorMessage('not connected');
      setRuntimeStatus('error');
      return;
    }

    const currentStatus = statusRef.current;
    if (currentStatus === 'connecting') {
      if (!pendingPromptRef.current && activeTurnIds.current.size === 0) {
        pendingPromptRef.current = { turnId: prompt.turnId, text: prompt.text };
        appendUserMessage(prompt.turnId, prompt.text);
      } else {
        appendUserMessage(prompt.turnId, prompt.text);
        enqueuePrompt(prompt);
      }
      return;
    }
    if (
      promptQueueEnabledRef.current &&
      (activeTurnIds.current.size > 0 || currentStatus === 'sending' || currentStatus === 'streaming')
    ) {
      sendQueuedPromptFrame(prompt);
      return;
    }
    sendPromptFrame(prompt);
  }, [createRuntimeSession, enqueuePrompt, makePrompt, sendPromptFrame, sendQueuedPromptFrame]);

  const prepareSession = useCallback(() => {
    if (statusRef.current !== 'draft' || !draftRef.current) return;
    setTransientStatus(null);
    setRuntimeStatus('connecting');
    const draft = draftRef.current;
    void createRuntimeSession(draft.runtimeId, draft.agentMemberId, draft.opts);
  }, [createRuntimeSession, setRuntimeStatus]);

  const steerQueuedPrompt = useCallback((turnId: string) => {
    const queued = promptQueueRef.current.find((prompt) => prompt.turnId === turnId)
      ?? queuedPromptLookupRef.current.get(turnId);
    if (!queued) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorMessage('not connected');
      setRuntimeStatus('error');
      return;
    }
    ws.send(JSON.stringify({ type: 'steer_queued_prompt', turn_id: turnId }));
    for (const activeTurnId of activeTurnIds.current) {
      turnToMsgIdx.current.delete(activeTurnId);
      turnAssistantSegment.current.set(
        activeTurnId,
        (turnAssistantSegment.current.get(activeTurnId) ?? 0) + 1,
      );
    }
    appendUserMessage(queued.turnId, queued.text);
    queuedPromptLookupRef.current.delete(turnId);
    replacePromptQueue(promptQueueRef.current.filter((prompt) => prompt.turnId !== turnId));
  }, [appendUserMessage, replacePromptQueue, setRuntimeStatus]);

  const updateQueuedPrompt = useCallback((turnId: string, text: string) => {
    const nextText = text.trim();
    if (!nextText) return;
    const next = promptQueueRef.current.map((prompt) => (
      prompt.turnId === turnId ? { ...prompt, text: nextText } : prompt
    ));
    const updated = next.find((prompt) => prompt.turnId === turnId);
    if (updated) queuedPromptLookupRef.current.set(turnId, updated);
    replacePromptQueue(next);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'update_queued_prompt', turn_id: turnId, text: nextText }));
    }
  }, [replacePromptQueue]);

  const removeQueuedPrompt = useCallback((turnId: string) => {
    queuedPromptLookupRef.current.delete(turnId);
    replacePromptQueue(promptQueueRef.current.filter((prompt) => prompt.turnId !== turnId));
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'remove_queued_prompt', turn_id: turnId }));
    }
  }, [replacePromptQueue]);

  const reorderPromptQueue = useCallback((turnIds: string[]) => {
    const byTurnId = new Map(promptQueueRef.current.map((prompt) => [prompt.turnId, prompt]));
    const seen = new Set<string>();
    const ordered: RuntimeQueuedPrompt[] = [];
    for (const turnId of turnIds) {
      const prompt = byTurnId.get(turnId);
      if (!prompt || seen.has(turnId)) continue;
      seen.add(turnId);
      ordered.push(prompt);
    }
    for (const prompt of promptQueueRef.current) {
      if (!seen.has(prompt.turnId)) ordered.push(prompt);
    }
    replacePromptQueue(ordered);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'reorder_prompt_queue', turn_ids: ordered.map((prompt) => prompt.turnId) }));
    }
  }, [replacePromptQueue]);

  const setConfigOption = useCallback((configId: string, value: string | boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (draftRef.current) {
        pendingConfigOptionsRef.current.set(configId, value);
        setSessionConfigOptions((prev) => prev.map((option) => (
          option.id === configId
            ? { ...option, currentValue: value }
            : option
        )));
        return;
      }
      setErrorMessage('not connected');
      setRuntimeStatus('error');
      return;
    }
    ws.send(JSON.stringify({ type: 'set_config_option', config_id: configId, value }));
  }, []);

  const setSessionMode = useCallback((modeId: string) => {
    const nextModeId = modeId.trim();
    if (!nextModeId) return;
    const applyLocal = () => setSessionModes((prev) => prev ? { ...prev, currentModeId: nextModeId } : prev);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (draftRef.current) {
        pendingSessionModeRef.current = nextModeId;
        draftRef.current = {
          ...draftRef.current,
          opts: {
            ...(draftRef.current.opts ?? {}),
            permissionModeId: nextModeId,
          },
        };
        applyLocal();
        return;
      }
      pendingSessionModeRef.current = nextModeId;
      applyLocal();
      return;
    }
    ws.send(JSON.stringify({ type: 'set_session_mode', mode_id: nextModeId }));
  }, []);

  const cancel = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const turnIds = new Set([...activeTurnIds.current, ...turnToMsgIdx.current.keys()]);
    for (const turnId of turnIds) {
      ws.send(JSON.stringify({ type: 'cancel', turn_id: turnId }));
    }
  }, []);

  const respondPermission = useCallback((requestId: string, optionId: string | null) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'permission_response',
      request_id: requestId,
      option_id: optionId,
    }));
  }, []);

  const shutdown = useCallback(() => {
    sessionOperationSeq.current += 1;
    resetRuntimeState({ disposeSocket: true });
        setRuntimeSessionId(null);
    setCurrentSession(null);
    setSelectedRuntimeId(null);
    setSelectedAgentId(null);
    draftRef.current = null;
    pendingConfigOptionsRef.current.clear();
    replacePromptQueue([]);
    setRuntimeStatus('idle');
  }, [replacePromptQueue, resetRuntimeState]);

  const loadResumeOptions = useCallback(async (runtimeId: string): Promise<RuntimeResumeSession[]> => {
    try {
      const res = await fetch(runtimeApiUrl(`${RUNTIMES_PATH}/${runtimeId}/local-sessions/scan`), {
        credentials: 'include',
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { sessions: RuntimeResumeSession[] };
      return json.sessions ?? [];
    } catch {
      return [];
    }
  }, []);

  return {
    runtimes,
    startupStatus,
    selectedRuntimeId,
    selectedAgentId,
    sessionId,
    currentSession,
    status,
    errorMessage,
    transientStatus,
    diagnostics,
    messages,
    availableCommands,
    promptQueue,
    promptQueueEnabled,
    promptQueueMode,
    sessionConfigOptions,
    sessionModes,
    sessionInfoMeta,
    goal,
    sessionUsage,
    permissionRequests,
    sessionRuntimeStatus,
    sessionRestartPhase,
    ready,
    refresh,
    startDraft,
    prepareSession,
    select,
    attachSession,
    loadResumeOptions,
    sendMessage,
    setPromptQueueEnabled,
    setPromptQueueMode,
    steerQueuedPrompt,
    updateQueuedPrompt,
    removeQueuedPrompt,
    reorderPromptQueue,
    clearPromptQueue,
    setConfigOption,
    setSessionMode,
    respondPermission,
    restartSession,
    cancel,
    shutdown,
  };
}
