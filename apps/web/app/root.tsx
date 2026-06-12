import { ArrowClockwise, House, Warning } from "@phosphor-icons/react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";

type RouteErrorDetails = {
  code: string;
  detail: string;
};

function hasRouteErrorCode(error: unknown): error is { code?: unknown; detail?: unknown; message?: unknown } {
  return Boolean(error && typeof error === "object" && "code" in error);
}

function describeRouteError(error: unknown): RouteErrorDetails {
  if (isRouteErrorResponse(error)) {
    return {
      code: String(error.status),
      detail: error.statusText || "This route returned without a readable status message.",
    };
  }

  if (hasRouteErrorCode(error)) {
    return {
      code: String(error.code ?? "route_error"),
      detail: String(
        error.message ??
        error.detail ??
        "This view stopped before it could describe the failure.",
      ),
    };
  }

  if (error instanceof Error) {
    return {
      code: error.name || "route_error",
      detail: error.message || "This view stopped before it could describe the failure.",
    };
  }

  return {
    code: "route_error",
    detail: "This view stopped before it could describe the failure.",
  };
}

export function HydrateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-warm-page">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-warm-border border-t-slate-950" />
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const { code, detail } = describeRouteError(error);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-warm-page px-6 py-16 text-slate-950">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.32]"
        style={{
          backgroundImage: "radial-gradient(var(--canvas-dot) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 text-brand opacity-[0.024]">
        <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <pattern id="route-error-grid" x="0" y="0" width="400" height="400" patternUnits="userSpaceOnUse">
              <path d="M 200 0 L 200 400" stroke="currentColor" strokeDasharray="4 4" />
              <path d="M 0 200 L 400 200" stroke="currentColor" strokeDasharray="4 4" />
              <circle cx="200" cy="200" r="2" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#route-error-grid)" />
        </svg>
      </div>

      <section className="relative w-full max-w-xl">
        <div className="mb-8 flex items-center gap-3">
          <img src="/brand/logo-mark.svg" alt="Clash" className="h-11 w-11" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Route paused</p>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Clash could not finish this view
            </h1>
          </div>
        </div>

        <div className="rounded-2xl border border-warm-border/80 bg-warm-surface/88 p-5 shadow-[0_18px_48px_rgba(35,31,25,0.08),inset_0_1px_0_rgba(255,255,255,0.78)] backdrop-blur-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand ring-1 ring-brand/20">
              <Warning className="h-5 w-5" weight="fill" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-950">The canvas is still here.</p>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Reload this route to try again, or go home and reopen the project from a fresh surface.
              </p>
            </div>
          </div>

          <dl className="grid gap-3 rounded-xl border border-warm-border/70 bg-warm-muted/55 p-4 text-left">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Code</dt>
              <dd className="mt-1 font-mono text-sm text-slate-950">{code}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Detail</dt>
              <dd className="mt-1 break-words text-sm leading-6 text-stone-700">{detail}</dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
            >
              <ArrowClockwise className="h-4 w-4" weight="bold" aria-hidden="true" />
              Reload
            </button>
            <Link
              to="/"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-warm-border bg-warm-surface px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:border-brand/35 hover:bg-warm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
            >
              <House className="h-4 w-4" weight="bold" aria-hidden="true" />
              Go home
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
