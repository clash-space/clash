import { useEffect, useState } from 'react';
import {
  BillingNotEnabledError,
  fetchBalance,
  type Balance,
} from '@clash/web-ui/lib/billingClient';

export type BillingBalanceState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'unauthenticated' }
  | { status: 'ready'; balance: Balance }
  | { status: 'error'; message: string };

export function useBillingBalance(enabled: boolean): BillingBalanceState {
  const [state, setState] = useState<BillingBalanceState>(
    enabled ? { status: 'loading' } : { status: 'unauthenticated' },
  );

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'unauthenticated' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    fetchBalance()
      .then(({ balance }) => {
        if (!cancelled) setState({ status: 'ready', balance });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof BillingNotEnabledError) {
          setState({ status: 'unavailable' });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
          setState({ status: 'unauthenticated' });
          return;
        }
        setState({ status: 'error', message: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}
