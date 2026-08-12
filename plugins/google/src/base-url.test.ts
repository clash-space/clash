import { describe, expect, it } from "vitest";

import { googleBaseUrl } from "./base-url.js";

/**
 * Which host to call follows from what the account stored.
 *
 * The executor read `context.endpoint` and refused without it -- but `endpoint` is optional on the
 * SDK context and means "where this account points, when it is not the vendor's default". No host
 * fills it for an ordinary account, so a service account that had just successfully exchanged its
 * key for a token then failed with "Google executor needs the account's base url".
 *
 * The account does say which host, in the terms its auth method declares: `service` picks between
 * the two Google runs, and Agent Platform additionally needs `region`. Turning those into a URL is
 * API shape translation, which is this plugin's whole job -- the host must not know that a field
 * called `service` names a Google deployment.
 */
describe("googleBaseUrl", () => {
  it("points AI Studio at the generative language host", () => {
    expect(googleBaseUrl({ service: "ai-studio" }))
      .toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("ignores a region on AI Studio, which does not have any", () => {
    // The auth method does not offer the field. One arriving anyway is stale storage, not a
    // different host.
    expect(googleBaseUrl({ service: "ai-studio", region: "us-central1" }))
      .toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("points Agent Platform at the account's region", () => {
    expect(googleBaseUrl({ service: "agent-platform", region: "us-central1" }))
      .toBe("https://us-central1-aiplatform.googleapis.com/v1");
  });

  it("uses the global endpoint when the region is global", () => {
    // `global` is a real Vertex region and is spelled without a prefix. Interpolating it the usual
    // way yields `global-aiplatform.googleapis.com`, which does not resolve.
    expect(googleBaseUrl({ service: "agent-platform", region: "global" }))
      .toBe("https://aiplatform.googleapis.com/v1");
  });

  it("defaults to Agent Platform when a service account is what was stored", () => {
    // The service-account method forbids configuring `service` -- it is only for Agent Platform, so
    // asking would be asking a question with one answer.
    expect(googleBaseUrl({ region: "global", hasServiceAccount: true }))
      .toBe("https://aiplatform.googleapis.com/v1");
  });

  it("prefers an explicitly configured endpoint over anything derived", () => {
    // A proxy in front of the vendor is the case `endpoint` exists for.
    expect(googleBaseUrl({ service: "ai-studio", endpoint: "https://proxy.internal/v1" }))
      .toBe("https://proxy.internal/v1");
  });

  it("refuses Agent Platform with no region rather than guessing one", () => {
    // Picking a default region would send the request somewhere the user did not choose, and quota
    // and data residency are both per-region.
    expect(() => googleBaseUrl({ service: "agent-platform" })).toThrow(/region/i);
  });
});

describe("googleBaseUrl and a stored service", () => {
  it("honours an explicit ai-studio service even when a bearer token is present", () => {
    // `hasServiceAccount` was wired to `Boolean(accessToken)` -- but holding a token does not mean
    // the account authenticates with a service account key. An AI Studio account with a token was
    // therefore sent to Agent Platform, and failed asking for a project id it has no reason to
    // have. What the account stored under `service` is what it chose; nothing infers over it.
    expect(googleBaseUrl({ service: "ai-studio", hasServiceAccount: true }))
      .toBe("https://generativelanguage.googleapis.com/v1beta");
  });
})
