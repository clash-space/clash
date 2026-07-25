import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { IconButton } from './ui/icon-button';

type FeedbackVariant = 'error' | 'info' | 'success';

interface FeedbackInput {
  title: string;
  message?: string;
  variant?: FeedbackVariant;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  /** Let an accepted toast visually promote into desktop chrome state. */
  exitToDesktopChrome?: boolean;
}

interface FeedbackToast extends Required<FeedbackInput> {
  id: string;
  createdAt: number;
}

interface FeedbackDialog {
  title: string;
  message: string;
  variant: FeedbackVariant;
  actionLabel?: string;
}

interface AppFeedbackContextValue {
  notify(input: FeedbackInput): void;
  showDialog(input: FeedbackInput & { actionLabel?: string }): void;
}

const noopFeedback: AppFeedbackContextValue = {
  notify: () => undefined,
  showDialog: () => undefined,
};

const AppFeedbackContext = createContext<AppFeedbackContextValue>(noopFeedback);

const TOAST_DURATION_MS = 5_000;

function normalizedFeedback(input: FeedbackInput): Required<FeedbackInput> {
  return {
    title: input.title,
    message: input.message ?? '',
    variant: input.variant ?? 'info',
    actionLabel: input.actionLabel ?? '',
    onAction: input.onAction ?? (() => undefined),
    actionHref: input.actionHref ?? '',
    exitToDesktopChrome: input.exitToDesktopChrome ?? false,
  };
}

function variantIcon(variant: FeedbackVariant) {
  if (variant === 'success') return <CheckCircle className="h-4 w-4" weight="fill" aria-hidden="true" />;
  if (variant === 'error') return <WarningCircle className="h-4 w-4" weight="fill" aria-hidden="true" />;
  return <Info className="h-4 w-4" weight="fill" aria-hidden="true" />;
}

function variantClassName(variant: FeedbackVariant): string {
  if (variant === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-100';
  if (variant === 'error') return 'border-red-200 bg-red-50 text-red-900 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-100';
  return 'border-warm-border bg-warm-surface text-slate-900 dark:text-slate-100';
}

export function AppFeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<FeedbackToast[]>([]);
  const [dialog, setDialog] = useState<FeedbackDialog | null>(null);

  const notify = useCallback((input: FeedbackInput) => {
    const normalized = normalizedFeedback(input);
    const item: FeedbackToast = {
      ...normalized,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
    };
    setToasts((prev) => [item, ...prev].slice(0, 4));
  }, []);

  const showDialog = useCallback((input: FeedbackInput & { actionLabel?: string }) => {
    setDialog({
      ...normalizedFeedback(input),
      actionLabel: input.actionLabel,
    });
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((toast) => now - toast.createdAt < TOAST_DURATION_MS));
    }, 500);
    return () => window.clearInterval(timer);
  }, [toasts.length]);

  const value = useMemo(() => ({ notify, showDialog }), [notify, showDialog]);

  return (
    <AppFeedbackContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[10000] flex w-[min(24rem,calc(100vw-2rem))] flex-col-reverse items-end gap-2">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              role={toast.variant === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={toast.exitToDesktopChrome
                ? { opacity: 0, y: 'calc(-100vh + 3.25rem)', scale: 0.3 }
                : { opacity: 0, x: 12, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className={`pointer-events-auto flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 shadow-lg ${variantClassName(toast.variant)}`}
            >
              <span className="mt-0.5 shrink-0">{variantIcon(toast.variant)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-5">{toast.title}</span>
                {toast.message ? <span className="mt-0.5 block text-xs leading-5 opacity-75">{toast.message}</span> : null}
                {toast.actionLabel ? (
                  toast.actionHref ? (
                    <Link
                      to={toast.actionHref}
                      onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
                      className="mt-2 inline-flex rounded-lg border border-current/20 px-2.5 py-1 text-xs font-semibold opacity-90 transition hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {toast.actionLabel}
                    </Link>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        toast.onAction();
                        setToasts((prev) => prev.filter((item) => item.id !== toast.id));
                      }}
                      className="mt-2 min-h-0 border-current/20 bg-transparent px-2.5 py-1 text-xs font-semibold text-current opacity-90 shadow-none hover:bg-black/5 hover:opacity-100"
                    >
                      {toast.actionLabel}
                    </Button>
                  )
                ) : null}
              </span>
              <IconButton
                label="Dismiss notification"
                icon={<X className="h-3.5 w-3.5" weight="bold" />}
                size="sm"
                onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
                className="shrink-0 text-current opacity-60 hover:bg-black/5 hover:text-current hover:opacity-100"
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.title ?? 'Notice'}
        description={dialog?.message}
        size="sm"
      >
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => setDialog(null)}
            className="clash-settings-primary px-4 py-2 text-sm font-semibold"
          >
            {dialog?.actionLabel ?? 'OK'}
          </Button>
        </div>
      </Dialog>
    </AppFeedbackContext.Provider>
  );
}

export function useAppFeedback(): AppFeedbackContextValue {
  return useContext(AppFeedbackContext);
}
