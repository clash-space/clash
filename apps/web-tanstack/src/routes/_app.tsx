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

  // Don't mount children until auth is confirmed — otherwise the editor
  // fires a WS handshake with no cookie, the server closes it, and the
  // canvas comes up with an empty Loro doc.
  if (typeof window !== "undefined" && (isPending || !userId)) {
    return (
      <LayoutContent isAuthenticated>
        <div className="min-h-[60vh] flex items-center justify-center text-sm text-neutral-500">
          Loading…
        </div>
      </LayoutContent>
    );
  }

  return (
    <LayoutContent isAuthenticated>
      <Outlet />
    </LayoutContent>
  );
}
