import { useEffect } from "react";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import LayoutContent from "@clash/web-ui/components/LayoutContent";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const { data: session, isPending } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      const { data } = await authClient.getSession();
      return data ?? null;
    },
    staleTime: 30_000,
    enabled: typeof window !== "undefined",
  });

  useEffect(() => {
    if (!isPending && typeof window !== "undefined" && !session?.user?.id) {
      void navigate({ to: "/login" });
    }
  }, [isPending, session, navigate]);

  // Routes under _app are auth-gated (the effect above redirects). Pass
  // isAuthenticated=true unconditionally so TopNav renders on first paint
  // instead of flashing in after the session query resolves.
  return (
    <LayoutContent isAuthenticated>
      <Outlet />
    </LayoutContent>
  );
}
