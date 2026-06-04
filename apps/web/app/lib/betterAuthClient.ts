import { createAuthClient } from "better-auth/react";
import { cloudflareClient } from "better-auth-cloudflare/client";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";

const getBaseURL = () => {
  if (typeof window !== "undefined") {
    const url = runtimeApiUrl("/api/better-auth");
    if (/^https?:/.test(url)) return url;
    return `${window.location.origin}${url}`;
  }
  // SSR fallback — the client only runs in the browser in practice
  return "/api/better-auth";
};

const betterAuthClient = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [cloudflareClient()],
});

export default betterAuthClient;
