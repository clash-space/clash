import { describe, expect, it } from "vitest";

import { declaredBrowserFlow as declaredFlow, declaredFlowButtonKey } from "./declared-oauth.js";

/**
 * A flow belongs to a method, not to a Provider.
 *
 * These two read `auth.flow` and `auth.form` off the declaration's top level, which is where they
 * lived when a Provider had exactly one way in. It no longer does: the declaration is `methods`,
 * each a whole configuration, and hrhrng.hub alone declares three -- `reuse-local-login`,
 * `sign-in`, `token`. Only the middle one opens a browser.
 *
 * Asking a Provider for "its" flow therefore has no answer. Asking a method for its flow does.
 */
const hub = {
  id: "hilo-hub",
  name: "MiniMax Hub",
  auth: {
    methods: [
      { id: "reuse-local-login", label: "Use the signed-in app", import: { tokenPath: "accessToken" } },
      {
        id: "sign-in",
        label: "Sign in",
        form: [{ kind: "button" as const, key: "signIn", label: "Sign in" }],
        flow: { kind: "navigate" as const, url: "https://hub.minimax.io/login", callback: "https://hub.minimax.io/auth/callback" },
      },
      { id: "token", label: "Paste a token", form: [{ kind: "field" as const, key: "accessToken", label: "Token", secret: true }] },
    ],
  },
} as never;

const apiKeyOnly = {
  id: "minimax",
  name: "MiniMax",
  auth: { methods: [{ id: "api-key", label: "API key", form: [{ kind: "field" as const, key: "apiKey", label: "API key", secret: true }] }] },
} as never;

describe("declaredFlow", () => {
  it("finds the flow on the method that declares one", () => {
    expect(declaredFlow([hub], "hilo-hub", "sign-in")).toMatchObject({ kind: "navigate" });
  });

  it("answers nothing for a method that collects a field instead", () => {
    // Answering with the sibling's flow would open a browser for a user who chose to paste a token.
    expect(declaredFlow([hub], "hilo-hub", "token")).toBeUndefined();
  });

  it("answers nothing for a Provider whose only method is an api key", () => {
    expect(declaredFlow([apiKeyOnly], "minimax", "api-key")).toBeUndefined();
  });

  it("falls back to the one method that opens a browser when no method is named", () => {
    // The start route names a Provider and nothing else. hub declares three methods and exactly one
    // of them has a flow, so there is a single right answer and no guessing involved.
    expect(declaredFlow([hub], "hilo-hub")).toMatchObject({ kind: "navigate" });
  });

  it("refuses to guess when two methods each open a browser", () => {
    // Picking the first would open whichever the plugin happened to list first.
    const twoFlows = {
      id: "two",
      name: "Two",
      auth: {
        methods: [
          { id: "a", label: "A", flow: { kind: "navigate" as const, url: "https://a.test/", callback: "https://a.test/cb" } },
          { id: "b", label: "B", flow: { kind: "navigate" as const, url: "https://b.test/", callback: "https://b.test/cb" } },
        ],
      },
    } as never;
    expect(declaredFlow([twoFlows], "two")).toBeUndefined();
  });

  it("names the button belonging to the chosen method", () => {
    expect(declaredFlowButtonKey([hub], "hilo-hub", "sign-in")).toBe("signIn");
    expect(declaredFlowButtonKey([hub], "hilo-hub", "token")).toBeUndefined();
  });
});
