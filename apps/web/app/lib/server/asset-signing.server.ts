// HMAC-signed `/assets/<key>?exp=&sig=` paths.
// Mirrors apps/api-cf/src/services/asset-signing.ts — both must derive the
// same key from JWT_SECRET (defaults to "dev-asset-signing-key" in dev).

const SIGNED_URL_TTL = 3600;

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function signAssetPath(
  env: { JWT_SECRET?: string },
  storageKey: string,
  ttlSec: number = SIGNED_URL_TTL,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const key = await getSigningKey(env.JWT_SECRET || "dev-asset-signing-key");
  const data = new TextEncoder().encode(`${storageKey}:${exp}`);
  const sig = toBase64Url(await crypto.subtle.sign("HMAC", key, data));
  return `/assets/${storageKey}?exp=${exp}&sig=${sig}`;
}
