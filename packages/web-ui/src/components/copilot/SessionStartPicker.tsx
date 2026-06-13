import { useEffect, useState } from 'react';
import type { BridgeSession } from '@clash/web-ui/hooks/useAgentByoBridge';

/**
 * Legacy role identity kept for daemon compatibility. The product now
 * exposes a single helper agent, but older local bridges still expect a
 * crew_id field when starting an ACP session.
 */
export interface CrewMember {
  id: string;
  label: string;
  summary?: string;
  /** Underlying ACP runtime CLI this crew member spawns (claude-code-acp,
   *  openclaw, hermes, …). Diagnostic only — picker shows label, not this. */
  agent_id?: string;
}

export interface RuntimeAgentOption {
  id: string;
  binary?: string;
  version?: string;
}

function preferredAgentId(agents: RuntimeAgentOption[]): string | null {
  for (const id of ['codex-app-server', 'codex-cli', 'gemini-cli', 'claude-code-acp', 'claude-agent-acp']) {
    if (agents.some((agent) => agent.id === id)) return id;
  }
  return agents[0]?.id ?? null;
}

/**
 * Shared local-agent + resume picker for Quick connect and registered
 * runtimes. It intentionally hides crew roles: the helper spends the
 * user's own budget and runs as the user's selected local coding agent.
 */
export function SessionStartPicker({
  crew,
  sessions,
  agents = [],
  onStart,
  busy = false,
  startLabel = 'Start chat',
}: {
  crew: CrewMember[];
  sessions: BridgeSession[];
  agents?: RuntimeAgentOption[];
  onStart: (crewId: string | null, resumeSessionId?: string, agentId?: string) => void;
  busy?: boolean;
  startLabel?: string;
}) {
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(() => preferredAgentId(agents));
  const helperCrewId = crew[0]?.id ?? 'director';

  useEffect(() => {
    if (agents.length === 0) {
      setAgentId(null);
      return;
    }
    if (!agentId || !agents.some((agent) => agent.id === agentId)) {
      setAgentId(preferredAgentId(agents));
    }
  }, [agents, agentId]);

  return (
    <div className="space-y-4">
      {agents.length > 1 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-stone-700 dark:text-stone-300 mb-2">Agent</div>
          <div className="grid grid-cols-1 gap-1.5">
            {agents.map((agent) => (
              <label
                key={agent.id}
                className={`flex items-start gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                  agentId === agent.id
                    ? 'border-brand bg-brand/10 dark:bg-brand/15'
                    : 'border-warm-border hover:bg-warm-muted'
                }`}
              >
                <input
                  type="radio"
                  name="picker-agent"
                  className="accent-[var(--brand)] mt-0.5"
                  checked={agentId === agent.id}
                  onChange={() => setAgentId(agent.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{agent.id}</div>
                  {agent.binary && (
                    <div className="text-[11px] text-stone-700 dark:text-stone-300 truncate">{agent.binary}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Always render Resume even when empty — picker shape stays
          consistent regardless of state. */}
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-700 dark:text-stone-300 mb-2">Resume a session</div>
        <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto">
          <label
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
              resumeId === null
                ? 'border-brand bg-brand/10 dark:bg-brand/15'
                : 'border-warm-border hover:bg-warm-muted'
            }`}
          >
            <input
              type="radio"
              name="picker-session"
              className="accent-[var(--brand)]"
              checked={resumeId === null}
              onChange={() => setResumeId(null)}
            />
            <span className="text-sm text-slate-800 dark:text-slate-200">Start fresh</span>
          </label>
          {sessions.map((s) => (
            <label
              key={s.id}
              className={`flex items-start gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                resumeId === s.id
                  ? 'border-brand bg-brand/10 dark:bg-brand/15'
                  : 'border-warm-border hover:bg-warm-muted'
              }`}
            >
              <input
                type="radio"
                name="picker-session"
                className="accent-[var(--brand)] mt-0.5"
                checked={resumeId === s.id}
                onChange={() => setResumeId(s.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-800 dark:text-slate-200 truncate">
                  {s.title || <span className="text-stone-700 dark:text-stone-300 italic">untitled</span>}
                </div>
                <div className="text-[11px] text-stone-700 dark:text-stone-300 truncate">
                  {s.cwd} · {new Date(s.modifiedAt * 1000).toLocaleString()}
                </div>
              </div>
            </label>
          ))}
          {sessions.length === 0 && (
            <div className="text-[11px] text-stone-700 dark:text-stone-300 italic px-3 py-1">
              No previous sessions on this machine yet — start fresh.
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onStart(helperCrewId, resumeId ?? undefined, agentId ?? undefined)}
        disabled={busy}
        className="clash-copilot-primary w-full rounded-xl py-2.5 min-h-[44px] text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
      >
        {busy ? 'Starting…' : startLabel}
      </button>
    </div>
  );
}
