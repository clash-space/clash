import { useEffect, useState } from "react";
import { Outlet, useLoaderData, useLocation } from "react-router";
import type { ClientLoaderFunctionArgs } from "react-router";
import LayoutContent from "@clash/web-ui/components/LayoutContent";
import DevLogBridge from "@clash/web-ui/components/DevLogBridge";
import { ConfirmDialogProvider } from "@clash/web-ui/components/ConfirmDialog";
import {
  getEffectiveChromeAuth,
  shouldProbeSessionForChrome,
} from "./authChrome";

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
  const pathname = useLocation().pathname;
  const [probedAuthenticated, setProbedAuthenticated] =
    useState(isAuthenticated);

  useEffect(() => {
    setProbedAuthenticated(isAuthenticated);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!shouldProbeSessionForChrome(pathname, isAuthenticated)) return;

    let cancelled = false;

    async function probeSession() {
      try {
        const res = await fetch("/api/better-auth/get-session", {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { user?: { id?: string } } | null;
        if (!cancelled) setProbedAuthenticated(!!data?.user?.id);
      } catch {
        if (!cancelled) setProbedAuthenticated(false);
      }
    }

    void probeSession();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, pathname]);

  const effectiveAuthenticated = getEffectiveChromeAuth(
    isAuthenticated,
    probedAuthenticated,
  );

  return (
    <ConfirmDialogProvider>
      <DevLogBridge />
      <LayoutContent isAuthenticated={effectiveAuthenticated}>
        <Outlet />
      </LayoutContent>
    </ConfirmDialogProvider>
  );
}
