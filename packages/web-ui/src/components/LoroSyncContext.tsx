
import { createContext, useContext, ReactNode } from 'react';
import { type UseLoroSyncReturn } from '@clash/web-ui/hooks/useLoroSync';

/**
 * Context value for LoroSync
 * Provides all sync methods to child components
 */
type LoroSyncContextValue = UseLoroSyncReturn;

const LoroSyncContext = createContext<LoroSyncContextValue | null>(null);

interface LoroSyncProviderProps {
  /**
   * The loroSync instance from useLoroSync hook
   * This allows ProjectEditor to create the hook and pass it down
   */
  loroSync: UseLoroSyncReturn;
  children: ReactNode;
}

/**
 * Provider component that wraps loroSync and exposes its
 * functions to all child components
 */
export function LoroSyncProvider({ loroSync, children }: LoroSyncProviderProps) {
  return (
    <LoroSyncContext.Provider value={loroSync}>
      {children}
    </LoroSyncContext.Provider>
  );
}

/**
 * Hook to access LoroSync functions from any child component
 * Must be used within a LoroSyncProvider
 */
export function useLoroSyncContext(): LoroSyncContextValue {
  const context = useContext(LoroSyncContext);
  if (!context) {
    throw new Error('useLoroSyncContext must be used within a LoroSyncProvider');
  }
  return context;
}

/**
 * Hook to optionally access LoroSync functions
 * Returns null if not within a LoroSyncProvider (useful for components that may render outside)
 */
export function useOptionalLoroSyncContext(): LoroSyncContextValue | null {
  return useContext(LoroSyncContext);
}
