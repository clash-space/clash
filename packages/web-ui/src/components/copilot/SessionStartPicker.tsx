import { useEffect, useState } from 'react';
import type { RuntimeResumeSession } from '@clash/web-ui/lib/runtimeResume';
import { Button } from '../ui/button';
import { InlineAlert } from '../ui/feedback';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';

export interface AgentTemplate {
  id: string;
  label: string;
  summary?: string;
  /** Underlying ACP runtime CLI this agent template spawns (claude-agent-acp,
   *  plugin-contributed ACP agents). Diagnostic only — picker shows label, not this. */
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

function availablePreferredAgentId(
  agents: RuntimeAgentOption[],
  recentAgentId?: string,
): string | null {
  if (recentAgentId && agents.some((agent) => agent.id === recentAgentId)) {
    return recentAgentId;
  }
  return agents[0]?.id ?? null;
}

const START_FRESH_SESSION_VALUE = '__start-fresh__';

/**
 * Shared local-agent + resume picker for Quick connect and registered
 * runtimes. It intentionally hides role templates: the helper spends the
 * user's own budget and runs as the user's selected local coding agent.
 */
export function SessionStartPicker({
  agentTemplates,
  sessions,
  agents = [],
  preferredAgentId,
  onStart,
  onRecheckAuth,
  busy = false,
  startLabel = 'Start chat',
}: {
  agentTemplates: AgentTemplate[];
  sessions: RuntimeResumeSession[];
  agents?: RuntimeAgentOption[];
  preferredAgentId?: string;
  onStart: (agentTemplateId: string | null, resumeSessionId?: string, agentId?: string) => void;
  onRecheckAuth?: () => void;
  busy?: boolean;
  startLabel?: string;
}) {
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(
    () => availablePreferredAgentId(agents, preferredAgentId),
  );
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
      setAgentId(availablePreferredAgentId(agents, preferredAgentId));
    }
  }, [agents, agentId, preferredAgentId]);

  return (
    <div className="space-y-4">
      {agents.length > 1 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-stone-700 dark:text-stone-300 mb-2">Agent</div>
          <RadioGroup
            aria-label="Agent"
            value={agentId ?? ''}
            onValueChange={setAgentId}
          >
            {agents.map((agent) => (
              <RadioGroupItem
                key={agent.id}
                value={agent.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{agent.label ?? agent.id}</div>
                  {agent.auth?.status === 'needs-auth' && (
                    <div className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">Auth needed</div>
                  )}
                  {agent.binary && (
                    <div className="text-[11px] text-stone-700 dark:text-stone-300 truncate">{agent.binary}</div>
                  )}
                </div>
              </RadioGroupItem>
            ))}
          </RadioGroup>
        </div>
      )}

      {selectedAgentNeedsAuth && (
        <InlineAlert
          tone="warning"
          role="alert"
          aria-live="assertive"
          title={`Sign in to ${selectedAgentName}`}
          message={(
            <>
              <span className="block">{selectedAgent.auth?.message}</span>
              {selectedAgent.auth?.command ? (
                <code className="mt-1 block min-w-0 truncate font-mono text-[11px] opacity-75">
                  {selectedAgent.auth.command}
                </code>
              ) : null}
            </>
          )}
          action={onRecheckAuth ? (
              <Button
                onClick={onRecheckAuth}
                disabled={busy}
                size="sm"
                className="min-h-0 rounded-lg border-current/20 bg-transparent px-2.5 py-1 text-xs font-semibold text-current shadow-none hover:bg-black/5 disabled:cursor-wait disabled:opacity-60"
              >
                Check again
              </Button>
          ) : undefined}
        />
      )}

      {/* Always render Resume even when empty — picker shape stays
          consistent regardless of state. */}
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-700 dark:text-stone-300 mb-2">Resume a session</div>
        <RadioGroup
          aria-label="Resume a session"
          value={resumeId ?? START_FRESH_SESSION_VALUE}
          onValueChange={(nextResumeId) => {
            setResumeId(nextResumeId === START_FRESH_SESSION_VALUE ? null : nextResumeId);
          }}
          className="max-h-56 overflow-y-auto"
        >
          <RadioGroupItem
            value={START_FRESH_SESSION_VALUE}
            className="items-center"
          >
            <span className="text-sm text-slate-800 dark:text-slate-200">Start fresh</span>
          </RadioGroupItem>
          {sessions.map((s) => (
            <RadioGroupItem
              key={s.id}
              value={s.id}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-800 dark:text-slate-200 truncate">
                  {s.title || <span className="text-stone-700 dark:text-stone-300 italic">untitled</span>}
                </div>
                <div className="text-[11px] text-stone-700 dark:text-stone-300 truncate">
                  {s.cwd} · {new Date(s.modifiedAt * 1000).toLocaleString()}
                </div>
              </div>
            </RadioGroupItem>
          ))}
          {sessions.length === 0 && (
            <div className="text-[11px] text-stone-700 dark:text-stone-300 italic px-3 py-1">
              No previous sessions on this machine yet — start fresh.
            </div>
          )}
        </RadioGroup>
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
