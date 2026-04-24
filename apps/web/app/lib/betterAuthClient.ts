import { createAuthClient } from "better-auth/react";
import { cloudflareClient } from "better-auth-cloudflare/client";

const getBaseURL = () => {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/better-auth`;
  }
  // SSR fallback — the client only runs in the browser in practice
  return "/api/better-auth";
};

const betterAuthClient = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [cloudflareClient()],
});

export default betterAuthClient;
