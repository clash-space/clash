'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Robot, ArrowRight, User } from '@phosphor-icons/react';
import type { ActivityMessage } from '@clash/shared-types';

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
          const isCli = toast.activity.actor.clientType === 'cli';
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/90 backdrop-blur-xl pl-1.5 pr-3 py-1.5 shadow-sm border border-brand/15"
            >
              <div className={`flex h-6 w-6 items-center justify-center rounded-full ${
                isCli ? 'bg-gray-900' : 'bg-brand/10'
              }`}>
                {isCli ? (
                  <Robot className="h-3 w-3 text-white" weight="fill" />
                ) : (
                  <User className="h-3 w-3 text-brand" weight="fill" />
                )}
              </div>

              <span className="text-xs text-gray-500 whitespace-nowrap">
                <span className="font-medium text-gray-900">{toast.activity.actor.name}</span>
                {' '}
                {actionVerbs[toast.activity.action] ?? toast.activity.action}
                {' '}
                <span className="text-brand font-medium">
                  {toast.activity.label || toast.activity.nodeId}
                </span>
              </span>

              {onGoToNode && toast.activity.action !== 'deleted' && (
                <button
                  onClick={() => {
                    onGoToNode(toast.activity.nodeId);
                    dismiss(toast.id);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand/10 transition-colors"
                  title="Go to node"
                >
                  <ArrowRight className="h-3 w-3 text-brand" weight="bold" />
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
}
