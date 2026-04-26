import { useEffect } from "react";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import LayoutContent from "@clash/web-ui/components/LayoutContent";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const isPending = session.isPending;
  const userId = session.data?.user?.id;

  useEffect(() => {
    if (!isPending && typeof window !== "undefined" && !userId) {
      void navigate({ to: "/login" });
    }
  }, [isPending, userId, navigate]);

  // Wait for session to resolve before mounting children — otherwise
  // session-aware UI (UserControls, etc.) flashes from logged-out → user.
  if (isPending) {
    return (
      <LayoutContent isAuthenticated>
        <div className="min-h-[60vh]" />
      </LayoutContent>
    );
  }

  return (
    <LayoutContent isAuthenticated>
      <Outlet />
    </LayoutContent>
  );
}
