
import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkle, ArrowRight, User, Terminal } from '@phosphor-icons/react';
import type { ActivityMessage } from '@clash/shared-types';
import { IconButton } from './ui/icon-button';

interface ToastItem {
  id: string;
  activity: ActivityMessage;
  createdAt: number;
}

const MAX_TOASTS = 3;
const TOAST_DURATION_MS = 4_000;

export function useActivityToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((activity: ActivityMessage) => {
    const item: ToastItem = {
      id: `${activity.nodeId}-${activity.timestamp}`,
      activity,
      createdAt: Date.now(),
    };
    setToasts((prev) => [item, ...prev].slice(0, MAX_TOASTS));
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.createdAt < TOAST_DURATION_MS));
    }, 500);
    return () => clearInterval(timer);
  }, [toasts.length]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, dismiss };
}

const actionVerbs: Record<string, string> = {
  added: 'added',
  updated: 'edited',
  deleted: 'removed',
};

export default function ActivityToast({
  toasts,
  dismiss,
  onGoToNode,
  sidebarWidth,
  isSidebarCollapsed,
}: {
  toasts: ToastItem[];
  dismiss: (id: string) => void;
  onGoToNode?: (nodeId: string) => void;
  sidebarWidth?: number;
  isSidebarCollapsed?: boolean;
}) {
  const rightOffset = isSidebarCollapsed ? 12 : (sidebarWidth ?? 384) + 12;

  return (
    <motion.div
      className="fixed bottom-4 z-[100] flex flex-col-reverse items-end gap-1.5 pointer-events-none"
      animate={{ right: rightOffset }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const isAgent = toast.activity.actor.clientType === 'agent';
          const isCli = toast.activity.actor.clientType === 'cli';
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              role="status"
              className="pointer-events-auto flex items-center gap-2 rounded-full bg-warm-surface pl-1.5 pr-3 py-1.5 shadow-md border border-warm-border"
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-full ${
                isAgent ? 'bg-brand' : isCli ? 'bg-warm-muted ring-1 ring-warm-border' : 'bg-brand-light'
              }`} aria-hidden="true">
                {isAgent ? (
                  <Sparkle className="h-3 w-3 text-white" weight="fill" />
                ) : isCli ? (
                  <Terminal className="h-3 w-3 text-slate-700 dark:text-slate-300" weight="bold" />
                ) : (
                  <User className="h-3 w-3 text-brand" weight="fill" />
                )}
              </span>

              <span className="text-xs text-slate-700 whitespace-nowrap dark:text-slate-300">
                <span className="font-medium text-slate-900 dark:text-slate-50">{toast.activity.actor.name}</span>
                {' '}
                {actionVerbs[toast.activity.action] ?? toast.activity.action}
                {' '}
                <span className="text-brand font-medium">
                  {toast.activity.label || toast.activity.nodeId}
                </span>
              </span>

              {onGoToNode && toast.activity.action !== 'deleted' && (
                <IconButton
                  label="Go to node"
                  icon={<ArrowRight className="h-3 w-3" weight="bold" />}
                  size="sm"
                  shape="circle"
                  onClick={() => {
                    onGoToNode(toast.activity.nodeId);
                    dismiss(toast.id);
                  }}
                  className="text-brand hover:bg-brand/10 hover:text-brand focus-visible:ring-offset-1"
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
}
