import { describe, expect, it } from "vitest";

import { declaredBrowserFlow } from "./declared-oauth.js";

/**
 * A Provider that declares a browser flow can start one.
 *
 * `pluginBrowserOAuth` returned `null` unconditionally after the auth-type registry was deleted --
 * a function wired to nothing, so the endpoint answered 404 for every plugin Provider whatever it
 * declared. What replaces the registry is not a shorter list of vendors; it is reading the flow the
 * Provider already declares.
 *
 * The parts that repeat across vendors -- PKCE, `state`, the loopback port, the timeout, the token
 * exchange -- are the host's, in `auth-flow.ts`. What arrives from the declaration is the address
 * to open and the vendor's own parameters.
 */
// `methods`, not a flat `form` plus a top-level `flow`: a flow belongs to a way in, and a Provider
// can offer several. What the cases below check -- an unknown id, a Provider with no auth, a prefix
// that must not match -- is unchanged by that.
const GOOGLE_PROVIDER = {
  id: "google",
  name: "Google",
  auth: {
    methods: [{
      id: "sign-in",
      label: "Sign in with Google",
      form: [{ kind: "button" as const, key: "signIn", label: "Sign in with Google" }],
      flow: {
        open: "https://accounts.google.com/o/oauth2/v2/auth",
        callback: { type: "loopback" as const },
      },
    }],
  },
} as never;

describe("declaredBrowserFlow", () => {
  it("finds the flow a Provider declared", () => {
    const flow = declaredBrowserFlow([GOOGLE_PROVIDER], "google");
    expect(flow).toMatchObject({ open: "https://accounts.google.com/o/oauth2/v2/auth" });
  });

  it("answers nothing for a Provider that declares no flow", () => {
    // An api-key Provider has nothing to open. Returning a flow anyway would put a browser window
    // in front of a user who only needed to paste a key.
    const apiKeyOnly = {
      id: "minimax",
      name: "MiniMax",
      auth: {
        methods: [{
          id: "api-key",
          label: "API key",
          form: [{ kind: "field" as const, key: "apiKey", label: "API key", secret: true }],
        }],
      },
    } as never;
    expect(declaredBrowserFlow([apiKeyOnly], "minimax")).toBeUndefined();
  });

  it("answers nothing for a Provider that declares no auth at all", () => {
    expect(declaredBrowserFlow([{ id: "local", name: "Local" }], "local")).toBeUndefined();
  });

  it("answers nothing for an id no Provider claims", () => {
    // The endpoint's 404 has to keep meaning "no such Provider" rather than becoming a crash.
    expect(declaredBrowserFlow([GOOGLE_PROVIDER], "nobody")).toBeUndefined();
  });

  it("does not match a Provider by prefix", () => {
    // `google` and `google-cloud` are two Providers, and starting the wrong one's flow would send
    // the user to authorize an account they did not ask for.
    expect(declaredBrowserFlow([GOOGLE_PROVIDER], "goo")).toBeUndefined();
  });

  it("carries a poll-until flow through, which is how device code arrives", () => {
    const deviceCode = {
      id: "kling",
      name: "Kling",
      auth: {
        methods: [{
          id: "device-code",
          label: "Device code",
          form: [{ kind: "display-code" as const, key: "userCode", label: "Code" }],
          flow: {
          open: "https://example.test/device",
          callback: { type: "poll-until" as const, url: "https://example.test/token" },
            },
        }],
      },
    };
    expect(declaredBrowserFlow([deviceCode], "kling"))
      .toMatchObject({ callback: { type: "poll-until" } });
  });
});
