import { describe, expect, it, vi } from "vitest";

import { resolveStoredCredentials } from "./service-account-exchange.js";

// A shape `parseServiceAccountKey` accepts. The real check is in service-account.test.ts; here the
// key only has to be well-formed enough to reach the exchange, and a thinner stub failed on
// "carries no private_key", which is a different fault than the one under test.
const KEY = JSON.stringify({
  type: "service_account",
  project_id: "p",
  private_key_id: "kid-1",
  private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
  client_email: "svc@p.iam.gserviceaccount.com",
  token_uri: "https://oauth2.googleapis.com/token",
});

/**
 * Turning what an account stored into what a plugin can present.
 *
 * `serviceAccountToken` has existed since August, with eleven tests and a real 1408x768 PNG to its
 * name, and nothing ever called it. So an account configured with the service-account method
 * reached its plugin as a JSON key file, and clash.google reported "neither an accessToken nor an
 * apiKey stored" -- which is true, and describes the host having done nothing rather than the user
 * having configured nothing.
 *
 * Signing belongs here rather than in the plugin. The assertion is signed with the private key, and
 * a plugin that did it would need the key itself; this way the plugin only ever sees a bearer token
 * with an hour to live. It is also the same shape for every vendor that speaks RFC 7523, so each
 * one having its own copy would be the same code written per plugin.
 */
describe("resolveStoredCredentials", () => {
  it("exchanges a service account key for an access token", async () => {
    const exchange = vi.fn(async () => ({
      accessToken: "ya29.exchanged",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }));

    const resolved = await resolveStoredCredentials(
      { serviceAccountKey: KEY, region: "global" },
      { exchange },
    );

    expect(resolved.accessToken).toBe("ya29.exchanged");
    // The key itself never travels on. A plugin holding it could sign anything, for as long as the
    // key lives, rather than for the hour the token lasts.
    expect(resolved.serviceAccountKey).toBeUndefined();
    // Everything else the method declared passes through untouched: the host does not know what
    // `region` means and must not drop what it does not understand.
    expect(resolved.region).toBe("global");
  });

  it("leaves an account without a service account key alone", async () => {
    const exchange = vi.fn();
    const resolved = await resolveStoredCredentials({ apiKey: "k", service: "ai-studio" }, { exchange });

    expect(resolved).toEqual({ apiKey: "k", service: "ai-studio" });
    expect(exchange).not.toHaveBeenCalled();
  });

  it("reuses a token that has not expired", async () => {
    // A fresh assertion per invocation would sign and round-trip on every generation, and Google
    // rate-limits the token endpoint far below the generation endpoint.
    const exchange = vi.fn(async () => ({
      accessToken: "ya29.first",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }));
    const cache = new Map<string, { accessToken: string; expiresAt: number }>();

    const stored = { serviceAccountKey: KEY };
    await resolveStoredCredentials(stored, { exchange, cache });
    await resolveStoredCredentials(stored, { exchange, cache });

    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it("exchanges again once the token has expired", async () => {
    const exchange = vi.fn(async () => ({
      accessToken: "ya29.fresh",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }));
    const cache = new Map([["k", { accessToken: "ya29.stale", expiresAt: Date.now() - 1000 }]]);

    const resolved = await resolveStoredCredentials(
      { serviceAccountKey: KEY },
      { exchange, cache, cacheKey: "k" },
    );

    expect(resolved.accessToken).toBe("ya29.fresh");
  });

  it("calls the real exchange with everything it requires", async () => {
    // `serviceAccountToken(key, options)` takes options as a required parameter and reads
    // `options.now` inside the assertion. Calling it with one argument type-checks through the
    // default and then dies at runtime as "Cannot read properties of undefined (reading 'now')" --
    // inside the plugin's broker round trip, where it reads as a broker fault.
    const seen: unknown[] = [];
    await resolveStoredCredentials({ serviceAccountKey: KEY }, {
      exchange: async (key) => {
        seen.push(key);
        return { accessToken: "t", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
      },
    });
    expect(seen).toHaveLength(1);

    // And the default path, which is the one that broke, must get far enough to sign. The fixture
    // key is not a real RSA key, so it fails in the signer -- which is proof the call reached it,
    // rather than dying earlier on `options.now` being undefined.
    await expect(resolveStoredCredentials({ serviceAccountKey: KEY }, {
      fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    } as never)).rejects.toThrow(/DECODER|unsupported/);
  });

  it("keeps the project id when the token comes from the cache", async () => {
    // The cached branch returned only the token, so every lookup after the first was missing the
    // project id -- which is part of every Agent Platform URL. The first lookup of a run populated
    // the cache and the second one, for `projectId`, came back empty: "This Google account stored no
    // service", about an account whose key names its project on line three.
    const exchange = async () => ({
      accessToken: "ya29.cached",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const cache = new Map<string, { accessToken: string; expiresAt: number }>();

    const first = await resolveStoredCredentials({ serviceAccountKey: KEY }, { exchange, cache });
    const second = await resolveStoredCredentials({ serviceAccountKey: KEY }, { exchange, cache });

    expect(second.projectId).toBe(first.projectId);
    expect(second.projectId).toBeTruthy();
  });

  it("says the exchange failed rather than passing nothing on", async () => {
    // Returning the stored values unchanged would hand the plugin a JSON key it cannot use, and the
    // failure would then be reported as an unconfigured account.
    const exchange = vi.fn(async () => { throw new Error("invalid_grant"); });

    await expect(resolveStoredCredentials(
      { serviceAccountKey: KEY },
      { exchange },
    )).rejects.toThrow(/invalid_grant/);
  });
});
