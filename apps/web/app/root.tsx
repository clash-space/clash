import { isRouteErrorResponse, useRouteError } from "react-router";

export function HydrateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-warm-page">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-warm-border border-t-slate-950" />
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unknown error";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-warm-page p-8 text-center">
      <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
      <p className="text-stone-600">{message}</p>
    </main>
  );
}
