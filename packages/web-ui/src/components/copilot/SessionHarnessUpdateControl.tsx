import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowClockwise, Check, CircleNotch } from '@phosphor-icons/react';

import { SESSION_RESTART_COMPLETE_VISIBLE_MS } from '../../lib/sessionRuntime';
import type {
  SessionRestartMode,
  SessionRestartPhase,
  SessionRuntimeStatus,
} from '../../lib/sessionRuntime';
import { IconButton } from '../ui/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { SessionHarnessUpdateBanner } from './SessionHarnessUpdateBanner';

interface SessionHarnessUpdateControlProps {
  status: SessionRuntimeStatus | null;
  phase: SessionRestartPhase;
  busy: boolean;
  onRestart: (mode: SessionRestartMode) => void;
}

export function SessionHarnessUpdateControl({
  status,
  phase,
  busy,
  onRestart,
}: SessionHarnessUpdateControlProps) {
  const visible = Boolean(status?.restart_required) || phase === 'complete';
  const autoOpenKey = visible
    ? `${status?.session_id ?? ''}:${status?.harness_id ?? ''}:${status?.installed_version ?? ''}:${phase === 'complete' ? 'complete' : 'restart-required'}`
    : null;
  const [open, setOpen] = useState(false);
  const lastAutoOpenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoOpenKey) {
      lastAutoOpenKeyRef.current = null;
      setOpen(false);
      return;
    }
    if (lastAutoOpenKeyRef.current !== autoOpenKey) {
      lastAutoOpenKeyRef.current = autoOpenKey;
      setOpen(true);
    }
  }, [autoOpenKey]);

  if (!visible) return null;

  const pending = phase === 'pending' || status?.restart_pending;
  const restarting = phase === 'restarting';
  const triggerLabel = phase === 'complete'
    ? 'ACP session updated'
    : pending
      ? 'ACP session restart queued'
      : restarting
        ? 'ACP session restarting'
        : 'ACP update requires session restart';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          label={triggerLabel}
          size="sm"
          className="relative shrink-0 text-brand hover:bg-brand/10"
          icon={
            <>
              {phase === 'complete' ? (
                <motion.span
                  data-session-update-motion="fade-out"
                  className="flex"
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: [0, 1, 1, 0],
                  }}
                  transition={{
                    duration: SESSION_RESTART_COMPLETE_VISIBLE_MS / 1000,
                    times: [0, 0.08, 0.72, 1],
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  <Check className="h-4 w-4" weight="bold" />
                </motion.span>
              ) : restarting ? (
                <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
              ) : (
                <ArrowClockwise className="h-4 w-4" weight="bold" />
              )}
              {!open && phase !== 'complete' ? (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full border border-warm-surface bg-brand" />
              ) : null}
            </>
          }
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        data-session-runtime-update-popover="true"
        aria-label="Current session ACP update"
        className="w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden p-0"
      >
        <SessionHarnessUpdateBanner
          status={status}
          phase={phase}
          busy={busy}
          embedded
          onRestart={onRestart}
          onDismiss={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
