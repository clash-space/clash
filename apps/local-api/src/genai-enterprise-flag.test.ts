import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "local-acp.ts"), "utf8");

/**
 * Google renamed the platform and the flag that selects it.
 *
 * Vertex AI is now Gemini Enterprise Agent Platform, and the unified SDK selects it with
 * GOOGLE_GENAI_USE_ENTERPRISE. `vertexai` still exists as the legacy spelling — the SDK accepts
 * both and throws when they disagree — so reading only the old one leaves anyone who followed
 * current documentation looking at "not configured" with the variable set.
 *
 * Both are read here for the same reason the SDK keeps both: the old name is what existing setups
 * export, and dropping it would break them for a rename.
 */
describe("enterprise platform selection", () => {
  it("reads the current flag", () => {
    expect(source).toMatch(/GOOGLE_GENAI_USE_ENTERPRISE/);
  });

  it("still reads the legacy flag", () => {
    expect(source).toMatch(/GOOGLE_GENAI_USE_VERTEXAI/);
  });

  it("reports the platform by its current name", () => {
    expect(source).toMatch(/Gemini Enterprise Agent Platform/);
  });
});
