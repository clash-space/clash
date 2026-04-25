/**
 * Billing landing page — credits balance, top-up packs, subscription plans.
 *
 * Reads from /api/v1/billing/* which is mounted by the hosted BillingPlugin.
 * On self-hosted (no plugin) the API returns 404 → we render a neutral
 * "Billing not available" state.
 */
import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CreditCard, Lightning, Lock, Sparkle, Star } from "@phosphor-icons/react";
import {
  type Balance,
  type LedgerEntry,
  type Plan,
  type TopupPack,
  createCheckout,
} from "../lib/billing-client";

interface Props {
  balance: Balance | null;
  plans: Plan[];
  packs: TopupPack[];
  ledger: LedgerEntry[];
  /** True when /api/v1/billing/* returned 404 — billing isn't installed. */
  notEnabled: boolean;
}

export default function BillingClient({ balance, plans, packs, ledger, notEnabled }: Props) {
  if (notEnabled) {
    return <NotEnabledState />;
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50">
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">
        <BalanceCard balance={balance} />
        <TopupSection packs={packs} />
        <PlansSection plans={plans} />
        {ledger.length > 0 && <LedgerSection entries={ledger} />}
      </div>
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────────────

function Header() {
  return (
    <div className="border-b border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/70 backdrop-blur sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
        <Link
          to="/"
          className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-50 transition-colors"
          aria-label="Back to home"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-semibold">Billing</h1>
      </div>
    </div>
  );
}

// ─── Balance ───────────────────────────────────────────────────────────

function BalanceCard({ balance }: { balance: Balance | null }) {
  const available = balance?.available ?? 0;
  const grant = balance?.grant ?? 0;
  const topup = balance?.topup ?? 0;
  const hold = balance?.hold ?? 0;

  return (
    <section className="rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-8 text-white shadow-lg">
      <div className="flex items-baseline gap-3">
        <span className="text-5xl font-bold tabular-nums">{available.toLocaleString()}</span>
        <span className="text-lg opacity-80">credits available</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4 text-sm opacity-90">
        <Stat label="Monthly grant" value={grant} hint={balance?.grant_expires_at ? `resets ${formatDate(balance.grant_expires_at)}` : undefined} />
        <Stat label="Top-up balance" value={topup} hint="never expires" />
        <Stat label="In-flight" value={hold} hint="reserved by tasks" />
      </div>
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

// ─── Top-up packs ──────────────────────────────────────────────────────

function TopupSection({ packs }: { packs: TopupPack[] }) {
  return (
    <section>
      <SectionHeader
        icon={<Lightning size={20} weight="fill" />}
        title="Top up"
        subtitle="Credits never expire. Use them on any model."
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {packs.map((p) => <PackCard key={p.pack_id} pack={p} />)}
      </div>
    </section>
  );
}

function PackCard({ pack }: { pack: TopupPack }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const disabled = !pack.ls_variant_id;

  const handle = useCallback(async () => {
    if (disabled || busy) return;
    setErr(null);
    setBusy(true);
    try {
      const { url } = await createCheckout({ pack_id: pack.pack_id });
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [pack.pack_id, disabled, busy]);

  const dollars = (pack.price_usd_cents / 100).toFixed(0);

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
      {pack.label.includes("bonus") && (
        <div className="mt-2 inline-block rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-xs px-2 py-0.5 font-medium">
          {pack.label.match(/\(([^)]+)\)/)?.[1] ?? "bonus"}
        </div>
      )}
      {disabled && (
        <div className="mt-3 text-xs text-neutral-500 flex items-center gap-1">
          <Lock size={12} />
          Setup pending
        </div>
      )}
      {busy && <div className="mt-3 text-xs text-neutral-500">Redirecting…</div>}
      {err && <div className="mt-3 text-xs text-red-500">{err}</div>}
    </button>
  );
}

// ─── Plans ─────────────────────────────────────────────────────────────

function PlansSection({ plans }: { plans: Plan[] }) {
  return (
    <section>
      <SectionHeader
        icon={<Star size={20} weight="fill" />}
        title="Subscription plans"
        subtitle="Monthly grant + platform features. Cancel anytime."
      />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {plans.map((p) => <PlanCard key={p.id} plan={p} />)}
      </div>
    </section>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const free = plan.price_usd_cents === 0;
  const disabled = free; // free plan has no checkout — assigned automatically.

  const handle = useCallback(async () => {
    if (disabled || busy) return;
    setErr(null);
    setBusy(true);
    try {
      const { url } = await createCheckout({ plan_id: plan.id });
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [plan.id, disabled, busy]);

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
      <div className="flex items-center justify-between">
        <div className="font-semibold text-lg">{plan.name}</div>
        {isStudio && <Sparkle size={16} weight="fill" className="text-indigo-500" />}
      </div>
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

// ─── Ledger ────────────────────────────────────────────────────────────

function LedgerSection({ entries }: { entries: LedgerEntry[] }) {
  return (
    <section>
      <SectionHeader
        icon={<CreditCard size={20} weight="fill" />}
        title="Recent activity"
        subtitle="Last 20 credit movements."
      />
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {entries.map((e) => <LedgerRow key={e.id} entry={e} />)}
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

// ─── Misc ──────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 text-neutral-900 dark:text-neutral-50">
        {icon}
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <p className="text-sm text-neutral-500 mt-0.5">{subtitle}</p>
    </div>
  );
}

function NotEnabledState() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50 flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <Lock size={48} className="mx-auto text-neutral-400" />
        <h1 className="text-2xl font-semibold mt-4">Billing not enabled</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400 text-sm">
          This is a self-hosted deployment without the managed billing plugin.
          Use BYOK API keys directly — no credits required.
        </p>
        <Link
          to="/settings"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-neutral-900 dark:bg-neutral-50 dark:text-neutral-900 text-white px-5 py-2.5 text-sm font-medium hover:opacity-90"
        >
          Configure API keys
        </Link>
      </div>
    </div>
  );
}

function formatDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
