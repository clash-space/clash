import { useEffect, useState } from 'react';
import type { BridgeSession } from '@clash/web-ui/hooks/useAgentByoBridge';

/**
 * One bundled crew member (Director / Canvas Editor / …). Shape mirrors
 * the manifest the bridge daemon ships in its dist/crew/manifest.json.
 */
export interface CrewMember {
  id: string;
  label: string;
  summary?: string;
  /** Underlying ACP runtime CLI this crew member spawns (claude-code-acp,
   *  openclaw, hermes, …). Diagnostic only — picker shows label, not this. */
  agent_id?: string;
}

/**
 * Shared crew + (optional) resume picker — same UX for Quick connect
 * and persistent-runtime flows. Caller hands in the crew list and the
 * resumeable session list, and gets a `(crewId, resumeId?)` tuple via
 * onStart.
 */
export function SessionStartPicker({
  crew,
  sessions,
  onStart,
  busy = false,
  startLabel = 'Start chat',
}: {
  crew: CrewMember[];
  sessions: BridgeSession[];
  onStart: (crewId: string | null, resumeSessionId?: string) => void;
  busy?: boolean;
  startLabel?: string;
}) {
  const [crewId, setCrewId] = useState<string | null>(crew[0]?.id ?? null);
  const [resumeId, setResumeId] = useState<string | null>(null);

  useEffect(() => {
    if (!crewId || !crew.some((m) => m.id === crewId)) {
      setCrewId(crew[0]?.id ?? null);
    }
  }, [crew, crewId]);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-700 dark:text-stone-300 mb-2">Crew</div>
        {crew.length === 0 ? (
          <div className="text-sm text-amber-700">
            No crew members reported by this runtime — upgrade the daemon
            to populate the list.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            {crew.map((m) => (
              <label
                key={m.id}
                className={`flex items-start gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                  crewId === m.id
                    ? 'border-brand bg-brand/10 dark:bg-brand/15'
                    : 'border-warm-border hover:bg-warm-muted'
                }`}
              >
                <input
                  type="radio"
                  name="picker-crew"
                  className="accent-[var(--brand)] mt-0.5"
                  checked={crewId === m.id}
                  onChange={() => setCrewId(m.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{m.label}</div>
                  {m.summary && (
                    <div className="text-[11px] text-stone-700 dark:text-stone-300">{m.summary}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

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
        onClick={() => onStart(crewId, resumeId ?? undefined)}
        disabled={!crewId || busy}
        className="w-full rounded-full bg-gray-900 text-white py-2.5 min-h-[44px] text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
      >
        {busy ? 'Starting…' : startLabel}
      </button>
    </div>
  );
}
