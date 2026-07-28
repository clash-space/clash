import { useEffect, useState } from 'react';
import { CircleNotch } from '@phosphor-icons/react';
import { SessionStartPicker, type AgentTemplate } from './SessionStartPicker';
import { Dialog } from '../ui/dialog';
import type { Runtime } from '@clash/web-ui/hooks/useClashRuntime';
import type { BridgeSession } from '@clash/web-ui/hooks/useAgentByoBridge';

/**
 * Picker shown when the user clicks a registered runtime in the
 * "Run on" dropdown. The product surface is single-helper: pick the
 * local coding agent and
 * optionally resume a previous ACP session on that machine.
 */

const BUILTIN_AGENT_TEMPLATES: AgentTemplate[] = [
  { id: 'master-clash', label: 'Master Clash' },
];

export function RuntimePickerDialog({
  open,
  runtime,
  loadResumeOptions,
  onPick,
  onRecheckAgents,
  onClose,
  busy,
}: {
  open: boolean;
  runtime: Runtime | null;
  loadResumeOptions: (runtimeId: string) => Promise<BridgeSession[]>;
  onPick: (agentTemplateId: string | null, resumeSessionId?: string, agentId?: string) => void;
  onRecheckAgents?: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [sessions, setSessions] = useState<BridgeSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => {
    if (!open || !runtime) return;
    let cancelled = false;
    setSessions([]);
    setLoadingSessions(true);
    loadResumeOptions(runtime.id)
      .then((s) => { if (!cancelled) setSessions(s); })
      .catch(() => { if (!cancelled) setSessions([]); })
      .finally(() => { if (!cancelled) setLoadingSessions(false); });
    return () => { cancelled = true; };
  }, [open, runtime, loadResumeOptions]);

  if (!runtime) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Start local helper on ${runtime.hostname}`}
      description="Pick which local coding agent powers this helper, or resume a previous session on this machine. The helper uses your own budget."
    >
      {loadingSessions && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-stone-700 mb-3 dark:text-stone-300">
          <CircleNotch className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Looking up resumeable sessions on this machine…
        </div>
      )}

      <SessionStartPicker
        agentTemplates={BUILTIN_AGENT_TEMPLATES}
        sessions={sessions}
        agents={runtime.agents}
        preferredAgentId={runtime.preferences?.agent_id}
        onStart={onPick}
        onRecheckAuth={onRecheckAgents}
        busy={busy}
        startLabel="Start helper"
      />
    </Dialog>
  );
}
