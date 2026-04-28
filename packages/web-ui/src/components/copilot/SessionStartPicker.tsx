import { useEffect, useState } from 'react';
import type { BridgeAgent, BridgeSession } from '@clash/web-ui/hooks/useAgentByoBridge';

/**
 * Shared agent + (optional) resume picker — same UX for Quick connect
 * and persistent-runtime flows. Extracted so the two paths feel identical
 * the moment the user has picked "where to run".
 *
 * Doesn't manage any of its own transport. Caller hands in the agent
 * list and the resumeable session list, and gets a `(agentId, resumeId?)`
 * tuple via onStart.
 */
export function SessionStartPicker({
  agents,
  sessions,
  onStart,
  busy = false,
  startLabel = 'Start chat',
}: {
  agents: BridgeAgent[];
  sessions: BridgeSession[];
  onStart: (agentId: string | null, resumeSessionId?: string) => void;
  busy?: boolean;
  startLabel?: string;
}) {
  const [agentId, setAgentId] = useState<string | null>(agents[0]?.id ?? null);
  const [resumeId, setResumeId] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId || !agents.some((a) => a.id === agentId)) {
      setAgentId(agents[0]?.id ?? null);
    }
  }, [agents, agentId]);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">Agent</div>
        {agents.length === 0 ? (
          <div className="text-sm text-amber-700">No ACP agents detected on PATH.</div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            {agents.map((a) => (
              <label
                key={a.id}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                  agentId === a.id
                    ? 'border-emerald-300 bg-emerald-50/40'
                    : 'border-stone-200 hover:bg-warm-muted'
                }`}
              >
                <input
                  type="radio"
                  name="picker-agent"
                  className="accent-emerald-600"
                  checked={agentId === a.id}
                  onChange={() => setAgentId(a.id)}
                />
                <span className="text-sm font-medium text-slate-700">{a.label}</span>
                {a.command && (
                  <span className="text-[11px] text-stone-400 font-mono">{a.command}</span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Always render the Resume section — even empty — so the picker
          shape is consistent. When no sessions exist, the user sees the
          header + "Start fresh" + a one-line explanation rather than
          a blank where the section would be. */}
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">Resume a session</div>
        <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto">
          <label
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
              resumeId === null
                ? 'border-emerald-300 bg-emerald-50/40'
                : 'border-stone-200 hover:bg-warm-muted'
            }`}
          >
            <input
              type="radio"
              name="picker-session"
              className="accent-emerald-600"
              checked={resumeId === null}
              onChange={() => setResumeId(null)}
            />
            <span className="text-sm text-slate-700">Start fresh</span>
          </label>
          {sessions.map((s) => (
            <label
              key={s.id}
              className={`flex items-start gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                resumeId === s.id
                  ? 'border-emerald-300 bg-emerald-50/40'
                  : 'border-stone-200 hover:bg-warm-muted'
              }`}
            >
              <input
                type="radio"
                name="picker-session"
                className="accent-emerald-600 mt-0.5"
                checked={resumeId === s.id}
                onChange={() => setResumeId(s.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-700 truncate">
                  {s.title || <span className="text-stone-400 italic">untitled</span>}
                </div>
                <div className="text-[11px] text-stone-400 truncate">
                  {s.cwd} · {new Date(s.modifiedAt * 1000).toLocaleString()}
                </div>
              </div>
            </label>
          ))}
          {sessions.length === 0 && (
            <div className="text-[11px] text-stone-400 italic px-3 py-1">
              No previous sessions on this machine yet — start fresh.
            </div>
          )}
        </div>
      </div>



      <button
        type="button"
        onClick={() => onStart(agentId, resumeId ?? undefined)}
        disabled={!agentId || busy}
        className="w-full rounded-full bg-gray-900 text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? 'Starting…' : startLabel}
      </button>
    </div>
  );
}
