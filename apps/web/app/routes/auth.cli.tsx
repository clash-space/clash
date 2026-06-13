import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import betterAuthClient from "@clash/web-ui/lib/betterAuthClient";
import Background from "@clash/web-ui/components/Background";
import { createApiToken } from "@clash/web-ui/lib/clientActions";

const authPanelClass =
  "clash-auth-panel w-full max-w-sm rounded-[28px] px-6 py-7 text-center sm:px-8 sm:py-8";
const authPrimaryClass =
  "clash-auth-primary mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl px-6 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page";

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
    <div className="relative min-h-screen bg-warm-page">
      <Background />
      <div className="relative z-10 flex min-h-screen items-center justify-center p-8 text-center">
        <div className={authPanelClass}>
          <h1 className="mb-2 font-display text-xl font-semibold tracking-tight text-slate-950">
            Authorize CLI
          </h1>
          {status === "loading" && <p className="text-sm text-stone-500">Loading…</p>}
          {status === "signin" && (
            <button
              className={authPrimaryClass}
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
            <div className="clash-auth-alert clash-auth-alert-error mt-4 break-words rounded-2xl px-4 py-3 text-sm">
              <div className="mb-1 font-medium">Could not authorize CLI</div>
              <div className="font-mono text-xs">{error}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
