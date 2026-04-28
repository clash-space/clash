import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import betterAuthClient from "@clash/web-ui/lib/betterAuthClient";
import Background from "@clash/web-ui/components/Background";

/**
 * /connect-daemon — browser side of the `clash-bridge setup` OAuth flow.
 *
 *   CLI opens this URL with ?cb=http://127.0.0.1:<port>/cb&state=<rand>
 *   - We require the user to be signed in (link to /login otherwise).
 *   - We refuse any cb that isn't http://127.0.0.1:<port>/...; otherwise
 *     a malicious link could trick us into POSTing the auth code somewhere
 *     outside the user's machine.
 *   - On click, POST /api/v1/runtimes/connect-daemon → get one-time code.
 *   - Redirect window.location to `${cb}?code=…&state=…`. The CLI's
 *     localhost server picks up the redirect, exchanges the code for a
 *     runtime token, writes credentials, and installs the launchd plist.
 */

type Status = "loading" | "signin" | "ready" | "authorizing" | "redirecting" | "done" | "error";

function isLocalhostCallback(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:") return false;
    const host = u.hostname;
    return host === "127.0.0.1" || host === "::1" || host === "localhost";
  } catch {
    return false;
  }
}

export default function ConnectDaemonRoute() {
  const [params] = useSearchParams();
  const cb = params.get("cb") ?? "";
  const state = params.get("state") ?? "";
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const session = betterAuthClient.useSession();

  const cbValid = useMemo(() => isLocalhostCallback(cb), [cb]);
  const cbHost = useMemo(() => {
    try { return new URL(cb).host; } catch { return cb; }
  }, [cb]);

  useEffect(() => {
    if (session.isPending) return;
    if (!cb || !state) { setStatus("error"); setError("missing cb or state in URL"); return; }
    if (!cbValid)      { setStatus("error"); setError("callback must be on 127.0.0.1 / localhost"); return; }
    setStatus(session.data?.user ? "ready" : "signin");
  }, [session.data, session.isPending, cb, state, cbValid]);

  const onAllow = async () => {
    setStatus("authorizing");
    try {
      const res = await fetch("/api/v1/runtimes/connect-daemon", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as { code: string };
      const url = new URL(cb);
      url.searchParams.set("code", json.code);
      url.searchParams.set("state", state);
      setStatus("redirecting");
      window.location.replace(url.toString());
      // The CLI will close the localhost server right after receiving the
      // code; if the redirect ever returns control here (it won't on
      // success), show the "you can close this tab" state.
      setTimeout(() => setStatus("done"), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-white relative">
      <Background />
      <div className="relative z-10 flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md w-full bg-white/90 rounded-2xl border border-stone-200 shadow-sm p-8 text-center">
          <h1 className="text-xl font-semibold text-stone-800 mb-2">
            Connect this machine
          </h1>
          <p className="text-sm text-stone-500 mb-6">
            Authorize <code className="px-1 bg-stone-100 rounded">{cbHost || "—"}</code> to
            register this computer as a Clash runtime. Your local agent will appear in the chat panel.
          </p>

          {status === "loading" && <p className="text-sm text-stone-500">Loading…</p>}

          {status === "signin" && (
            <button
              className="rounded-full bg-gray-900 text-white px-6 py-3 text-sm font-medium hover:bg-gray-800"
              onClick={() =>
                betterAuthClient.signIn.social({
                  provider: "google",
                  callbackURL: window.location.href,
                })
              }
            >
              Sign in to continue
            </button>
          )}

          {status === "ready" && (
            <div className="space-y-3">
              <p className="text-xs text-stone-400">
                Signed in as {session.data?.user?.email ?? "?"}
              </p>
              <button
                className="rounded-full bg-gray-900 text-white px-6 py-3 text-sm font-medium hover:bg-gray-800"
                onClick={onAllow}
              >
                Allow this machine
              </button>
            </div>
          )}

          {status === "authorizing" && <p className="text-sm text-stone-500">Issuing code…</p>}
          {status === "redirecting" && (
            <p className="text-sm text-stone-500">
              Redirecting to your terminal — you can close this tab when it confirms.
            </p>
          )}
          {status === "done" && (
            <p className="text-sm text-stone-500">
              All set. You can close this tab.
            </p>
          )}
          {status === "error" && (
            <div className="text-sm text-red-600 break-words">
              <div className="font-medium mb-1">Could not authorize</div>
              <div className="font-mono text-xs">{error}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
