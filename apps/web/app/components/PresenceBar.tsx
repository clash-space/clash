'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Robot } from '@phosphor-icons/react';
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
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-white shadow-sm ${
                client.clientType === 'cli'
                  ? 'bg-gray-900 ring-2 ring-emerald-400'
                  : 'bg-gradient-to-br from-brand to-red-500'
              }`}
            >
              {client.clientType === 'cli' ? (
                <Robot className="h-4 w-4 text-emerald-400" weight="bold" />
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
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 rounded-md bg-gray-900 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              {client.name}
              {client.clientType === 'cli' && (
                <span className="text-emerald-400 ml-1">CLI</span>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {overflow > 0 && (
        <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-gray-200 text-xs font-bold text-gray-600 shadow-sm">
          +{overflow}
        </div>
      )}
    </div>
  );
}
