
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkle, Terminal } from '@phosphor-icons/react';
import type { PresenceClient } from '@clash/shared-types';
import { AvatarFallback, AvatarImage, AvatarRoot } from './ui/avatar';
import { Tooltip } from './ui/tooltip';

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
          >
            <Tooltip label={client.name}>
              <AvatarRoot
                aria-label={client.name}
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-warm-surface shadow-sm ${
                  client.clientType === 'agent'
                    ? 'bg-brand'
                    : client.clientType === 'cli'
                      ? 'bg-warm-surface ring-1 ring-warm-border'
                      : 'bg-brand-light text-brand ring-1 ring-brand/20'
                }`}
              >
                {client.clientType === 'agent' ? (
                  <Sparkle className="h-4 w-4 text-white" weight="fill" aria-hidden="true" />
                ) : client.clientType === 'cli' ? (
                  <Terminal className="h-4 w-4 text-slate-700 dark:text-slate-300" weight="bold" aria-hidden="true" />
                ) : client.avatar ? (
                  <>
                    <AvatarImage
                      src={client.avatar}
                      alt={client.name}
                      className="h-full w-full rounded-full object-cover"
                    />
                    <AvatarFallback className="text-xs font-bold text-brand">
                      {getInitials(client.name)}
                    </AvatarFallback>
                  </>
                ) : (
                  <AvatarFallback className="text-xs font-bold text-brand">
                    {getInitials(client.name)}
                  </AvatarFallback>
                )}
              </AvatarRoot>
            </Tooltip>
          </motion.div>
        ))}
      </AnimatePresence>

      {overflow > 0 && (
        <AvatarRoot className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-warm-surface bg-warm-muted text-xs font-bold text-slate-700 shadow-sm dark:text-slate-200" aria-label={`${overflow} more participants`}>
          <AvatarFallback>
            +{overflow}
          </AvatarFallback>
        </AvatarRoot>
      )}
    </div>
  );
}
