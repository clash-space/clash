import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import BillingClient from "@clash/web-ui/components/BillingClient";
import {
  BillingNotEnabledError,
  fetchBalance,
  fetchLedger,
  fetchPlans,
  type Balance,
  type LedgerEntry,
  type Plan,
  type TopupPack,
} from "@clash/web-ui/lib/billingClient";

interface LoaderData {
  balance: Balance | null;
  plans: Plan[];
  packs: TopupPack[];
  ledger: LedgerEntry[];
  notEnabled: boolean;
}

export async function loader(_: LoaderFunctionArgs): Promise<LoaderData> {
  // /plans is the cheapest probe — if it 404s, the whole billing API is absent.
  let plans: Plan[] = [];
  let packs: TopupPack[] = [];
  try {
    const r = await fetchPlans();
    plans = r.plans;
    packs = r.packs;
  } catch (e) {
    if (e instanceof BillingNotEnabledError) {
      return { balance: null, plans: [], packs: [], ledger: [], notEnabled: true };
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
    />
  );
}
