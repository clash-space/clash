import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "local-aigc.ts"), "utf8");

/**
 * There is one Google route, and it takes an api key.
 *
 * Asked directly with a real key, both surfaces answered `:generateContent` with `x-goog-api-key`
 * and differed only by host — no project, no location, no service account, no signed JWT. So the
 * separate agent-platform branch is gone rather than taught about keys: it existed to hold a
 * different credential, and there is no longer a different credential.
 *
 * What that branch cost is worth recording. It demanded a service-account JSON, found none on an
 * account that had a perfectly good key, and skipped the route — after which hilo-hub answered a
 * request for nano-banana-2 indistinguishably. Both of us read the resulting image as a successful
 * Google generation.
 */
describe("the google route", () => {
  it("no longer branches on a separate agent platform shape", () => {
    expect(source).not.toMatch(/apiShape === "google-agent-platform"/);
  });

  it("reads an api key", () => {
    expect(source).toMatch(/apiShape === "google-ai-studio"[\s\S]{0,300}?"apiKey"/);
  });

  it("chooses the host from the account rather than from a constant", () => {
    expect(source).toMatch(/resolveAccountSetting\(\s*"google"/);
  });

  it("fails loudly instead of handing the model to whichever provider ranks next", () => {
    expect(source).toMatch(/apiShape === "google-ai-studio"[\s\S]{0,400}?throw new Error/);
  });
});
