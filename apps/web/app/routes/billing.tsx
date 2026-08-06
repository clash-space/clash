import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import BillingClient from "@clash/web-ui/components/BillingClient";
import {
  BillingNotEnabledError,
  fetchBalance,
  fetchLedger,
  fetchPlans,
  fetchProviderUsage,
  type Balance,
  type LedgerEntry,
  type Plan,
  type TopupPack,
  type ProviderUsageAuditEvent,
} from "@clash/web-ui/lib/billingClient";

interface LoaderData {
  balance: Balance | null;
  plans: Plan[];
  packs: TopupPack[];
  ledger: LedgerEntry[];
  notEnabled: boolean;
  providerUsage: ProviderUsageAuditEvent[];
}

export async function loader(_: LoaderFunctionArgs): Promise<LoaderData> {
  const providerUsageResult = await Promise.allSettled([fetchProviderUsage(100)]);
  const providerUsage = providerUsageResult[0]?.status === "fulfilled"
    ? providerUsageResult[0].value.events
    : [];
  // /plans is the cheapest probe — if it 404s, the whole billing API is absent.
  let plans: Plan[] = [];
  let packs: TopupPack[] = [];
  try {
    const r = await fetchPlans();
    plans = r.plans;
    packs = r.packs;
  } catch (e) {
    if (e instanceof BillingNotEnabledError) {
      return { balance: null, plans: [], packs: [], ledger: [], notEnabled: true, providerUsage };
    }
    throw e;
  }

  // Balance + ledger require auth. 401 → /login.
  const [balanceRes, ledgerRes] = await Promise.allSettled([
    fetchBalance(),
    fetchLedger(20),
  ]);

  if (balanceRes.status === "rejected") {
    const err = balanceRes.reason as Error;
    if (err?.message?.includes("401") || err?.message?.includes("Unauthorized")) {
      throw redirect("/login");
    }
  }

  return {
    balance: balanceRes.status === "fulfilled" ? balanceRes.value.balance : null,
    plans,
    packs,
    ledger: ledgerRes.status === "fulfilled" ? ledgerRes.value.entries : [],
    notEnabled: false,
    providerUsage,
  };
}

export default function BillingRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <BillingClient
      balance={data.balance}
      plans={data.plans}
      packs={data.packs}
      ledger={data.ledger}
      notEnabled={data.notEnabled}
      providerUsage={data.providerUsage}
    />
  );
}
