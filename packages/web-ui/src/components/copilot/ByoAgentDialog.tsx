import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check, CircleNotch } from '@phosphor-icons/react';
import type { ByoStatus } from '@clash/web-ui/hooks/useAgentByoBridge';

/**
 * ByoAgentDialog — pairing flow for "Bring your own local agent".
 *
 * v1 flow: open → POST /pair → display `npx @clash-space/bridge --token=…`
 * → wait for bridge to attach → close on connected.
 *
 * Doesn't manage state itself; takes the `useAgentByoBridge` slice as
 * props so the chat panel owns the actual transport. This keeps the
 * dialog purely presentational and trivially testable.
 */
interface Props {
  open: boolean;
  status: ByoStatus;
  pairTokenDisplay: string | null;
  errorMessage: string | null;
  onStartPairing: () => void;
  onClose: () => void;
}

export function ByoAgentDialog({
  open,
  status,
  pairTokenDisplay,
  errorMessage,
  onStartPairing,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);

  // Auto-issue a token the moment the dialog opens. User shouldn't have to
  // click a "Get token" button — opening the dialog IS the intent.
  useEffect(() => {
    if (open && status === 'idle') onStartPairing();
  }, [open, status, onStartPairing]);

  // Close automatically once the bridge is up. If the user wants to inspect
  // the success state they can re-open from the chat header.
  useEffect(() => {
    if (open && status === 'connected') {
      const t = setTimeout(onClose, 700);
      return () => clearTimeout(t);
    }
  }, [open, status, onClose]);

  // Reset copy indicator when status changes (e.g. after re-pair).
  useEffect(() => {
    setCopied(false);
  }, [pairTokenDisplay]);

  const command = useMemo(
    () =>
      pairTokenDisplay
        ? `npx @clash-space/bridge@beta --token=${pairTokenDisplay}`
        : '',
    [pairTokenDisplay],
  );

  const onCopy = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers / no permission. Surface noise here would be too noisy
      // for v1 — fall back to "select the text yourself".
    }
  };

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
              Connect your local agent
            </h2>
            <p className="text-sm text-stone-500 mb-5">
              Run a Claude Code agent on your machine and pair it with this chat.
              Conversations stay on your computer and use your own API key.
            </p>

            <PairingBlock
              command={command}
              status={status}
              copied={copied}
              onCopy={onCopy}
              errorMessage={errorMessage}
            />

            <p className="mt-4 text-xs text-stone-400 leading-relaxed">
              First time? Install once with{' '}
              <code className="font-mono text-[11px] bg-warm-muted px-1.5 py-0.5 rounded">
                npm i -g @zed-industries/claude-code-acp
              </code>
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PairingBlock({
  command,
  status,
  copied,
  onCopy,
  errorMessage,
}: {
  command: string;
  status: ByoStatus;
  copied: boolean;
  onCopy: () => void;
  errorMessage: string | null;
}) {
  if (status === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm text-red-700">
        <div className="font-medium mb-1">Pairing failed</div>
        <div className="font-mono text-xs">{errorMessage ?? 'unknown error'}</div>
      </div>
    );
  }

  if (status === 'idle' || status === 'pairing') {
    return (
      <div className="flex items-center gap-2 text-sm text-stone-500 py-6 justify-center">
        <CircleNotch className="w-4 h-4 animate-spin" />
        Generating pairing code…
      </div>
    );
  }

  // From here on we have a token to display.
  return (
    <>
      <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">
        Run this in your terminal
      </div>
      <div className="flex items-stretch gap-2 mb-4">
        <code className="flex-1 font-mono text-sm bg-slate-900 text-slate-50 px-3 py-2.5 rounded-lg break-all select-all">
          {command}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="px-3 rounded-lg bg-warm-muted hover:bg-warm-border text-slate-700 transition-colors flex items-center gap-1.5 text-sm font-medium"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" weight="bold" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" weight="regular" /> Copy
            </>
          )}
        </button>
      </div>

      <PairingStatus status={status} />
    </>
  );
}

function PairingStatus({ status }: { status: ByoStatus }) {
  if (status === 'awaiting_bridge') {
    return (
      <div className="flex items-center gap-2 text-sm text-stone-500">
        <CircleNotch className="w-3.5 h-3.5 animate-spin" />
        Waiting for bridge to connect…
      </div>
    );
  }
  if (status === 'connected' || status === 'streaming' || status === 'sending') {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-600">
        <Check className="w-4 h-4" weight="bold" />
        Connected — closing dialog…
      </div>
    );
  }
  if (status === 'disconnected') {
    return (
      <div className="text-sm text-amber-700">
        Bridge disconnected. Re-run the command to reconnect.
      </div>
    );
  }
  return null;
}
