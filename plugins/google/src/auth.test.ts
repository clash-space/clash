import { afterEach, describe, expect, it, vi } from "vitest";

import { PluginAuthDeclarationSchema } from "@clash/shared-types/executable-plugin";

import { GOOGLE_AUTH, googleAdapter } from "./google-adapter.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Authenticating out of the store.
 *
 * The host no longer knows what a Google credential is. It renders the form this declaration
 * describes, stores whatever comes back under the keys it names, and hands the plugin one value at
 * a time when it asks. Adding another Provider is another plugin, not a host change.
 *
 * The executor reads `context.store`, not `context.apiKey`. `apiKey` was a host-shaped field with a
 * `?? ""` behind it, which turned an unconfigured account into an empty header and a 401 that named
 * the wrong problem.
 */
function storeOf(values: Record<string, string>) {
  return {
    store: {
      get: async (key: string) => values[key],
      put: async () => {},
      remove: async () => {},
    },
  };
}

// A real Agent Platform account always carries a project id and a region: the host parses the
// former out of the service account key during the token exchange, and the latter is what the
// account's own form asked for. Without them these cases died while building the address, which
// says nothing about the headers they exist to check.
describe("declared auth", () => {
  // The flat-form case that lived here is now auth-methods.test.ts: the declaration is `methods`,
  // each a whole configuration, and asserting a single combined form described a shape that Google
  // never had -- AI Studio has no region, and a service account must not be offered a service.

  it("reads its key from the store", async () => {
    let sentKey: string | undefined;
    vi.stubGlobal(
      "fetch",
      async (_url: string, init: { headers: Record<string, string> }) => {
        sentKey = init.headers["x-goog-api-key"];
        const body = {
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { data: "AAAA", mimeType: "image/png" } },
                ],
              },
            },
          ],
        };
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      },
    );
    await googleAdapter.submit(
      {
        invocationId: "i1",
        input: {
          values: {
            credentials: {
              apiKey: "must-not-be-read-from-invocation",
              service: "ai-studio",
            },
            model: "gemini-3.1-flash-image",
            prompt: "a leaf",
          },
          references: [],
        },
      } as never,
      {
        ...storeOf({ apiKey: "AIza-from-store", service: "ai-studio" }),
      } as never,
    );
    expect(sentKey).toBe("AIza-from-store");
  });

  it("refuses to send a request with no credential at all", async () => {
    // The `?? ""` this replaces sent an empty header and let Google answer 401 -- a message about
    // an invalid key, for an account that simply had none.
    await expect(
      googleAdapter.submit(
        {
          invocationId: "i1",
          input: {
            values: { model: "gemini-3.1-flash-image" },
            references: [],
          },
        } as never,
        {
          ...storeOf({}),
          endpoint: "https://generativelanguage.googleapis.com",
        } as never,
      ),
    ).rejects.toThrow(/apiKey|credential/i);
  });
});

/**
 * Two credentials, and the surface decides which one works.
 *
 * Measured, not assumed: an api key answers on the Developer API and returns 401 "API keys are not
 * supported by this API" on Agent Platform, where a service account is what works. An executor that
 * always sent the same header would fail on one surface for a reason naming the credential rather
 * than the mismatch.
 *
 * The plugin does not sign the assertion. RFC 7523 signing lives in the host, and what reaches the
 * store is the access token it produced -- so the plugin reads a bearer token here without ever
 * holding the private key.
 */
describe("Google's two credentials", () => {
  function run(
    values: Record<string, string>,
    capture: (headers: Record<string, string>) => void,
  ) {
    vi.stubGlobal(
      "fetch",
      async (_url: string, init: { headers: Record<string, string> }) => {
        capture(init.headers);
        const body = {
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { data: "AAAA", mimeType: "image/png" } },
                ],
              },
            },
          ],
        };
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      },
    );
    return googleAdapter.submit(
      {
        invocationId: "i1",
        input: {
          values: { model: "gemini-3.1-flash-image", prompt: "a leaf" },
          references: [],
        },
      } as never,
      {
        store: {
          get: async (key: string) => values[key],
          put: async () => {},
          remove: async () => {},
        },
        // No endpoint. It exists for a proxy in front of the vendor and outranks everything, so
        // hard-coding one here made every case address Agent Platform regardless of the `service` the
        // account stored -- which is the field these cases vary.
      } as never,
    );
  }

  it("sends a bearer token when the account has one", async () => {
    let headers: Record<string, string> = {};
    await run(
      {
        accessToken: "ya29.token",
        service: "agent-platform",
        projectId: "p-1",
        region: "us-central1",
      },
      (h) => {
        headers = h;
      },
    );
    expect(headers.Authorization).toBe("Bearer ya29.token");
    // Sending both would let Google choose, and which one it honours is not documented.
    expect(headers["x-goog-api-key"]).toBeUndefined();
  });

  it("sends an api key when that is what the account has", async () => {
    let headers: Record<string, string> = {};
    await run({ apiKey: "AIza-key", service: "ai-studio" }, (h) => {
      headers = h;
    });
    expect(headers["x-goog-api-key"]).toBe("AIza-key");
    expect(headers.Authorization).toBeUndefined();
  });

  it("prefers the bearer token when an account somehow holds both", async () => {
    // An account that signed in and also pasted a key. The token is the one that works on both
    // surfaces, so it is the safer of the two to send.
    let headers: Record<string, string> = {};
    await run(
      { accessToken: "ya29.token", apiKey: "AIza-key", service: "ai-studio" },
      (h) => {
        headers = h;
      },
    );
    expect(headers.Authorization).toBe("Bearer ya29.token");
    expect(headers["x-goog-api-key"]).toBeUndefined();
  });

  it("refuses when the account holds neither", async () => {
    await expect(run({}, () => {})).rejects.toThrow(
      /apiKey|accessToken|credential/i,
    );
  });
});
