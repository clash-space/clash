/**
 * Typed billing API client — talks to /api/v1/billing/* which the
 * Worker proxies to master-clash-api-hosted.
 */
export interface PlanFeatures {
  storage_mb: number;
  max_projects: number;
  max_resolution: "720p" | "1080p" | "4K";
  max_duration_s: number;
  model_whitelist?: string[];
  commercial: boolean;
}

export interface Plan {
  id: string;
  name: string;
  price_usd_cents: number;
  monthly_credits: number;
  features: PlanFeatures;
}

export interface TopupPack {
  pack_id: string;
  credits: number;
  price_usd_cents: number;
  paddle_price_id: string | null;
  label: string;
}

export interface Balance {
  topup: number;
  grant: number;
  grant_expires_at: number | null;
  hold: number;
  available: number;
}

export interface LedgerEntry {
  id: string;
  user_id: string;
  kind: string;
  amount: number;
  topup_after: number;
  grant_after: number;
  hold_after: number;
  ref_kind: string | null;
  ref_id: string | null;
  model_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: number;
}

export class BillingNotEnabledError extends Error {
  constructor() {
    super("Billing is not enabled on this deployment.");
    this.name = "BillingNotEnabledError";
  }
}

async function fetchJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1/billing${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (res.status === 404) throw new BillingNotEnabledError();
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(`billing: ${msg}`);
  }
  return res.json() as Promise<T>;
}

export const billingApi = {
  plans: () => fetchJSON<{ plans: Plan[]; packs: TopupPack[] }>("/plans"),
  balance: () => fetchJSON<{ balance: Balance }>("/balance"),
  ledger: (limit = 20) => fetchJSON<{ entries: LedgerEntry[] }>(`/ledger?limit=${limit}`),
  checkout: (input: { pack_id?: string; plan_id?: string; email?: string }) =>
    fetchJSON<{ url: string }>("/checkout", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
