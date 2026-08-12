import { describe, expect, it } from "vitest";

import { readFlowCredential } from "./navigation-flow.js";

/**
 * Where the credential is, said by the plugin rather than found by hand.
 *
 * `watchForCallback` got the host as far as knowing the sign-in had finished, and then a human read
 * the token out of the browser -- which is not a product, it is a person with devtools. The
 * declaration has to name the location, and the host has to read it.
 *
 * The three locations are the three places vendors put it. hrhrng.hub sets a `_token` cookie on
 * hub.minimax.io and puts nothing in the query string; an OAuth code arrives as a query parameter;
 * an implicit-grant token arrives in the fragment, which never reaches a server at all. A host that
 * only knew about query parameters would leave the first and last unreachable, and both are common.
 *
 * The plugin still tells the host nothing about meaning. `_token` is a cookie name and
 * `accessToken` is a store key; that the value is a JWT, and what it authorises, stays the
 * plugin's business.
 */
describe("readFlowCredential", () => {
  const page = {
    url: "https://hub.minimax.io/?from=login",
    cookies: { _token: "jwt-abc", _ga: "irrelevant" },
    localStorage: { session: "ls-value" },
  };

  it("reads a cookie the declaration names", async () => {
    const value = await readFlowCredential(
      { from: "cookie", name: "_token", storeAs: "accessToken" },
      page,
    );
    expect(value).toEqual({ accessToken: "jwt-abc" });
  });

  it("reads a query parameter", async () => {
    const value = await readFlowCredential(
      { from: "query", name: "code", storeAs: "authorizationCode" },
      { ...page, url: "https://hub.minimax.io/auth/callback?code=xyz&state=s1" },
    );
    expect(value).toEqual({ authorizationCode: "xyz" });
  });

  it("reads a fragment parameter", async () => {
    // A fragment never reaches a server, so this shape is only readable from a browser we control.
    const value = await readFlowCredential(
      { from: "fragment", name: "access_token", storeAs: "accessToken" },
      { ...page, url: "https://hub.minimax.io/cb#access_token=frag-token&token_type=bearer" },
    );
    expect(value).toEqual({ accessToken: "frag-token" });
  });

  it("reads local storage", async () => {
    const value = await readFlowCredential(
      { from: "localStorage", name: "session", storeAs: "accessToken" },
      page,
    );
    expect(value).toEqual({ accessToken: "ls-value" });
  });

  it("says which location was empty rather than storing nothing", async () => {
    // Storing "" produces an account that looks connected and fails at the vendor with an auth
    // error naming the key rather than its absence.
    await expect(readFlowCredential(
      { from: "cookie", name: "sessionToken", storeAs: "accessToken" },
      page,
    )).rejects.toThrow(/sessionToken/);
  });

  it("does not fall back to another location when the named one is empty", async () => {
    // A fallback would silently store a different vendor value under the credential key, and the
    // failure would appear much later as a request the vendor rejects for reasons of its own.
    await expect(readFlowCredential(
      { from: "query", name: "_token", storeAs: "accessToken" },
      page,
    )).rejects.toThrow(/_token/);
  });
});
