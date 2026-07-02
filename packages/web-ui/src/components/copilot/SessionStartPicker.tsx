import { useEffect, useState } from 'react';
import type { BridgeSession } from '@clash/web-ui/hooks/useAgentByoBridge';
import { Button } from '../ui/button';

export interface AgentTemplate {
  id: string;
  label: string;
  summary?: string;
  /** Underlying ACP runtime CLI this agent template spawns (claude-agent-acp,
   *  openclaw, hermes, …). Diagnostic only — picker shows label, not this. */
  agent_id?: string;
}

export interface RuntimeAgentOption {
  id: string;
  label?: string;
  binary?: string;
  version?: string;
  auth?: {
    status: 'configured' | 'needs-auth' | 'unknown';
    message: string;
    command?: string;
  };
}

function preferredAgentId(agents: RuntimeAgentOption[]): string | null {
  for (const id of ['codex-acp', 'claude-acp', 'gemini']) {
    if (agents.some((agent) => agent.id === id)) return id;
  }
  return agents[0]?.id ?? null;
}

/**
 * Shared local-agent + resume picker for Quick connect and registered
 * runtimes. It intentionally hides role templates: the helper spends the
 * user's own budget and runs as the user's selected local coding agent.
 */
export function SessionStartPicker({
  agentTemplates,
  sessions,
  agents = [],
  onStart,
  onRecheckAuth,
  busy = false,
  startLabel = 'Start chat',
}: {
  agentTemplates: AgentTemplate[];
  sessions: BridgeSession[];
  agents?: RuntimeAgentOption[];
  onStart: (agentTemplateId: string | null, resumeSessionId?: string, agentId?: string) => void;
  onRecheckAuth?: () => void;
  busy?: boolean;
  startLabel?: string;
}) {
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(() => preferredAgentId(agents));
  void agentTemplates;
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;
  const selectedAgentNeedsAuth = selectedAgent?.auth?.status === 'needs-auth';
  const selectedAgentName = selectedAgent?.label ?? selectedAgent?.id ?? 'agent';

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
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{agent.label ?? agent.id}</div>
                  {agent.auth?.status === 'needs-auth' && (
                    <div className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">Auth needed</div>
                  )}
                  {agent.binary && (
                    <div className="text-[11px] text-stone-700 dark:text-stone-300 truncate">{agent.binary}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {selectedAgentNeedsAuth && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 dark:border-amber-300/25 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <div className="font-semibold">Sign in to {selectedAgentName}</div>
          <div className="mt-0.5 leading-5 text-amber-900/80 dark:text-amber-100/80">
            {selectedAgent.auth?.message}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {onRecheckAuth && (
              <Button
                onClick={onRecheckAuth}
                disabled={busy}
                size="sm"
                className="min-h-0 rounded-lg border-amber-300/70 bg-transparent px-2.5 py-1 text-xs font-semibold text-amber-900 shadow-none hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-300/30 dark:text-amber-100"
              >
                Check again
              </Button>
            )}
            {selectedAgent.auth?.command && (
              <span className="min-w-0 truncate font-mono text-[11px] text-amber-800/75 dark:text-amber-100/70">
                {selectedAgent.auth.command}
              </span>
            )}
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

      <Button
        onClick={() => onStart(null, resumeId ?? undefined, agentId ?? undefined)}
        disabled={busy || selectedAgentNeedsAuth}
        className="clash-copilot-primary w-full rounded-xl border-transparent py-2.5 text-sm font-semibold shadow-none"
      >
        {busy ? 'Starting…' : startLabel}
      </Button>
    </div>
  );
}
