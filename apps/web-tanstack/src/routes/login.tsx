import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { GoogleLogo } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";
import Background from "../landing/Background";

type Stage = "email" | "otp";

function LoginRoute() {
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const navigate = useNavigate();
  const session = authClient.useSession();
  const otpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session.data?.user) navigate({ to: "/", replace: true });
  }, [session.data, navigate]);

  // tick once a second to update the resend countdown
  useEffect(() => {
    if (stage !== "otp") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage]);

  useEffect(() => {
    if (stage === "otp") otpInputRef.current?.focus();
  }, [stage]);

  const secondsUntilResend = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const sendCode = async (resend = false) => {
    setError(null);
    setInfo(null);
    setIsLoading(true);
    try {
      const { error: err } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (err) throw new Error(err.message || "Failed to send code");
      setStage("otp");
      setResendAt(Date.now() + 60_000);
      setInfo(
        resend
          ? "Code re-sent. Check the vite console in dev."
          : "Code sent. Check the vite console in dev (or your inbox when email is configured).",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await sendCode(false);
  };

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setIsLoading(true);
    try {
      const { error: err } = await authClient.signIn.emailOtp({
        email,
        otp,
      });
      if (err) throw new Error(err.message || "Invalid code");
      navigate({ to: "/", replace: true });
    } catch (e) {
      setError((e as Error).message);
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
    } catch (e) {
      setError((e as Error).message);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-warm-page relative overflow-hidden">
      <Background />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md px-8 relative z-10"
      >
        <div className="mb-8 text-center">
          <Link to="/" className="inline-block group mb-6">
            <motion.div
              className="flex items-center justify-center gap-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <span className="font-display text-5xl font-bold tracking-tighter text-slate-950 leading-none">
                Clash
              </span>
              <div className="h-10 w-[7px] bg-brand -skew-x-[20deg] transform origin-center" />
            </motion.div>
          </Link>
          <h1 className="font-display text-2xl font-bold text-slate-950 mb-2">
            {stage === "otp" ? "Check your email" : "Welcome"}
          </h1>
          <p className="text-stone-600">
            {stage === "otp"
              ? `We sent a 6-digit code to ${email}`
              : "Sign in or create an account with your email"}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {info && !error && (
          <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
            {info}
          </div>
        )}

        {stage === "email" ? (
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="w-full rounded-full border border-warm-border bg-warm-surface px-5 py-3 text-base focus:border-brand/70 focus:outline-none"
            />
            <motion.button
              type="submit"
              disabled={isLoading || !email}
              className="flex w-full items-center justify-center gap-3 rounded-full bg-slate-950 px-6 py-4 text-base font-medium text-white shadow-sm shadow-slate-950/10 transition-all hover:bg-slate-800 disabled:opacity-70 disabled:cursor-not-allowed"
              whileHover={!isLoading ? { scale: 1.02 } : {}}
              whileTap={!isLoading ? { scale: 0.98 } : {}}
            >
              {isLoading && (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{isLoading ? "Sending code..." : "Send code"}</span>
            </motion.button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-3">
            <input
              ref={otpInputRef}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="6-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              autoComplete="one-time-code"
              required
              className="w-full rounded-full border border-warm-border bg-warm-surface px-5 py-3 text-center text-xl tracking-[0.4em] font-mono focus:border-brand/70 focus:outline-none"
            />
            <motion.button
              type="submit"
              disabled={isLoading || otp.length !== 6}
              className="flex w-full items-center justify-center gap-3 rounded-full bg-slate-950 px-6 py-4 text-base font-medium text-white shadow-sm shadow-slate-950/10 transition-all hover:bg-slate-800 disabled:opacity-70 disabled:cursor-not-allowed"
              whileHover={!isLoading && otp.length === 6 ? { scale: 1.02 } : {}}
              whileTap={!isLoading && otp.length === 6 ? { scale: 0.98 } : {}}
            >
              {isLoading && (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{isLoading ? "Verifying..." : "Verify & continue"}</span>
            </motion.button>

            <div className="flex items-center justify-between pt-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  setStage("email");
                  setOtp("");
                  setError(null);
                  setInfo(null);
                }}
                className="text-stone-500 hover:text-slate-950"
              >
                ← Change email
              </button>
              <button
                type="button"
                disabled={isLoading || secondsUntilResend > 0}
                onClick={() => sendCode(true)}
                className="text-slate-950 hover:underline disabled:text-stone-400 disabled:no-underline disabled:cursor-not-allowed"
              >
                {secondsUntilResend > 0
                  ? `Resend in ${secondsUntilResend}s`
                  : "Resend code"}
              </button>
            </div>
          </form>
        )}

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-warm-border" />
          <span className="text-xs uppercase tracking-wide text-stone-400">
            or
          </span>
          <div className="h-px flex-1 bg-warm-border" />
        </div>

        <motion.button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-3 rounded-full border border-warm-border bg-warm-surface px-6 py-4 text-base font-medium text-slate-950 transition-all hover:bg-white disabled:opacity-70 disabled:cursor-not-allowed"
          whileHover={!isLoading ? { scale: 1.02 } : {}}
          whileTap={!isLoading ? { scale: 0.98 } : {}}
        >
          <GoogleLogo weight="bold" className="h-5 w-5" />
          <span>Continue with Google</span>
        </motion.button>

        <p className="mt-6 text-center text-xs text-stone-500">
          By continuing, you agree to our{" "}
          <Link to="/terms" className="font-medium text-slate-950 hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="font-medium text-slate-950 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </motion.div>
    </div>
  );
}

export const Route = createFileRoute("/login")({ component: LoginRoute });
