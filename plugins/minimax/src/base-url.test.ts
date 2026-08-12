import { describe, expect, it } from "vitest";

import { minimaxBaseUrl } from "./base-url.js";

/**
 * Which MiniMax host to call, from what the account stored.
 *
 * The executor took a `baseUrl` that "arrives from whoever holds the account" -- and nothing ever
 * sent one. `context.endpoint` was the field it came from: declared on the SDK context, read by two
 * plugins, and written by no layer at all. It is not even on the invocation schema, so a caller
 * supplying one has it dropped before the plugin runs.
 *
 * The account does say which host, in the terms its own auth method declares. `service` is that
 * term, and turning it into a URL is API shape translation -- this plugin's whole job. The host must
 * not know that a field called `service` names a MiniMax deployment.
 */
describe("minimaxBaseUrl", () => {
  it("sends an international account to minimax.io", () => {
    expect(minimaxBaseUrl({ service: "international" })).toBe("https://api.minimax.io");
  });

  it("sends a domestic account to minimaxi.com", () => {
    expect(minimaxBaseUrl({ service: "domestic" })).toBe("https://api.minimaxi.com");
  });

  it("uses the Provider declaration's international default when service is omitted", () => {
    // The CLI stores only explicitly supplied values. This is the same default the auth form shows,
    // so omitting --set service=... must not make the connected account unusable.
    expect(minimaxBaseUrl({})).toBe("https://api.minimax.io");
  });

  it("refuses an unknown stored service rather than guessing a country", () => {
    expect(() => minimaxBaseUrl({ service: "somewhere" })).toThrow(/somewhere/);
  });

  it("prefers an explicitly stored base url over the derived one", () => {
    // A proxy in front of the vendor, stored under the key the declaration names. This is the
    // replacement for `context.endpoint`: the plugin reads its own account, and the host never has
    // to know what the value means.
    expect(minimaxBaseUrl({ service: "international", baseUrl: "https://proxy.internal" }))
      .toBe("https://proxy.internal");
  });
});
