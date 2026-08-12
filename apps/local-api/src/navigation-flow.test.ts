import { describe, expect, it } from "vitest";

import { watchForCallback } from "./navigation-flow.js";

/**
 * Some vendors hand the credential back through their own https page, not a loopback or a scheme.
 *
 * hrhrng.hub's declaration said `custom-scheme: minimax-hub`, and it was wrong -- opening the real
 * login page shows ordinary OAuth with `redirect_uri=https://hub.minimax.io/auth/callback`. Nothing
 * tested that, because a contract test only checks what the plugin answers when the host asks; the
 * external facts in a declaration are only checked by running it.
 *
 * With an https callback on the vendor's own domain there is no port to bind and no scheme to
 * register. The host watches the browser it opened, and when navigation reaches the declared
 * callback it reads the credential out. That is why the desktop app is not required: what is needed
 * is a browser under our control, not an OS-level protocol handler.
 */
describe("watchForCallback", () => {
  it("returns the credential once navigation reaches the callback", async () => {
    const urls = [
      "https://hub.minimax.io/login?device_id=clash-desktop",
      "https://account.minimax.io/unified-login?login_redirect=%2Foauth2%2Fauthorize",
      "https://hub.minimax.io/auth/callback?code=abc123&state=s1",
    ];
    let index = 0;

    const result = await watchForCallback({
      callbackUrl: "https://hub.minimax.io/auth/callback",
      currentUrl: async () => urls[Math.min(index++, urls.length - 1)]!,
      pollMs: 1,
      timeoutMs: 1000,
    });

    expect(result.url).toContain("code=abc123");
  });

  it("gives up rather than waiting forever", async () => {
    // A user who abandons the login must not leave a promise pending for the life of the process.
    await expect(watchForCallback({
      callbackUrl: "https://hub.minimax.io/auth/callback",
      currentUrl: async () => "https://account.minimax.io/unified-login",
      pollMs: 1,
      timeoutMs: 30,
    })).rejects.toThrow(/timed out/i);
  });

  it("does not match a page that merely mentions the callback", async () => {
    // Matching on substring anywhere would accept the authorize URL, which carries the callback as
    // its `redirect_uri` parameter -- the flow would "succeed" before the user had logged in.
    await expect(watchForCallback({
      callbackUrl: "https://hub.minimax.io/auth/callback",
      // Unescaped, as the browser actually reports it after the redirect chain. The percent-encoded
      // form never matched `includes` anyway, so the case passed for the wrong reason and a
      // substring match survived the mutation that should have killed it.
      currentUrl: async () =>
        "https://account.minimax.io/oauth2/authorize?redirect_uri=https://hub.minimax.io/auth/callback&state=s1",
      pollMs: 1,
      timeoutMs: 30,
    })).rejects.toThrow(/timed out/i);
  });

  it("survives a poll that throws while the page is navigating", async () => {
    // Reading the URL mid-navigation can fail. Treating that as fatal would abandon a login the
    // user is in the middle of completing.
    let calls = 0;
    const result = await watchForCallback({
      callbackUrl: "https://hub.minimax.io/auth/callback",
      currentUrl: async () => {
        calls += 1;
        if (calls < 3) throw new Error("context destroyed");
        return "https://hub.minimax.io/auth/callback?code=xyz";
      },
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(result.url).toContain("code=xyz");
  });
});
