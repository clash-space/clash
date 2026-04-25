/**
 * Billing route — UI from OSS apps/web's BillingClient (verbatim port,
 * 356 LOC). Data fetching adapted to TanStack Query.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BillingNotEnabledError,
  fetchPlans,
  fetchBalance,
  fetchLedger,
} from "../lib/billing-client";
import BillingClient from "@clash/web-ui/components/BillingClient";

export const Route = createFileRoute("/_app/billing")({
  component: BillingPage,
});

function BillingPage() {
  const plansQ = useQuery({ queryKey: ["billing", "plans"], queryFn: fetchPlans });
  const balanceQ = useQuery({
    queryKey: ["billing", "balance"],
    queryFn: fetchBalance,
    enabled: typeof window !== "undefined",
  });
  const ledgerQ = useQuery({
    queryKey: ["billing", "ledger"],
    queryFn: () => fetchLedger(20),
    enabled: typeof window !== "undefined",
  });

  const notEnabled = plansQ.error instanceof BillingNotEnabledError;

  return (
    <BillingClient
      balance={balanceQ.data?.balance ?? null}
      plans={plansQ.data?.plans ?? []}
      packs={plansQ.data?.packs ?? []}
      ledger={ledgerQ.data?.entries ?? []}
      notEnabled={notEnabled}
    />
  );
}
