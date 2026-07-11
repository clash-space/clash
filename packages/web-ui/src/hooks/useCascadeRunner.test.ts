import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("useCascadeRunner architecture", () => {
  it("delegates gate, cancellation, and failure scheduling to shared runtime", () => {
    const source = readFileSync(
      new URL("./useCascadeRunner.ts", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /planCascadeTick[\s\S]*from ['"]@clash\/shared-runtime['"]/,
    );
    expect(source).not.toContain("Phase 1: cancel requests");
    expect(source).not.toContain("Phase 2: failure short-circuit");
    expect(source).not.toContain("Phase 3: adoption");
  });
});
