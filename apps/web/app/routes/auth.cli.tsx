import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import betterAuthClient from "@clash/web-ui/lib/betterAuthClient";
import Background from "@clash/web-ui/components/Background";
import { createApiToken } from "@clash/web-ui/lib/clientActions";

export default function AuthCliRoute() {
  const [params] = useSearchParams();
  const redirectUri = params.get("redirect_uri") || "";
  const [status, setStatus] = useState<
    "loading" | "signin" | "authorizing" | "done" | "error"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const session = betterAuthClient.useSession();

  useEffect(() => {
    if (session.isPending) return;
    if (!session.data?.user) {
      setStatus("signin");
      return;
    }
    (async () => {
      try {
        setStatus("authorizing");
        const { token } = await createApiToken("CLI");
        if (redirectUri) {
          const url = new URL(redirectUri);
          url.searchParams.set("token", token);
          window.location.replace(url.toString());
        } else {
          setStatus("done");
        }
      } catch (e) {
        setError((e as Error).message);
        setStatus("error");
      }
    })();
  }, [session.data, session.isPending, redirectUri]);

  return (
    <div className="min-h-screen bg-warm-page relative">
      <Background />
      <div className="relative z-10 flex min-h-screen items-center justify-center p-8 text-center">
        <div className="w-full max-w-sm rounded-2xl border border-warm-border bg-warm-surface/95 p-8 shadow-sm backdrop-blur">
          <h1 className="mb-2 font-display text-xl font-semibold tracking-tight text-slate-950">
            Authorize CLI
          </h1>
          {status === "loading" && <p className="text-sm text-stone-500">Loading…</p>}
          {status === "signin" && (
            <button
              className="mt-4 rounded-lg bg-slate-950 text-white px-6 py-3 text-sm font-medium hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
              onClick={() =>
                betterAuthClient.signIn.social({
                  provider: "google",
                  callbackURL: window.location.href,
                })
              }
            >
              Sign in to authorize CLI
            </button>
          )}
          {status === "authorizing" && <p className="text-sm text-stone-500">Creating token…</p>}
          {status === "done" && (
            <p className="text-sm text-stone-600">Token created. You can close this window.</p>
          )}
          {status === "error" && (
            <p className="break-words text-sm text-red-600">Failed: {error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
