export type {
  AgentSpec,
  ChildHandle,
  Spawner,
  AcpSession,
  AcpRuntime,
  RestartPolicy,
  SessionOptions,
} from "./types.js";

// Renamed `AcpRuntimeImpl` → `AcpRuntime` would collide with the same-named
// interface above. Keep the impl class postfix-named; callers do
// `new AcpRuntimeImpl(spawner)`. Slightly ugly, unambiguous.
export { AcpRuntimeImpl } from "./runtime.js";
export { AcpSessionImpl } from "./session.js";
export { NodeSpawner } from "./spawners/node.js";
export {
  authenticateAgent,
  probeAgentAuthStatus,
  probeAgentConfigOptions,
  probeAgentSessionConfig,
  type AuthenticateAgentOptions,
  type AuthenticateAgentResult,
  type ProbeAgentAuthStatus,
  type ProbeAgentAuthStatusOptions,
  type ProbeAgentConfigOptionsOptions,
  type ProbeAgentSessionConfigResult,
} from "./probe.js";
export { listAgentSessions, listLocalAgentSessions, type AcpListedSession } from "./session-list.js";

export { KNOWN_ACP_AGENTS, detect, detectAll, detectEntry, type KnownAgentEntry } from "./registry.js";
