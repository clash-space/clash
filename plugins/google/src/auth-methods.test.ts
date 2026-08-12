import { describe, expect, it } from "vitest";

import { GOOGLE_AUTH } from "./google-adapter.js";
import { PluginAuthDeclarationSchema, authFormControls, missingAuthKeys } from "@clash/shared-types";

/**
 * Three coherent configurations, each complete on its own.
 *
 * Google has two surfaces and two credentials, and they do not pair off evenly. A service account
 * signs an RFC 7523 assertion that only Agent Platform accepts. An API key works on both: AI Studio
 * directly, Agent Platform in Express mode. And a region is an Agent Platform concept -- AI Studio
 * has no such thing.
 *
 * Expressed as one form this needed a `service` choice plus a condition hiding it, and before that
 * a notice that falsely claimed Agent Platform refuses API keys. Expressed as methods, each one
 * carries exactly the fields that configuration needs and nothing has to be hidden or inferred:
 * `region` simply is not in the AI Studio method, rather than being present and irrelevant.
 */
describe("GOOGLE_AUTH", () => {
  it("is a valid declaration", () => {
    expect(PluginAuthDeclarationSchema.safeParse(GOOGLE_AUTH).success).toBe(true);
  });

  it("offers the three configurations that actually work", () => {
    expect(GOOGLE_AUTH.methods.map((method) => method.id))
      .toEqual(["ai-studio", "agent-platform-key", "service-account"]);
  });

  it("asks AI Studio for a key and nothing else", () => {
    // No region: AI Studio has none, and a field that is present and ignored teaches the reader
    // that fields can be ignored.
    expect(authFormControls(GOOGLE_AUTH, {}, "ai-studio").flatMap((c) => ("key" in c ? [c.key] : [])))
      .toEqual(["apiKey"]);
  });

  it("asks Agent Platform for a region alongside either credential", () => {
    expect(authFormControls(GOOGLE_AUTH, {}, "agent-platform-key").flatMap((c) => ("key" in c ? [c.key] : [])))
      .toEqual(["apiKey", "region"]);
    expect(authFormControls(GOOGLE_AUTH, {}, "service-account").flatMap((c) => ("key" in c ? [c.key] : [])))
      .toEqual(["serviceAccountKey", "region"]);
  });

  it("treats a declared region default as supplied", () => {
    // Measured: gemini-3.1-flash-image answers on global and 404s on us-central1, so global is a
    // default the product can stand behind rather than a guess.
    expect(missingAuthKeys(GOOGLE_AUTH, { apiKey: "k" }, "agent-platform-key")).toEqual([]);
  });

  it("reports the credential each method still needs", () => {
    expect(missingAuthKeys(GOOGLE_AUTH, {}, "ai-studio")).toEqual(["apiKey"]);
    expect(missingAuthKeys(GOOGLE_AUTH, {}, "service-account")).toEqual(["serviceAccountKey"]);
  });
});
