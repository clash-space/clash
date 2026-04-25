import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";
import { useSession } from "../lib/use-session";

/**
 * Email-OTP sign-in. Two stages held in local state:
 *   "email" — collect email, request OTP via emailOtp.sendVerificationOtp
 *   "otp"   — collect 6-digit code, signIn.emailOtp completes the session
 *
 * On success we navigate to /billing.
 */
export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.user?.id) {
      void navigate({ to: "/billing" });
    }
  }, [session, navigate]);

  const [stage, setStage] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to send code");
      setStage("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.emailOtp({ email, otp });
      if (res.error) throw new Error(res.error.message ?? "Invalid code");
      await navigate({ to: "/billing" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function signInGoogle() {
    setBusy(true);
    setError(null);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: "/billing",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-1">Sign in to Clash</h1>
        <p className="text-sm text-neutral-500 text-center mb-8">
          {stage === "email" ? "We'll email you a code." : `Enter the 6-digit code sent to ${email}.`}
        </p>

        {stage === "email" ? (
          <form onSubmit={requestOtp} className="space-y-3">
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-neutral-900 dark:bg-neutral-50 dark:text-neutral-900 text-white py-2.5 text-sm font-medium disabled:opacity-50 hover:opacity-90"
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-3">
            <input
              type="text"
              required
              autoFocus
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-2.5 text-sm text-center tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={busy || otp.length !== 6}
              className="w-full rounded-lg bg-neutral-900 dark:bg-neutral-50 dark:text-neutral-900 text-white py-2.5 text-sm font-medium disabled:opacity-50 hover:opacity-90"
            >
              {busy ? "Verifying…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStage("email");
                setOtp("");
                setError(null);
              }}
              className="w-full text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              ← Use a different email
            </button>
          </form>
        )}

        {error && (
          <div className="mt-3 text-xs text-red-500 text-center">{error}</div>
        )}

        <div className="mt-6 flex items-center gap-3 text-xs text-neutral-400">
          <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-800" />
          or
          <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-800" />
        </div>

        <button
          onClick={signInGoogle}
          disabled={busy}
          className="mt-4 w-full rounded-lg border border-neutral-200 dark:border-neutral-800 py-2.5 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
