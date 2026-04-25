import { useEffect } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";
import { useSession } from "../lib/use-session";

/**
 * Landing route. Client-side redirect to /billing once we know the user
 * is signed in (the canonical authed home for now until /projects ports).
 */
export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.user?.id) {
      void navigate({ to: "/billing" });
    }
  }, [session, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
      <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-br from-indigo-500 to-purple-600 bg-clip-text text-transparent">
        Clash
      </h1>
      <p className="mt-3 text-lg text-neutral-600 dark:text-neutral-400 max-w-md">
        AI-powered video production. Bring your own keys, use credits, or both.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          to="/login"
          className="rounded-lg bg-neutral-900 dark:bg-neutral-50 dark:text-neutral-900 text-white px-6 py-3 text-sm font-medium hover:opacity-90"
        >
          Sign in
        </Link>
        <a
          href="https://github.com/clash-space/clash"
          className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-6 py-3 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          GitHub
        </a>
      </div>
    </div>
  );
}
