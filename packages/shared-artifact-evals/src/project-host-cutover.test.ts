import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { sourceContains } from "@clash/gui/test-support/source-match";

const source = async (name: string) =>
  readFile(new URL(name, import.meta.url), "utf8");

describe("artifact benchmark Project Host cutover", () => {
  it("uses the shared ProjectHostClient without reviving the retired project daemon", async () => {
    const production = [
      await source("./runner.ts"),
      await source("./product-readback.ts"),
      await source("./project-host.ts"),
    ].join("\n");

    expect(sourceContains(production, "createProjectHostClient")).toBe(true);
    for (const retiredMechanism of [
      'spawn(input.host.agentCliPath, ["canvas", "connect"]',
      "sendDaemonCommand",
      "ProjectDaemon",
      "ProductDaemon",
      ".mcp.json",
      "streamable-http",
      "mcpUrl",
    ]) {
      expect(
        sourceContains(production, retiredMechanism),
        `${retiredMechanism} must stay retired`,
      ).toBe(false);
    }
  });
});
