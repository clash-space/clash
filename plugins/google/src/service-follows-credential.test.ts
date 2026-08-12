import { describe, expect, it } from "vitest";

import { GOOGLE_AUTH, googleServiceFor } from "./google-adapter.js";
import { PluginAuthDeclarationSchema } from "@clash/shared-types";

/**
 * A service account fixes the surface; an API key does not.
 *
 * The two constraints are not symmetric, and treating them as if they were is how this went wrong
 * twice. A service account signs an RFC 7523 assertion, which only Agent Platform accepts -- so
 * holding one settles the question. An API key works on *both*: AI Studio takes it, and Agent
 * Platform takes it in Express mode. So a key leaves the choice open and the account must still say
 * which surface it means.
 *
 * The form previously offered `service` freely and carried a notice claiming Agent Platform does not
 * accept API keys. That notice was simply false, and it was the reason the field looked redundant.
 *
 * So `service` stays a choice, and is not offered when a service account is present: choosing
 * AI Studio there produces an account whose two settings contradict each other, and the
 * contradiction surfaces as an auth failure from Google rather than from the form that knew.
 */
// The `form` / `oneOf` cases that lived here are gone: both fields were deleted when the
// declaration became `methods`, where each method is a whole configuration and the alternatives are
// the methods themselves. What stays is the runtime behaviour -- which host a credential implies.
describe("google auth", () => {


  it("honours the chosen service when the account holds an API key", () => {
    // Express mode. A key on Agent Platform is a real configuration, not a mistake to correct.
    expect(googleServiceFor({ apiKey: "k", service: "agent-platform" })).toBe("agent-platform");
    expect(googleServiceFor({ apiKey: "k", service: "ai-studio" })).toBe("ai-studio");
  });

  it("forces Agent Platform when the account holds a service account", () => {
    // Even if the stored choice says otherwise: a store can hold a stale `service` from before the
    // key was pasted, and honouring it would sign an assertion for a surface that rejects it.
    expect(googleServiceFor({ serviceAccountKey: "{}", service: "ai-studio" })).toBe("agent-platform");
    expect(googleServiceFor({ serviceAccountKey: "{}" })).toBe("agent-platform");
  });

  it("refuses an account holding neither credential", () => {
    expect(() => googleServiceFor({ service: "ai-studio" })).toThrow(/apiKey|serviceAccountKey/);
  });

});
