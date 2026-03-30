'use client';

import { useState, useCallback, useEffect } from 'react';
import { useReactFlow, useViewport } from 'reactflow';
import { motion, AnimatePresence } from 'framer-motion';
import { Robot, User } from '@phosphor-icons/react';
import type { ActivityMessage } from '@clash/shared-types';

interface NodeHighlight {
  nodeId: string;
  actor: ActivityMessage['actor'];
  action: string;
  timestamp: number;
}

const HIGHLIGHT_DURATION_MS = 3_000;

export function useNodeHighlights() {
  const [highlights, setHighlights] = useState<Map<string, NodeHighlight>>(new Map());

  const addHighlight = useCallback((activity: ActivityMessage) => {
    setHighlights((prev) => {
      const next = new Map(prev);
      next.set(activity.nodeId, {
        nodeId: activity.nodeId,
        actor: activity.actor,
        action: activity.action,
        timestamp: Date.now(),
      });
      return next;
    });
  }, []);

  // Auto-expire highlights
  useEffect(() => {
    if (highlights.size === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setHighlights((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const [id, h] of next) {
          if (now - h.timestamp > HIGHLIGHT_DURATION_MS) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(timer);
  }, [highlights.size]);

  return { highlights, addHighlight };
}

const actionLabels: Record<string, string> = {
  added: 'added this',
  updated: 'editing',
  deleted: 'removed this',
};

/**
 * Renders floating labels above nodes that were recently modified by other clients.
 * Uses ReactFlow's coordinate system to position labels correctly.
 */
export default function NodeActivityIndicator({
  highlights,
}: {
  highlights: Map<string, NodeHighlight>;
}) {
  const { getNode } = useReactFlow();
  const viewport = useViewport();

  if (highlights.size === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-[45] overflow-hidden">
      <AnimatePresence>
        {Array.from(highlights.values()).map((h) => {
          const node = getNode(h.nodeId);
          if (!node) return null;

          // Convert ReactFlow node position to screen coordinates
          const x = node.position.x * viewport.zoom + viewport.x;
          const y = node.position.y * viewport.zoom + viewport.y;
          const isCli = h.actor.clientType === 'cli';

          return (
            <motion.div
              key={h.nodeId}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute flex items-center gap-1.5"
              style={{
                left: x,
                top: y - 28,
                transform: 'translateX(0)',
              }}
            >
              {/* Indicator pill */}
              <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm ${
                isCli
                  ? 'bg-gray-900 text-white'
                  : 'bg-brand text-white'
              }`}>
                {isCli ? (
                  <Robot className="h-2.5 w-2.5" weight="fill" />
                ) : (
                  <User className="h-2.5 w-2.5" weight="fill" />
                )}
                <span>{h.actor.name}</span>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
