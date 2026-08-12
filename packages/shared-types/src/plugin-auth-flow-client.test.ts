import { describe, expect, it } from "vitest";

import { PluginAuthDeclarationSchema } from "./plugin-auth.js";

/**
 * A flow declares its own client, and the host keeps the parts that must not vary.
 *
 * The OAuth client id belongs to the plugin: it is issued to the vendor's own application, and a
 * host that supplied one would be lending its identity to whatever the plugin points at. Anything
 * capable of sending a user somewhere could open a browser itself. What stays with the host is the
 * part that must not vary -- PKCE, `state`, the loopback port, the timeout, and the exchange. The
 * plugin never handles the code or the resulting token; it reads the token back out of its store
 * like any other value.
 *
 * The declaration is `methods`, so a flow lives on the method that opens it rather than on the
 * Provider. hrhrng.hub declares three ways in and only one opens a browser -- a Provider-level flow
 * would put a browser window in front of a user who chose to paste a token.
 */
const signIn = (flow: Record<string, unknown>) => ({
  methods: [{
    id: "sign-in",
    label: "Sign in",
    form: [{ kind: "button", key: "signIn", label: "Sign in with Google" }],
    flow,
  }],
});

describe("a flow declares its own client", () => {
  it("accepts the endpoints and the vendor parameters with no client at all", () => {
    // A vendor that issues no client id is ordinary. Requiring one would make the field a ceremony
    // every plugin has to satisfy with something.
    const parsed = PluginAuthDeclarationSchema.safeParse(signIn({
      open: "https://accounts.google.com/o/oauth2/v2/auth",
      callback: { type: "loopback" },
      tokenUrl: "https://oauth2.googleapis.com/token",
      params: { scope: "https://www.googleapis.com/auth/cloud-platform", access_type: "offline" },
    }));
    expect(parsed.success).toBe(true);
  });

  it("accepts a declared client id with the endpoint that exchanges its code", () => {
    const parsed = PluginAuthDeclarationSchema.safeParse(signIn({
      open: "https://accounts.google.com/o/oauth2/v2/auth",
      callback: { type: "loopback" },
      clientId: "1234.apps.googleusercontent.com",
      tokenUrl: "https://oauth2.googleapis.com/token",
    }));
    expect(parsed.success).toBe(true);
  });

  it("refuses a client id with nowhere to exchange the code", () => {
    // A code that cannot be exchanged is a browser window that ends in nothing.
    const parsed = PluginAuthDeclarationSchema.safeParse(signIn({
      open: "https://accounts.google.com/o/oauth2/v2/auth",
      callback: { type: "loopback" },
      clientId: "1234.apps.googleusercontent.com",
    }));
    expect(parsed.success).toBe(false);
  });

  it("refuses a client id smuggled in as a vendor parameter", () => {
    // `params` is passed through untouched. A client id hidden there would reach the vendor while
    // the check for an exchange endpoint never ran.
    const parsed = PluginAuthDeclarationSchema.safeParse(signIn({
      open: "https://accounts.google.com/o/oauth2/v2/auth",
      callback: { type: "loopback" },
      params: { client_id: "1234.apps.googleusercontent.com" },
    }));
    expect(parsed.success).toBe(false);
  });

  it("requires an https token endpoint", () => {
    // The code and the resulting token both cross this connection.
    const parsed = PluginAuthDeclarationSchema.safeParse(signIn({
      open: "https://accounts.google.com/o/oauth2/v2/auth",
      callback: { type: "loopback" },
      clientId: "1234.apps.googleusercontent.com",
      tokenUrl: "http://oauth2.googleapis.com/token",
    }));
    expect(parsed.success).toBe(false);
  });

  it("refuses a declared parameter that would replace a security one", () => {
    // `state` and the PKCE challenge are the host's. A plugin setting either would be choosing the
    // value that proves the response belongs to this request.
    for (const key of ["state", "code_challenge", "code_challenge_method", "redirect_uri"]) {
      const parsed = PluginAuthDeclarationSchema.safeParse(signIn({
        open: "https://accounts.google.com/o/oauth2/v2/auth",
        callback: { type: "loopback" },
        tokenUrl: "https://oauth2.googleapis.com/token",
        params: { [key]: "anything" },
      }));
      expect(parsed.success, key).toBe(false);
    }
  });
});
