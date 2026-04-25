import { useEffect } from "react";
import { Outlet, Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";
import { useSession } from "../lib/use-session";

/**
 * Pathless layout for authenticated routes. Anything under here gets the
 * top nav and an "must be signed in" client-side redirect.
 *
 * Auth check runs client-side only (no SSR session check) — Better Auth's
 * cookies aren't forwarded through Start's SSR fetch by default. The cost
 * is one extra render: server emits the page shell, client mounts, query
 * resolves, redirect kicks in if no session. Cheap enough that polishing
 * SSR auth is a separate, larger project.
 */
export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function useSessionQuery() {
  return useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      const { data } = await authClient.getSession();
      return data ?? null;
    },
    staleTime: 30_000,
  });
}

function AppLayout() {
  const navigate = useNavigate();
  const { data: session, isPending } = useSessionQuery();

  useEffect(() => {
    if (!isPending && !session?.user?.id) {
      void navigate({ to: "/login" });
    }
  }, [isPending, session, navigate]);

  if (isPending) {
    return <Centered>Loading…</Centered>;
  }
  if (!session?.user?.id) {
    return <Centered>Redirecting…</Centered>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav userEmail={session.user.email ?? ""} />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">
      {children}
    </div>
  );
}

function TopNav({ userEmail }: { userEmail: string }) {
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/70 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link to="/" className="font-semibold text-lg tracking-tight">
          Clash
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            to="/billing"
            className="text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-50"
          >
            Billing
          </Link>
          {userEmail && <span className="text-neutral-400 hidden sm:inline">{userEmail}</span>}
          <button
            onClick={async () => {
              await authClient.signOut();
              window.location.href = "/login";
            }}
            className="text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-50"
          >
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}
