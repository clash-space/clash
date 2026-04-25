import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { billingApi, BillingNotEnabledError, type LedgerEntry, type Plan, type TopupPack, type Balance } from "../lib/billing-client";

/**
 * /billing — under _app so the auth guard runs upstream.
 *
 * Three queries: plans (public), balance (auth), ledger (auth). All
 * served via TanStack Query so a soft refresh re-uses cached data.
 * Checkout is a mutation that redirects on success.
 */
export const Route = createFileRoute("/_app/billing")({
  // Plans are public; balance + ledger need auth which the parent _app
  // route guards. We don't prefetch here since the auth gate is client-side
  // (cookies don't ride through SSR by default in Better Auth) — the
  // useQuery calls below run on hydration.
  component: BillingPage,
});

function BillingPage() {
  const plansQ = useQuery({ queryKey: ["billing", "plans"], queryFn: billingApi.plans });
  const balanceQ = useQuery({ queryKey: ["billing", "balance"], queryFn: billingApi.balance });
  const ledgerQ = useQuery({ queryKey: ["billing", "ledger"], queryFn: () => billingApi.ledger(20) });

  if (plansQ.error instanceof BillingNotEnabledError) {
    return <NotEnabledState />;
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
      <BalanceCard balance={balanceQ.data?.balance} loading={balanceQ.isLoading} />
      {plansQ.data && (
        <>
          <TopupSection packs={plansQ.data.packs} />
          <PlansSection plans={plansQ.data.plans} />
        </>
      )}
      {ledgerQ.data?.entries && ledgerQ.data.entries.length > 0 && (
        <LedgerSection entries={ledgerQ.data.entries} />
      )}
    </div>
  );
}

function BalanceCard({ balance, loading }: { balance: Balance | undefined; loading: boolean }) {
  const available = balance?.available ?? 0;
  return (
    <section className="rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-8 text-white shadow-lg">
      <div className="flex items-baseline gap-3">
        <span className="text-5xl font-bold tabular-nums">
          {loading ? "—" : available.toLocaleString()}
        </span>
        <span className="text-lg opacity-80">credits available</span>
      </div>
      {balance && (
        <div className="mt-4 grid grid-cols-3 gap-4 text-sm opacity-90">
          <Stat label="Monthly grant" value={balance.grant} hint={balance.grant_expires_at ? `resets ${formatDate(balance.grant_expires_at)}` : undefined} />
          <Stat label="Top-up balance" value={balance.topup} hint="never expires" />
          <Stat label="In flight" value={balance.hold} hint="reserved by tasks" />
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <div className="opacity-70 text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      {hint && <div className="text-xs opacity-60 mt-0.5">{hint}</div>}
    </div>
  );
}

function TopupSection({ packs }: { packs: TopupPack[] }) {
  return (
    <section>
      <SectionHeader title="Top up" subtitle="Credits never expire. Use them on any model." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {packs.map((p) => (
          <PackCard key={p.pack_id} pack={p} />
        ))}
      </div>
    </section>
  );
}

function PackCard({ pack }: { pack: TopupPack }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const disabled = !pack.paddle_price_id;

  async function handle() {
    if (disabled || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { url } = await billingApi.checkout({ pack_id: pack.pack_id });
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const dollars = (pack.price_usd_cents / 100).toFixed(0);
  const bonus = pack.label.match(/\(([^)]+)\)/)?.[1];

  return (
    <button
      onClick={handle}
      disabled={disabled || busy}
      className={`text-left rounded-xl border p-5 transition-all ${
        disabled
          ? "border-neutral-200 dark:border-neutral-800 opacity-50 cursor-not-allowed"
          : "border-neutral-200 dark:border-neutral-800 hover:border-indigo-500 hover:shadow-md cursor-pointer"
      }`}
    >
      <div className="text-3xl font-bold tabular-nums">${dollars}</div>
      <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {pack.credits.toLocaleString()} credits
      </div>
      {bonus && (
        <div className="mt-2 inline-block rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-xs px-2 py-0.5 font-medium">
          {bonus}
        </div>
      )}
      {disabled && (
        <div className="mt-3 text-xs text-neutral-500">Setup pending</div>
      )}
      {busy && <div className="mt-3 text-xs text-neutral-500">Redirecting…</div>}
      {err && <div className="mt-3 text-xs text-red-500">{err}</div>}
    </button>
  );
}

function PlansSection({ plans }: { plans: Plan[] }) {
  return (
    <section>
      <SectionHeader title="Subscription plans" subtitle="Monthly credit grant + platform features. Cancel anytime." />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} />
        ))}
      </div>
    </section>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const free = plan.price_usd_cents === 0;
  const disabled = free;

  async function handle() {
    if (disabled || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { url } = await billingApi.checkout({ plan_id: plan.id });
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const dollars = (plan.price_usd_cents / 100).toFixed(0);
  const isStudio = plan.id === "studio";

  return (
    <div
      className={`rounded-xl border p-5 flex flex-col ${
        isStudio
          ? "border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/30 dark:bg-indigo-950/20"
          : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="font-semibold text-lg">{plan.name}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums">${dollars}</span>
        {!free && <span className="text-sm text-neutral-500">/mo</span>}
      </div>
      <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        {plan.monthly_credits.toLocaleString()} credits / month
      </div>
      <ul className="mt-4 space-y-1.5 text-sm flex-1">
        <Feature value={`${(plan.features.storage_mb / 1024).toFixed(plan.features.storage_mb < 1024 ? 1 : 0)} GB storage`} />
        <Feature value={`${plan.features.max_projects} project${plan.features.max_projects === 1 ? "" : "s"}`} />
        <Feature value={`Up to ${plan.features.max_resolution}`} />
        <Feature value={`Up to ${plan.features.max_duration_s}s clips`} />
        {plan.features.commercial && <Feature value="Commercial use" />}
      </ul>
      <button
        onClick={handle}
        disabled={disabled || busy}
        className={`mt-5 w-full rounded-lg py-2.5 text-sm font-medium transition-colors ${
          disabled
            ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 cursor-not-allowed"
            : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-200"
        }`}
      >
        {free ? "Default plan" : busy ? "Redirecting…" : "Choose"}
      </button>
      {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
    </div>
  );
}

function Feature({ value }: { value: string }) {
  return (
    <li className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
      <span className="text-emerald-500">✓</span>
      {value}
    </li>
  );
}

function LedgerSection({ entries }: { entries: LedgerEntry[] }) {
  return (
    <section>
      <SectionHeader title="Recent activity" subtitle="Last 20 credit movements." />
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {entries.map((e) => (
            <LedgerRow key={e.id} entry={e} />
          ))}
        </div>
      </div>
    </section>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const sign = entry.amount > 0 ? "+" : "";
  const color =
    entry.amount > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : entry.kind === "hold"
        ? "text-amber-600 dark:text-amber-400"
        : "text-neutral-700 dark:text-neutral-300";
  return (
    <div className="px-4 py-3 flex items-center justify-between text-sm">
      <div>
        <div className="font-medium capitalize">{entry.kind}</div>
        <div className="text-xs text-neutral-500">
          {formatDateTime(entry.created_at)}
          {entry.model_id && ` · ${entry.model_id}`}
        </div>
      </div>
      <div className={`tabular-nums font-medium ${color}`}>
        {sign}
        {entry.amount.toLocaleString()}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-neutral-500 mt-0.5">{subtitle}</p>
    </div>
  );
}

function NotEnabledState() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">Billing not enabled</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400 text-sm">
          This deployment isn't running the billing plugin. Configure
          BYOK API keys in your project settings to use the platform.
        </p>
      </div>
    </div>
  );
}

function formatDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
