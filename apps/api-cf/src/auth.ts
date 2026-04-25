/**
 * Better Auth handler — moved here from apps/web/app/lib/auth/better-auth.server.ts
 * so the API Worker is the single source of truth for auth state. Frontends
 * (apps/web, apps/web-tanstack) hit /api/better-auth/* and we either run it
 * here directly or proxy via the API_CF service binding.
 *
 * Schema lives in ./auth-schema.ts (same shape as the OSS schema; the D1
 * tables already exist from apps/web/drizzle migrations).
 */
import type {
  D1Database,
  IncomingRequestCfProperties,
  KVNamespace,
} from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { withCloudflare } from "better-auth-cloudflare";
import { drizzle } from "drizzle-orm/d1";

import * as betterAuthSchema from "./auth-schema";

const basePath = "/api/better-auth";

export interface AuthBindings {
  DB: D1Database;
  KV?: KVNamespace<string>;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  AUTH_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
  RESEND_API_KEY?: string;
}

async function sendOtpEmail(
  env: AuthBindings,
  to: string,
  otp: string,
  type: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Dev fallback: print to console — copy-paste from `wrangler tail` into the UI.
    console.log(`[auth] OTP for ${to} (${type}): ${otp}  (expires in 10 min)`);
    return;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Clash <auth@clash.video>",
        to,
        subject: "Your Clash verification code",
        html: `<p>Your code: <strong style="font-size:24px">${otp}</strong></p><p>Expires in 10 minutes.</p>`,
      }),
    });
  } catch (err) {
    console.error("[auth] Resend failed:", err);
  }
}

/** Build a Better Auth instance bound to the current request's env. */
export function createAuth(env: AuthBindings, cf?: IncomingRequestCfProperties) {
  const secret = env.BETTER_AUTH_SECRET ?? env.AUTH_SECRET ?? "dev-secret-change-me";
  const baseURL = env.BETTER_AUTH_URL;
  const googleClientId = env.AUTH_GOOGLE_ID;
  const googleClientSecret = env.AUTH_GOOGLE_SECRET;

  return betterAuth(
    withCloudflare(
      {
        autoDetectIpAddress: true,
        geolocationTracking: true,
        cf: (cf ?? {}) as IncomingRequestCfProperties,
        d1: {
          db: drizzle(env.DB, { schema: betterAuthSchema }) as unknown as never,
          options: {
            usePlural: true,
            debugLogs: false,
          },
        },
        kv: env.KV,
      },
      {
        basePath,
        baseURL,
        trustedProxyHeaders: true,
        secret,
        emailAndPassword: { enabled: true },
        socialProviders:
          googleClientId && googleClientSecret
            ? {
                google: {
                  enabled: true,
                  clientId: googleClientId,
                  clientSecret: googleClientSecret,
                },
              }
            : undefined,
        plugins: [
          emailOTP({
            otpLength: 6,
            expiresIn: 600,
            sendVerificationOnSignUp: false,
            async sendVerificationOTP({ email, otp, type }) {
              await sendOtpEmail(env, email, otp, type);
            },
          }),
        ],
        rateLimit: {
          enabled: true,
          window: 60,
          max: 100,
          // Without KV, falls back to in-memory storage per worker isolate.
          // With KV bound, rate-limit state persists across isolates.
          storage: env.KV ? "secondary-storage" : "memory",
          customRules: {
            "/email-otp/send-verification-otp": { window: 60, max: 1 },
            "/sign-in/email-otp": { window: 60, max: 10 },
            "/sign-in/email": { window: 60, max: 10 },
            "/sign-up/email": { window: 300, max: 5 },
            "/sign-in/social": { window: 60, max: 30 },
          },
        },
      },
    ),
  );
}
