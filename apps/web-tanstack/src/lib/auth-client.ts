/**
 * Better Auth client — talks to the server-side handler at /api/better-auth/*.
 * The Worker proxies that path to api-cf-hosted via the API_CF service binding,
 * so on the client we just hit a relative URL.
 *
 * SSR note: createAuthClient.getSession() runs on the server with no cookies
 * forwarded, which would always return null. We avoid SSR session checks
 * entirely (see beforeLoad guards in the routes) and only call getSession
 * on the client.
 */
import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

const baseURL =
  typeof window === "undefined"
    ? "http://localhost/api/better-auth" // SSR placeholder — never actually hit
    : `${window.location.origin}/api/better-auth`;

export const authClient = createAuthClient({
  baseURL,
  plugins: [emailOTPClient()],
});

export const { signIn, signUp, signOut, useSession, emailOtp } = authClient;
