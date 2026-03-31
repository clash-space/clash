'use client';

import { useState, useEffect, useCallback } from 'react';
import type { LoroDoc } from 'loro-crdt';
import type { CustomActionDefinition } from '@clash/shared-types';

/**
 * React hook that reads registered custom action definitions from Loro doc.
 * Local agents register actions by writing to the 'customActions' map via WebSocket.
 */
export function useCustomActions(doc: LoroDoc | null): CustomActionDefinition[] {
  const [actions, setActions] = useState<CustomActionDefinition[]>([]);

  const refresh = useCallback(() => {
    if (!doc) {
      setActions([]);
      return;
    }

    try {
      const actionsMap = doc.getMap('customActions');
      const result: CustomActionDefinition[] = [];
      for (const [, raw] of actionsMap.entries()) {
        const entry = raw as Record<string, any>;
        if (entry?.id && entry?.name) {
          result.push({
            id: entry.id,
            name: entry.name,
            description: entry.description || undefined,
            parameters: Array.isArray(entry.parameters)
              ? entry.parameters
              : typeof entry.parameters === 'string'
                ? JSON.parse(entry.parameters)
                : [],
            outputType: entry.outputType || 'image',
            icon: entry.icon || undefined,
            color: entry.color || undefined,
          });
        }
      }
      setActions(result);
    } catch {
      // Map may not exist yet — that's fine
      setActions([]);
    }
  }, [doc]);

  useEffect(() => {
    refresh();

    if (!doc) return;

    // Subscribe to changes on the customActions map
    const unsub = doc.subscribe((event) => {
      // Refresh on any change — Loro doesn't provide per-map subscriptions
      // in all environments, so we refresh broadly
      refresh();
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [doc, refresh]);

  return actions;
}
