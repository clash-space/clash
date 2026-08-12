import { createSign } from "node:crypto";

/**
 * A service account signs its own way in.
 *
 * RFC 7523: build a JWT asserting who you are and what you want, sign it with the private key the
 * vendor issued, and exchange it for an access token. No browser, no consent screen, no
 * verification, and no refresh token -- when the hour is up you sign another one.
 *
 * That last part is why this suits a local-first product. Google's OAuth verification applies to an
 * *application* asking on a user's behalf, which is what makes an unverified app issue refresh
 * tokens that die in 7 days. A service account is a credential acting as itself, so none of that
 * applies: the only thing that expires is an access token you can always re-mint.
 */

export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
  projectId?: string;
  tokenUri: string;
}

export function parseServiceAccountKey(raw: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Saying "missing private_key" for a PEM file or a stray path sends the reader looking inside a
    // file that was never the right shape.
    throw new Error("A service account key must be the JSON file Google issued.");
  }

  const key = parsed as Record<string, unknown>;

  // The two downloads look alike and land in the same folder. Accepting an installed-app client here
  // produces a signing failure with no indication that the file was the problem.
  if (key.installed || key.web) {
    throw new Error(
      "That is an OAuth client, not a service account key. A service account key has "
      + `"type": "service_account".`,
    );
  }
  if (key.type !== undefined && key.type !== "service_account") {
    throw new Error(`Expected a service account key; this file says type ${JSON.stringify(key.type)}.`);
  }
  if (typeof key.private_key !== "string" || !key.private_key) {
    throw new Error("This service account key carries no private_key.");
  }
  if (typeof key.client_email !== "string" || !key.client_email) {
    throw new Error("This service account key carries no client_email.");
  }

  return {
    clientEmail: key.client_email,
    privateKey: key.private_key,
    ...(typeof key.private_key_id === "string" ? { privateKeyId: key.private_key_id } : {}),
    ...(typeof key.project_id === "string" ? { projectId: key.project_id } : {}),
    tokenUri: typeof key.token_uri === "string" ? key.token_uri : "https://oauth2.googleapis.com/token",
  };
}

export interface AssertionOptions {
  scope: string;
  now?: number;
  /** Impersonation, for the rare case where a service account acts for a user. */
  subject?: string;
}

export function serviceAccountAssertion(
  key: ServiceAccountKey,
  options: AssertionOptions,
): string {
  const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    ...(key.privateKeyId ? { kid: key.privateKeyId } : {}),
  };
  const claims = {
    iss: key.clientEmail,
    scope: options.scope,
    aud: key.tokenUri,
    iat: issuedAt,
    // Google rejects an assertion whose lifetime exceeds 3600 seconds, and the rejection is
    // `invalid_grant` -- indistinguishable from a wrong key or a clock problem.
    exp: issuedAt + 3600,
    ...(options.subject ? { sub: options.subject } : {}),
  };

  const signingInput = `${base64Url(header)}.${base64Url(claims)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(key.privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export interface ServiceAccountToken {
  accessToken: string;
  /** Absolute, because the renewal scheduler reads this after the response is gone. */
  expiresAt?: number;
  /** Never set. Signing another assertion is the renewal. */
  refreshToken?: undefined;
}

export async function serviceAccountToken(
  key: ServiceAccountKey,
  options: AssertionOptions & { fetch?: typeof globalThis.fetch },
): Promise<ServiceAccountToken> {
  const assertion = serviceAccountAssertion(key, options);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const response = await fetchImpl(key.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const payload = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    const detail = typeof payload.error_description === "string"
      ? `: ${payload.error_description}`
      : "";
    throw new Error(`Service account token request failed (${code})${detail}`);
  }

  const accessToken = payload.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Service account token response carried no access_token.");
  }

  return {
    accessToken,
    ...(typeof payload.expires_in === "number"
      ? { expiresAt: Date.now() + payload.expires_in * 1000 }
      : {}),
  };
}
