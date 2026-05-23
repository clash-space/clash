import { useEffect, useMemo, useState } from 'react';
import { Copy, Check, CircleNotch } from '@phosphor-icons/react';
import type { ByoStatus, BridgeCrewMember, BridgeSession } from '@clash/web-ui/hooks/useAgentByoBridge';
import { Dialog } from '../ui/dialog';
import { SessionStartPicker } from './SessionStartPicker';

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
  crew: BridgeCrewMember[];
  sessions: BridgeSession[];
  onStartPairing: () => void;
  onStartWith: (crewId: string | null, resumeSessionId?: string) => void;
  onClose: () => void;
}

export function ByoAgentDialog({
  open,
  status,
  pairTokenDisplay,
  errorMessage,
  crew,
  sessions,
  onStartPairing,
  onStartWith,
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

  const command = useMemo(() => {
    if (!pairTokenDisplay) return '';
    // Always pin --server to the current origin's wss URL. Otherwise the
    // bridge falls back to its compiled-in default (clash.video), which
    // breaks for staging / self-hosted deploys. `@beta` pins to the
    // working tarball — npm `latest` may point at a broken release.
    const origin =
      typeof window !== 'undefined'
        ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
        : 'wss://clash.video';
    return `npx @clash-space/bridge@beta --token=${pairTokenDisplay} --server=${origin}`;
  }, [pairTokenDisplay]);

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
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect your local agent"
      description="Run a Claude Code agent on your machine and pair it with this chat. Conversations stay on your computer and use your own API key."
    >
      {status === 'awaiting_choice' ? (
        <SessionStartPicker
          crew={crew}
          sessions={sessions}
          onStart={onStartWith}
        />
      ) : (
        <PairingBlock
          command={command}
          status={status}
          copied={copied}
          onCopy={onCopy}
          errorMessage={errorMessage}
        />
      )}

      <p className="mt-4 text-xs text-stone-600 leading-relaxed dark:text-stone-400">
        First time? Install once with{' '}
        <code className="font-mono text-[11px] bg-warm-muted px-1.5 py-0.5 rounded">
          npm i -g @zed-industries/claude-code-acp
        </code>
      </p>
    </Dialog>
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
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-200">
        <div className="font-medium mb-1">Pairing failed</div>
        <div className="font-mono text-xs">{errorMessage ?? 'unknown error'}</div>
      </div>
    );
  }

  if (status === 'idle' || status === 'pairing') {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-stone-700 py-6 justify-center dark:text-stone-300">
        <CircleNotch className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Generating pairing code…
      </div>
    );
  }

  return (
    <>
      <div className="text-xs uppercase tracking-wider text-stone-600 mb-2 dark:text-stone-400">
        Run this in your terminal
      </div>
      <div className="flex items-stretch gap-2 mb-4">
        <code className="flex-1 font-mono text-sm bg-slate-900 text-slate-50 px-3 py-2.5 rounded-lg break-all select-all dark:bg-warm-page dark:text-slate-100 dark:border dark:border-warm-border">
          {command}
        </code>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? 'Copied' : 'Copy command'}
          className="px-3 min-h-[44px] rounded-lg bg-warm-muted hover:bg-warm-hover text-slate-800 transition-colors flex items-center gap-1.5 text-sm font-medium dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" weight="bold" aria-hidden="true" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" weight="regular" aria-hidden="true" /> Copy
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
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
        <CircleNotch className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Waiting for bridge to connect…
      </div>
    );
  }
  if (status === 'starting') {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
        <CircleNotch className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Starting agent…
      </div>
    );
  }
  if (status === 'connected' || status === 'streaming' || status === 'sending') {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
        <Check className="w-4 h-4" weight="bold" aria-hidden="true" />
        Connected — closing dialog…
      </div>
    );
  }
  if (status === 'disconnected') {
    return (
      <div role="status" aria-live="polite" className="text-sm text-amber-800 dark:text-amber-300">
        Bridge disconnected — auto-reconnecting…
      </div>
    );
  }
  return null;
}

