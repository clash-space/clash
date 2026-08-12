import { describe, expect, it } from "vitest";

import { completeDeclaredFlow, hostOAuthClient } from "./oauth-client.js";

/**
 * The plugin never learns the OAuth client.
 *
 * A client id is the application's identity with a vendor -- Google issued Clash's, not a plugin's.
 * The host runs the whole exchange and writes only the resulting token into the plugin's store, so
 * what a plugin can read is a credential for the account, never the credential that identifies
 * Clash to the vendor.
 *
 * This matters beyond tidiness. A plugin holding the client secret could mint its own authorization
 * requests against Clash's registration, and every token it obtained would look to the vendor like
 * Clash asking.
 */
describe("host-held OAuth client", () => {
  it("reads the client from host configuration, not from the declaration", () => {
    const client = hostOAuthClient(
      { google: { clientId: "clash.apps.googleusercontent.com", clientSecret: "s" } },
      "google",
    );
    expect(client).toMatchObject({ clientId: "clash.apps.googleusercontent.com" });
  });

  it("refuses to start when the host has no client for that vendor", () => {
    // Better than starting a flow that Google will reject with `invalid_client` after the user has
    // already picked an account and granted consent.
    expect(() => hostOAuthClient({}, "google")).toThrow(/no OAuth client/i);
  });

  it("writes only the token into the plugin's store", async () => {
    const written: Record<string, string> = {};
    await completeDeclaredFlow({
      flow: {
        open: "https://accounts.google.com/o/oauth2/v2/auth",
        callback: { type: "loopback" },
        tokenUrl: "https://oauth2.googleapis.com/token",
      },
      client: { clientId: "clash.apps.googleusercontent.com", clientSecret: "shh" },
      code: "abc",
      verifier: "v",
      redirectUri: "http://127.0.0.1:1/callback",
      put: async (key, value) => { written[key] = value; },
      fetch: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      })) as never,
    });

    expect(written.accessToken).toBe("at");
    expect(written.refreshToken).toBe("rt");
    // The two things the plugin must not be able to read back.
    expect(Object.values(written)).not.toContain("shh");
    expect(Object.values(written)).not.toContain("clash.apps.googleusercontent.com");
  });

  it("records when the token expires, so renewal has something to schedule against", async () => {
    const written: Record<string, string> = {};
    const before = Date.now();
    await completeDeclaredFlow({
      flow: {
        open: "https://accounts.google.com/o/oauth2/v2/auth",
        callback: { type: "loopback" },
        tokenUrl: "https://oauth2.googleapis.com/token",
      },
      client: { clientId: "c" },
      code: "abc",
      verifier: "v",
      redirectUri: "http://127.0.0.1:1/callback",
      put: async (key, value) => { written[key] = value; },
      fetch: (async () => ({
        ok: true, status: 200, json: async () => ({ access_token: "at", expires_in: 3600 }),
      })) as never,
    });
    expect(Date.parse(written.expiresAt!)).toBeGreaterThanOrEqual(before + 3_600_000 - 5_000);
  });

  it("refuses a flow with no token endpoint rather than storing a code", async () => {
    // An authorization code is worth nothing stored. Writing one would leave the account looking
    // configured while every request failed.
    await expect(completeDeclaredFlow({
      flow: { open: "https://accounts.google.com/o/oauth2/v2/auth", callback: { type: "loopback" } },
      client: { clientId: "c" },
      code: "abc",
      verifier: "v",
      redirectUri: "http://127.0.0.1:1/callback",
      put: async () => {},
    })).rejects.toThrow(/tokenUrl|token endpoint/i);
  });
});
