import type { LoaderFunctionArgs } from "react-router";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";

export async function loader(_: LoaderFunctionArgs) {
  try {
    const response = await fetch(
      runtimeApiUrl("/api/better-auth/get-session"),
      { credentials: "include" },
    );
    if (!response.ok) return { isAuthenticated: false };
    const data = (await response.json()) as {
      user?: { id?: string };
    } | null;
    return { isAuthenticated: !!data?.user?.id };
  } catch {
    return { isAuthenticated: false };
  }
}
