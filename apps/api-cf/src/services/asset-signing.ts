/**
 * Internal capability minting for the replaceable R2 delivery transport.
 *
 * Public URL format: `/assets/<storageKey>?exp=<unix>&sig=<base64url>`
 * Signature: HMAC-SHA256(`<storageKey>:<exp>`) using JWT_SECRET.
 *
 * Only trusted product services import this module. There is intentionally no
 * public route that signs a caller-supplied storage key.
 */

import type { Env } from "../config";
import { requireSecret } from "./require-secret";

export const SIGNED_URL_TTL = 3600; // 1 hour

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function getSigningKey(env: Env): Promise<CryptoKey> {
  const secret = requireSecret(
    env,
    "JWT_SECRET",
    env.JWT_SECRET,
    "dev-asset-signing-key",
  );
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function computeSignature(
  key: CryptoKey,
  storageKey: string,
  exp: number,
): Promise<string> {
  const data = new TextEncoder().encode(`${storageKey}:${exp}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return toBase64Url(sig);
}

export async function verifySignature(
  key: CryptoKey,
  storageKey: string,
  exp: number,
  sig: string,
): Promise<boolean> {
  const expected = await computeSignature(key, storageKey, exp);
  return expected === sig;
}

/**
 * Produce a signed `/assets/<key>?exp=...&sig=...` path for a given R2 key.
 * The caller is a trusted service and must establish Project/owner/workflow
 * authority before calling; this function is not an authorization check.
 * Caller is responsible for prefixing with a base URL if an absolute URL is
 * needed (e.g. when embedding in Cloudflare Media Transformations URLs).
 */
export async function signAssetPath(
  env: Env,
  storageKey: string,
  ttlSec: number = SIGNED_URL_TTL,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const key = await getSigningKey(env);
  const sig = await computeSignature(key, storageKey, exp);
  return `/assets/${storageKey}?exp=${exp}&sig=${sig}`;
}
