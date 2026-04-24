import { Outlet, useLoaderData } from "react-router";
import type { ClientLoaderFunctionArgs } from "react-router";
import LayoutContent from "@clash/web-ui/components/LayoutContent";
import DevLogBridge from "@clash/web-ui/components/DevLogBridge";
import { ConfirmDialogProvider } from "@clash/web-ui/components/ConfirmDialog";

export async function clientLoader(_: ClientLoaderFunctionArgs) {
  try {
    const res = await fetch("/api/better-auth/get-session", {
      credentials: "include",
    });
    if (!res.ok) return { isAuthenticated: false };
    const data = (await res.json()) as { user?: { id?: string } } | null;
    return { isAuthenticated: !!data?.user?.id };
  } catch {
    return { isAuthenticated: false };
  }
}

export default function AppLayout() {
  const { isAuthenticated } = useLoaderData<typeof clientLoader>();
  return (
    <ConfirmDialogProvider>
      <DevLogBridge />
      <LayoutContent isAuthenticated={isAuthenticated}>
        <Outlet />
      </LayoutContent>
    </ConfirmDialogProvider>
  );
}
