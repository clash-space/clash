import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CircleNotch } from '@phosphor-icons/react';
import { SessionStartPicker } from './SessionStartPicker';
import type { Runtime } from '@clash/web-ui/hooks/useClashRuntime';
import type { BridgeSession } from '@clash/web-ui/hooks/useAgentByoBridge';

/**
 * Picker shown when the user clicks a registered runtime in the
 * "Run on" dropdown. Same SessionStartPicker as the Quick-connect
 * dialog so the experience is identical the moment the user has
 * picked "where to run".
 *
 * Phase 1: agents come from runtime.agents (already in the runtime
 * manifest the daemon reported on attach). Sessions list is loaded via
 * `loadResumeOptions(runtimeId)` which RPCs the daemon. While the RPC
 * is in flight we render the picker without a Resume section so the
 * user can still proceed with "Start fresh".
 */
export function RuntimePickerDialog({
  open,
  runtime,
  loadResumeOptions,
  onPick,
  onClose,
  busy,
}: {
  open: boolean;
  runtime: Runtime | null;
  loadResumeOptions: (runtimeId: string) => Promise<BridgeSession[]>;
  onPick: (agentId: string | null, resumeSessionId?: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [sessions, setSessions] = useState<BridgeSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Refresh the resume list every time the dialog opens for a runtime.
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
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative w-[520px] max-w-[92vw] rounded-2xl bg-warm-surface border border-warm-border shadow-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="absolute top-3 right-3 p-1 text-stone-400 hover:text-stone-700 transition-colors"
            >
              <X className="w-4 h-4" weight="bold" />
            </button>

            <h2 className="font-display text-lg font-bold text-slate-800 mb-1">
              Start a chat on {runtime.hostname}
            </h2>
            <p className="text-sm text-stone-500 mb-5">
              Pick which local agent to run, or resume a previous session on
              this machine. Conversations stay on your computer.
            </p>

            {loadingSessions && (
              <div className="flex items-center gap-2 text-xs text-stone-400 mb-3">
                <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                Looking up resumeable sessions on this machine…
              </div>
            )}

            <SessionStartPicker
              agents={runtime.agents.map((a) => ({ id: a.id, label: a.id, command: a.binary }))}
              sessions={sessions}
              onStart={onPick}
              busy={busy}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
