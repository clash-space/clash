import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "framer-motion";
import { GoogleLogo } from "@phosphor-icons/react";
import betterAuthClient from "@clash/web-ui/lib/betterAuthClient";
import Background from "@clash/web-ui/components/Background";
import { Button } from "@clash/web-ui/components/ui/button";
import { Input } from "@clash/web-ui/components/ui/input";

type Stage = "email" | "otp" | "password";
type PwAction = "signin" | "signup";

function canonicalLocalAuthUrl(path: string): string | null {
  if (typeof window === "undefined") return null;
  if (window.location.protocol !== "http:") return null;
  if (window.location.hostname !== "127.0.0.1" && window.location.hostname !== "::1") return null;
  return `http://localhost:${window.location.port || "80"}${path}`;
}

const authInputClass =
  "clash-auth-input w-full rounded-2xl px-5 py-3 text-base text-slate-950 placeholder:text-stone-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500";
const authPrimaryClass =
  "clash-auth-primary flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-base font-semibold disabled:cursor-not-allowed";
const authSecondaryClass =
  "clash-auth-secondary flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-base font-medium disabled:cursor-not-allowed";
const authTextButtonClass =
  "text-stone-600 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page dark:text-neutral-400";
const authInlineLinkClass =
  "font-medium text-slate-950 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page dark:text-neutral-100";

export default function LoginRoute() {
  const [stage, setStage] = useState<Stage>("email");
  const [pwAction, setPwAction] = useState<PwAction>("signin");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const navigate = useNavigate();
  const session = betterAuthClient.useSession();
  const otpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const canonical = canonicalLocalAuthUrl(currentPath);
    if (canonical) window.location.replace(canonical);
  }, []);

  useEffect(() => {
    if (session.data?.user) navigate("/", { replace: true });
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
      const { error: err } = await (betterAuthClient as any).emailOtp.sendVerificationOtp({
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
      const { error: err } = await (betterAuthClient as any).signIn.emailOtp({
        email,
        otp,
      });
      if (err) throw new Error(err.message || "Invalid code");
      navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setIsLoading(false);
    }
  };

  const handlePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setIsLoading(true);
    try {
      if (pwAction === "signin") {
        const { error: err } = await betterAuthClient.signIn.email({
          email,
          password,
        });
        if (err) throw new Error(err.message || "Sign in failed");
      } else {
        const { error: err } = await betterAuthClient.signUp.email({
          email,
          password,
          name: name || email.split("@")[0],
        });
        if (err) throw new Error(err.message || "Sign up failed");
      }
      navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const canonical = canonicalLocalAuthUrl("/login");
      if (canonical) {
        window.location.href = canonical;
        return;
      }
      await betterAuthClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
    } catch (e) {
      setError((e as Error).message);
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 py-12">
      <Background />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="clash-auth-panel relative z-10 w-full max-w-[440px] rounded-[28px] px-6 py-7 sm:px-8 sm:py-8"
      >
        <div className="mb-8 text-center">
          <Link to="/" className="group mb-6 inline-block">
            <motion.div
              className="flex items-center justify-center gap-2.5"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <span className="relative block h-10 w-10">
                <img
                  src="/brand/logo-c.svg"
                  alt=""
                  className="h-10 w-10 object-contain dark:hidden"
                  draggable={false}
                />
                <img
                  src="/brand/logo-c.svg"
                  alt=""
                  className="hidden h-10 w-10 object-contain dark:block"
                  draggable={false}
                />
              </span>
              <span className="font-display text-2xl font-semibold leading-none text-slate-950 dark:text-neutral-50">
                Clash
              </span>
            </motion.div>
          </Link>
          <h1 className="mb-2 font-display text-2xl font-bold text-slate-950 dark:text-neutral-50">
            {stage === "otp"
              ? "Check your email"
              : stage === "password"
                ? pwAction === "signin"
                  ? "Welcome back"
                  : "Create account"
                : "Welcome"}
          </h1>
          <p className="text-stone-600 dark:text-neutral-400">
            {stage === "otp"
              ? `We sent a 6-digit code to ${email}`
              : stage === "password"
                ? pwAction === "signin"
                  ? "Sign in with your email and password"
                  : "Pick an email and password to get started"
                : "Sign in or create an account with your email"}
          </p>
        </div>

        {error && (
          <div className="clash-auth-alert clash-auth-alert-error mb-4 rounded-2xl px-4 py-3 text-sm">
            {error}
          </div>
        )}
        {info && !error && (
          <div className="clash-auth-alert clash-auth-alert-info mb-4 rounded-2xl px-4 py-3 text-sm">
            {info}
          </div>
        )}

        {stage === "email" ? (
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className={authInputClass}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={isLoading || !email}
              className={authPrimaryClass}
            >
              {isLoading && (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{isLoading ? "Sending code..." : "Send code"}</span>
            </Button>
            <Button
              onClick={() => {
                setStage("password");
                setError(null);
                setInfo(null);
              }}
              className={`${authTextButtonClass} min-h-0 w-full border-0 bg-transparent px-0 pb-0 pt-2 text-center text-sm shadow-none hover:bg-transparent`}
            >
              Use password instead →
            </Button>
          </form>
        ) : stage === "password" ? (
          <form onSubmit={handlePassword} className="space-y-3">
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className={authInputClass}
            />
            {pwAction === "signup" && (
              <Input
                type="text"
                placeholder="Display name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className={authInputClass}
              />
            )}
            <Input
              type="password"
              placeholder="Password (min 8 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={pwAction === "signin" ? "current-password" : "new-password"}
              minLength={8}
              required
              className={authInputClass}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={isLoading || !email || password.length < 8}
              className={authPrimaryClass}
            >
              {isLoading && (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>
                {isLoading
                  ? pwAction === "signin" ? "Signing in..." : "Creating..."
                  : pwAction === "signin" ? "Sign in" : "Create account"}
              </span>
            </Button>

            <div className="flex items-center justify-between pt-2 text-sm">
              <Button
                onClick={() => {
                  setStage("email");
                  setPassword("");
                  setName("");
                  setError(null);
                  setInfo(null);
                }}
                className={`${authTextButtonClass} min-h-0 border-0 bg-transparent p-0 shadow-none hover:bg-transparent`}
              >
                ← Use email code
              </Button>
              <Button
                onClick={() => {
                  setPwAction((a) => (a === "signin" ? "signup" : "signin"));
                  setError(null);
                }}
                className={`${authInlineLinkClass} min-h-0 border-0 bg-transparent p-0 shadow-none hover:bg-transparent`}
              >
                {pwAction === "signin" ? "Create account" : "Have an account?"}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-3">
            <Input
              ref={otpInputRef}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="6-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              autoComplete="one-time-code"
              required
              className={`${authInputClass} text-center font-mono text-xl tracking-[0.4em]`}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={isLoading || otp.length !== 6}
              className={authPrimaryClass}
            >
              {isLoading && (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{isLoading ? "Verifying..." : "Verify & continue"}</span>
            </Button>

            <div className="flex items-center justify-between pt-2 text-sm">
              <Button
                onClick={() => {
                  setStage("email");
                  setOtp("");
                  setError(null);
                  setInfo(null);
                }}
                className={`${authTextButtonClass} min-h-0 border-0 bg-transparent p-0 shadow-none hover:bg-transparent`}
              >
                ← Change email
              </Button>
              <Button
                disabled={isLoading || secondsUntilResend > 0}
                onClick={() => sendCode(true)}
                className={`${authInlineLinkClass} min-h-0 border-0 bg-transparent p-0 shadow-none hover:bg-transparent disabled:cursor-not-allowed disabled:text-stone-400`}
              >
                {secondsUntilResend > 0
                  ? `Resend in ${secondsUntilResend}s`
                  : "Resend code"}
              </Button>
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

        <Button
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className={authSecondaryClass}
        >
          <GoogleLogo weight="bold" className="h-5 w-5" />
          <span>Continue with Google</span>
        </Button>

        <p className="mt-6 text-center text-xs text-stone-500 dark:text-neutral-500">
          By continuing, you agree to our{" "}
          <Link to="/terms" className={authInlineLinkClass}>
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className={authInlineLinkClass}>
            Privacy Policy
          </Link>
          .
        </p>
      </motion.div>
    </div>
  );
}
