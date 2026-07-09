import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readScript(name: string): string {
  return readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");
}

describe("local data dir contract", () => {
  it("selects active local-api data stores by SQLite presence in conformance scripts", () => {
    const providerConformance = readScript("provider-conformance.ts");
    const googleAgentPlatform = readScript("google-agent-platform-conformance.ts");

    expect(providerConformance).toContain('existsSync(join(desktop, "local.sqlite"))');
    expect(googleAgentPlatform).toContain('existsSync(join(desktop, "local.sqlite"))');
    expect(providerConformance).not.toContain("|| existsSync(join(desktop,");
    expect(googleAgentPlatform).not.toContain("|| existsSync(join(desktop,");
  });
});
