import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import { parseServiceAccountKey, serviceAccountAssertion, serviceAccountToken } from "./service-account.js";

/**
 * A service account signs its own way in.
 *
 * RFC 7523: build a JWT asserting who you are and what you want, sign it with the private key the
 * vendor issued, and exchange it for an access token. No browser, no consent screen, no
 * verification, and no refresh token -- when the hour is up you sign another one.
 *
 * That last part is why this suits a local-first product. Google's OAuth verification applies to an
 * *application* asking on a user's behalf; a service account is the user's own credential acting as
 * itself, so none of Testing-mode's limits apply. The 7-day refresh-token expiry that blocks an
 * unverified OAuth app has no equivalent here.
 */
function testKey() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    type: "service_account",
    project_id: "test-project",
    private_key_id: "key-1",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: "robot@test-project.iam.gserviceaccount.com",
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

describe("parsing the key Google hands you", () => {
  it("reads the fields the assertion needs", () => {
    const parsed = parseServiceAccountKey(JSON.stringify(testKey()));
    expect(parsed).toMatchObject({
      clientEmail: "robot@test-project.iam.gserviceaccount.com",
      projectId: "test-project",
      tokenUri: "https://oauth2.googleapis.com/token",
    });
  });

  it("refuses a user OAuth client mistaken for a service account", () => {
    // The two downloads look alike and land in the same folder. Accepting the wrong one produces a
    // signing failure with no indication that the file was the problem.
    //
    // The fixture carries a private_key so this discriminates the `installed` check itself: a
    // version testing only the shorter file passed even with that check removed, because the
    // missing-private_key guard caught it instead.
    const clientSecret = JSON.stringify({
      installed: { client_id: "x.apps.googleusercontent.com", client_secret: "GOCSPX-y" },
      private_key: "-----BEGIN PRIVATE KEY-----",
      client_email: "not-a-robot@example.test",
    });
    expect(() => parseServiceAccountKey(clientSecret)).toThrow(/OAuth client/i);
  });

  it("refuses a key with no private key rather than signing nothing", () => {
    const { private_key: _omitted, ...rest } = testKey();
    expect(() => parseServiceAccountKey(JSON.stringify(rest))).toThrow(/private_key/);
  });

  it("says the file is not JSON rather than reporting a missing field", () => {
    expect(() => parseServiceAccountKey("-----BEGIN PRIVATE KEY-----")).toThrow(/JSON/i);
  });
});

describe("the assertion", () => {
  it("is signed RS256 and names the scope it is asking for", async () => {
    const key = parseServiceAccountKey(JSON.stringify(testKey()));
    const jwt = serviceAccountAssertion(key, {
      scope: "https://www.googleapis.com/auth/cloud-platform",
      now: 1_700_000_000_000,
    });
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString()))
      .toMatchObject({ alg: "RS256", typ: "JWT", kid: "key-1" });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({
      iss: "robot@test-project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
    });
    expect(signature).toBeTruthy();
  });

  it("expires within the hour Google allows", async () => {
    // Google rejects an assertion whose lifetime exceeds 3600 seconds, and the rejection is
    // `invalid_grant` -- indistinguishable from a wrong key.
    const key = parseServiceAccountKey(JSON.stringify(testKey()));
    const now = 1_700_000_000_000;
    const claims = JSON.parse(Buffer.from(
      serviceAccountAssertion(key, { scope: "s", now }).split(".")[1]!,
      "base64url",
    ).toString()) as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
    expect(claims.exp - claims.iat).toBeGreaterThan(0);
  });

  it("signs differently for a different scope", async () => {
    // The scope is inside the signed payload, so a cached assertion cannot be reused to ask for
    // more than it was signed for.
    const key = parseServiceAccountKey(JSON.stringify(testKey()));
    const now = 1_700_000_000_000;
    expect(serviceAccountAssertion(key, { scope: "a", now }))
      .not.toBe(serviceAccountAssertion(key, { scope: "b", now }));
  });
});

describe("exchanging it", () => {
  it("posts the jwt-bearer grant, which is what RFC 7523 defines", async () => {
    let body = "";
    const key = parseServiceAccountKey(JSON.stringify(testKey()));
    await serviceAccountToken(key, {
      scope: "https://www.googleapis.com/auth/cloud-platform",
      fetch: (async (_url: string, init: { body: string }) => {
        body = init.body;
        return { ok: true, status: 200, json: async () => ({ access_token: "at", expires_in: 3600 }) };
      }) as never,
    });
    const sent = new URLSearchParams(body);
    expect(sent.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(sent.get("assertion")).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("returns an absolute expiry, so renewal has something to schedule against", async () => {
    const key = parseServiceAccountKey(JSON.stringify(testKey()));
    const before = Date.now();
    const token = await serviceAccountToken(key, {
      scope: "s",
      fetch: (async () => ({
        ok: true, status: 200, json: async () => ({ access_token: "at", expires_in: 3600 }),
      })) as never,
    });
    expect(token.expiresAt!).toBeGreaterThanOrEqual(before + 3_600_000 - 5_000);
  });

  it("carries no refresh token, because signing another assertion is the renewal", async () => {
    // Storing an empty refreshToken would make the renewal path look like an OAuth refresh and fail
    // on a credential that was never issued.
    const key = parseServiceAccountKey(JSON.stringify(testKey()));
    const token = await serviceAccountToken(key, {
      scope: "s",
      fetch: (async () => ({
        ok: true, status: 200, json: async () => ({ access_token: "at", expires_in: 3600 }),
      })) as never,
    });
    expect(token.refreshToken).toBeUndefined();
  });

  it("reports Google's own error", async () => {
    const key = parseServiceAccountKey(JSON.stringify(testKey()));
    await expect(serviceAccountToken(key, {
      scope: "s",
      fetch: (async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid_grant", error_description: "Invalid JWT Signature." }),
      })) as never,
    })).rejects.toThrow(/invalid_grant|Invalid JWT/);
  });
});
