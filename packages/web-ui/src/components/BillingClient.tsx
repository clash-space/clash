/**
 * Billing landing page — credits balance, top-up packs, subscription plans.
 *
 * Reads from /api/v1/billing/* which is mounted by the hosted BillingPlugin.
 * On self-hosted (no plugin) the API returns 404 → we render a neutral
 * "Billing not available" state.
 */
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, CreditCard, Lightning, Lock, Sparkle, Star } from "@phosphor-icons/react";
import {
  type Balance,
  type LedgerEntry,
  type Plan,
  type TopupPack,
  createCheckout,
} from "@clash/web-ui/lib/billingClient";

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
    <div className="min-h-screen bg-warm-page text-slate-950 dark:text-slate-50">
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
    <div className="sticky top-0 z-10 border-b border-warm-border bg-warm-surface/85 backdrop-blur">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
        <Link
          to="/"
          className="text-stone-500 transition-colors hover:text-slate-950 dark:text-stone-400 dark:hover:text-slate-50"
          aria-label="Back to home"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="font-display text-xl font-semibold tracking-tight">Billing</h1>
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
    <section className="rounded-2xl border border-warm-border bg-warm-surface/95 p-8 shadow-sm">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-5xl font-bold tabular-nums tracking-tight text-slate-950 dark:text-slate-50">{available.toLocaleString()}</span>
        <span className="text-lg text-stone-600 dark:text-stone-300">credits available</span>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
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
      <div className="text-xs uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value.toLocaleString()}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{hint}</div>}
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
  const disabled = !pack.paddle_price_id;

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
      className={`text-left rounded-xl border bg-warm-surface/80 p-5 transition-all ${
        disabled
          ? "border-warm-border opacity-50 cursor-not-allowed"
          : "border-warm-border hover:border-brand/45 hover:bg-warm-surface hover:shadow-sm cursor-pointer"
      }`}
    >
      <div className="text-3xl font-bold tabular-nums">${dollars}</div>
      <div className="mt-1 text-sm text-stone-600 dark:text-stone-300">
        {pack.credits.toLocaleString()} credits
      </div>
      {pack.label.includes("bonus") && (
        <div className="mt-2 inline-block rounded-full bg-brand-light text-brand text-xs px-2 py-0.5 font-medium">
          {pack.label.match(/\(([^)]+)\)/)?.[1] ?? "bonus"}
        </div>
      )}
      {disabled && (
        <div className="mt-3 text-xs text-stone-500 flex items-center gap-1">
          <Lock size={12} />
          Setup pending
        </div>
      )}
      {busy && <div className="mt-3 text-xs text-stone-500">Redirecting…</div>}
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
      className={`rounded-xl border p-5 flex flex-col bg-warm-surface/80 ${
        isStudio
          ? "border-brand/55 ring-2 ring-brand/15 bg-brand-light/50"
          : "border-warm-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="font-semibold text-lg">{plan.name}</div>
        {isStudio && <Sparkle size={16} weight="fill" className="text-brand" />}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums">${dollars}</span>
        {!free && <span className="text-sm text-stone-500">/mo</span>}
      </div>
      <div className="mt-1 text-xs text-stone-600 dark:text-stone-300">
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
            ? "bg-warm-muted text-stone-500 cursor-not-allowed"
            : "clash-billing-primary"
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
    <li className="flex items-center gap-2 text-stone-700 dark:text-stone-300">
      <span className="text-brand">✓</span>
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
      <div className="rounded-xl border border-warm-border bg-warm-surface/80 overflow-hidden">
        <div className="divide-y divide-warm-border">
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
        : "text-stone-700 dark:text-stone-300";
  return (
    <div className="px-4 py-3 flex items-center justify-between text-sm">
      <div>
        <div className="font-medium capitalize">{entry.kind}</div>
        <div className="text-xs text-stone-500">
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
      <div className="flex items-center gap-2 text-slate-950 dark:text-slate-50">
        {icon}
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <p className="text-sm text-stone-500 mt-0.5">{subtitle}</p>
    </div>
  );
}

function NotEnabledState() {
  return (
    <div className="min-h-screen bg-warm-page text-slate-950 dark:text-slate-50 flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <Lock size={48} className="mx-auto text-stone-400" />
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Billing not enabled</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-300 text-sm">
          This is a self-hosted deployment without the managed billing plugin.
          Use BYOK API keys directly — no credits required.
        </p>
        <Link
          to="/settings?section=providers"
          className="clash-billing-primary mt-6 inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium"
        >
          Configure providers
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
