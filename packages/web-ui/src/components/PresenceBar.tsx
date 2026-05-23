
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkle, Terminal } from '@phosphor-icons/react';
import type { PresenceClient } from '@clash/shared-types';

interface PresenceBarProps {
  clients: PresenceClient[];
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function PresenceBar({ clients }: PresenceBarProps) {
  if (clients.length === 0) return null;

  const maxVisible = 5;
  const visible = clients.slice(0, maxVisible);
  const overflow = clients.length - maxVisible;

  return (
    <div className="flex items-center -space-x-2">
      <AnimatePresence mode="popLayout">
        {visible.map((client) => (
          <motion.div
            key={client.id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="relative group"
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-warm-surface shadow-sm ${
                client.clientType === 'agent'
                  ? 'bg-brand'
                  : client.clientType === 'cli'
                    ? 'bg-warm-surface ring-1 ring-warm-border'
                    : 'bg-gradient-to-br from-brand to-red-500'
              }`}
            >
              {client.clientType === 'agent' ? (
                <Sparkle className="h-4 w-4 text-white" weight="fill" aria-hidden="true" />
              ) : client.clientType === 'cli' ? (
                <Terminal className="h-4 w-4 text-blue-700 dark:text-blue-300" weight="bold" aria-hidden="true" />
              ) : client.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={client.avatar}
                  alt={client.name}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <span className="text-xs font-bold text-white">
                  {getInitials(client.name)}
                </span>
              )}
            </div>

            {/* Tooltip */}
            <div role="tooltip" className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 rounded-md bg-slate-900 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity pointer-events-none z-50 dark:bg-slate-100 dark:text-slate-900">
              {client.name}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {overflow > 0 && (
        <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-warm-surface bg-warm-muted text-xs font-bold text-slate-700 shadow-sm dark:text-slate-200" aria-label={`${overflow} more participants`}>
          +{overflow}
        </div>
      )}
    </div>
  );
}
