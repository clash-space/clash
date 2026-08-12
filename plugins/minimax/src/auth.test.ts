import { afterEach, describe, expect, it, vi } from "vitest";

import { PluginAuthDeclarationSchema } from "@clash/shared-types/executable-plugin";

import { MINIMAX_AUTH, minimaxAdapter } from "./minimax-adapter.js";

function runtimeContext(
  fetch: unknown,
  stored: Record<string, string> = {},
) {
  vi.stubGlobal("fetch", fetch);
  return {
    store: {
      get: async (key: string) => stored[key],
      put: async () => undefined,
      remove: async () => undefined,
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

/**
 * Authenticating from the account the host selected for this invocation.
 *
 * The host no longer knows what a MiniMax credential is. It renders the form this declaration
 * describes, stores whatever comes back under the keys it names, and hands the plugin one value at
 * a time when it asks.
 *
 * The host resolves one route and one account, then injects only that account's values into the
 * invocation. Reading the separate plugin store did not work in production because provider
 * accounts were never copied there, and it also lost the account binding on poll resume.
 */
describe("declared auth", () => {
  it("declares a key and a region", () => {
    expect(PluginAuthDeclarationSchema.safeParse(MINIMAX_AUTH).success).toBe(true);
  });

  it("refuses to send a request with no credential at all", async () => {
    // Written after a mutation test: deleting the guard left every assertion passing, because the
    // stub did not care what the header said. This one does.
    await expect(minimaxAdapter.submit({
      invocationId: "i1",
      input: {
        values: { kind: "video", model: "minimax-video", prompt: "a leaf" },
        references: [],
      },
    } as never, runtimeContext(async () => { throw new Error("should not have been called"); }) as never))
      .rejects.toThrow(/apiKey|credential/i);
  });

  it("reads the chosen account's key and service only from scoped store", async () => {
    let auth: string | undefined;
    let url: string | undefined;
    let body: Record<string, unknown> | undefined;
    await minimaxAdapter.submit({
      invocationId: "i1",
      input: {
        values: {
          kind: "video",
          model: "minimax-video",
          prompt: "a leaf",
          credentials: { apiKey: "must-not-cross-from-invocation", service: "international" },
        },
        references: [],
      },
    } as never, runtimeContext(async (input: string, init: { headers: Record<string, string>; body: string }) => {
        url = input;
        auth = init.headers.Authorization ?? init.headers.authorization;
        body = JSON.parse(init.body) as Record<string, unknown>;
        return {
          ok: true,
          status: 200,
          json: async () => ({ task_id: "t-1" }),
          text: async () => JSON.stringify({ task_id: "t-1" }),
        };
      }, { apiKey: "mm-from-account", service: "domestic" }) as never);
    expect(auth).toContain("mm-from-account");
    expect(url).toBe("https://api.minimaxi.com/v2/video_generation");
    expect(body).not.toHaveProperty("credentials");
    expect(body).not.toHaveProperty("accountId");
  });
});
