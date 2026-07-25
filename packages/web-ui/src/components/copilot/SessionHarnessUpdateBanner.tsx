import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowClockwise, Check, CircleNotch, X } from '@phosphor-icons/react';

import type {
  SessionRestartMode,
  SessionRestartPhase,
  SessionRuntimeStatus,
} from '../../lib/sessionRuntime';
import { SESSION_RESTART_COMPLETE_VISIBLE_MS } from '../../lib/sessionRuntime';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';

interface SessionHarnessUpdateBannerProps {
  status: SessionRuntimeStatus | null;
  phase: SessionRestartPhase;
  busy: boolean;
  onRestart: (mode: SessionRestartMode) => void;
  onDismiss?: () => void;
  embedded?: boolean;
}

export function SessionHarnessUpdateBanner({
  status,
  phase,
  busy,
  onRestart,
  onDismiss,
  embedded = false,
}: SessionHarnessUpdateBannerProps) {
  const noticeKey = status
    ? `${status.session_id}:${status.harness_id}:${status.installed_version ?? ''}`
    : null;
  const [dismissedNoticeKey, setDismissedNoticeKey] = useState<string | null>(null);
  const visible = (Boolean(status?.restart_required) || phase === 'complete')
    && (onDismiss ? true : dismissedNoticeKey !== noticeKey);
  const installedVersion = status?.installed_version;
  const label = status?.harness_label ?? 'Agent';
  const pending = phase === 'pending' || status?.restart_pending;
  const restarting = phase === 'restarting';

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -6 }}
          animate={phase === 'complete'
            ? { opacity: [1, 1, 0], y: 0 }
            : { opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={phase === 'complete'
            ? {
                duration: SESSION_RESTART_COMPLETE_VISIBLE_MS / 1000,
                times: [0, 0.72, 1],
                ease: [0.16, 1, 0.3, 1],
              }
            : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className={embedded
            ? 'pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden px-3 py-3'
            : 'pointer-events-auto relative z-30 flex w-full items-center gap-3 overflow-hidden rounded-matrix border border-brand/20 bg-brand-light px-3 py-2 shadow-[0_4px_14px_rgba(69,45,31,0.06)] dark:border-brand/25'}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            {phase === 'complete' ? (
              <Check className="h-4 w-4" weight="bold" aria-hidden="true" />
            ) : restarting ? (
              <CircleNotch className="h-4 w-4 animate-spin" weight="bold" aria-hidden="true" />
            ) : (
              <ArrowClockwise className="h-4 w-4" weight="bold" aria-hidden="true" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
              {phase === 'complete'
                ? `${label}${installedVersion ? ` ${installedVersion}` : ''} is now in use`
                : `${label}${installedVersion ? ` ${installedVersion}` : ''} installed`}
            </div>
            {phase !== 'complete' && (
              <div className="mt-0.5 truncate text-[11px] text-stone-600 dark:text-stone-400">
                {pending
                  ? 'This session will restart when the current turn finishes.'
                  : 'Restart this session to use the new version.'}
              </div>
            )}
          </div>

          {phase !== 'complete' && (
            <Button
              size="sm"
              shape="rounded"
              variant="default"
              disabled={pending || restarting}
              aria-label={busy ? 'Restart after this turn' : 'Restart session'}
              className="min-h-8 shrink-0 px-2.5"
              onClick={() => onRestart(busy ? 'after-turn' : 'now')}
            >
              {pending ? 'Restart queued' : restarting ? 'Restarting…' : busy ? 'After this turn' : 'Restart'}
            </Button>
          )}
          <IconButton
            label="Dismiss ACP update notice"
            icon={<X className="h-4 w-4" />}
            size="sm"
            className="shrink-0 text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
            onClick={() => {
              if (onDismiss) onDismiss();
              else setDismissedNoticeKey(noticeKey);
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
