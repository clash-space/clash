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
    <div className="min-h-screen bg-white relative">
      <Background />
      <div className="relative z-10 flex min-h-screen items-center justify-center p-8 text-center">
        {status === "loading" && <p>Loading…</p>}
        {status === "signin" && (
          <button
            className="rounded-full bg-gray-900 text-white px-6 py-3"
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
        {status === "authorizing" && <p>Creating token…</p>}
        {status === "done" && (
          <p>Token created. You can close this window.</p>
        )}
        {status === "error" && (
          <p className="text-red-600">Failed: {error}</p>
        )}
      </div>
    </div>
  );
}
