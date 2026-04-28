import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CircleNotch } from '@phosphor-icons/react';
import { SessionStartPicker, type CrewMember } from './SessionStartPicker';
import type { Runtime } from '@clash/web-ui/hooks/useClashRuntime';
import type { BridgeSession } from '@clash/web-ui/hooks/useAgentByoBridge';

/**
 * Picker shown when the user clicks a registered runtime in the
 * "Run on" dropdown. Same SessionStartPicker as the Quick-connect
 * dialog so the experience is identical the moment the user has
 * picked "where to run".
 *
 * Crew list is hardcoded for v1 to match the bundled clash-bridge
 * crew (Director / Canvas Editor / Generator / Storyboard Artist /
 * Project Manager). v2 fetches it from the runtime via DO RPC so
 * user-customizable crew works.
 */

const BUILTIN_CREW: CrewMember[] = [
  { id: 'director',        label: 'Director',          summary: 'Plans the video and orchestrates the other roles.' },
  { id: 'canvas-editor',   label: 'Canvas Editor',     summary: 'Adds / edits / reorders / deletes nodes on the canvas.' },
  { id: 'generator',       label: 'Generator',         summary: 'Dispatches and tracks image / video / clip generation.' },
  { id: 'storyboard',      label: 'Storyboard Artist', summary: 'Sketches a shot list and lays it on the canvas.' },
  { id: 'project-manager', label: 'Project Manager',   summary: 'Lists / creates / switches / deletes projects.' },
];

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
  onPick: (crewId: string | null, resumeSessionId?: string) => void;
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
              Pick which crew member to talk to, or resume a previous chat
              on this machine. Conversations stay on your computer.
            </p>

            {loadingSessions && (
              <div className="flex items-center gap-2 text-xs text-stone-400 mb-3">
                <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                Looking up resumeable sessions on this machine…
              </div>
            )}

            <SessionStartPicker
              crew={BUILTIN_CREW}
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
