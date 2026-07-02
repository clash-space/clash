import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("copilot disclosure primitives", () => {
  it("uses the shared Radix-backed collapsible primitive", () => {
    const sources = [
      "packages/web-ui/src/components/copilot/AgentCard.tsx",
      "packages/web-ui/src/components/copilot/ThinkingProcess.tsx",
      "packages/web-ui/src/components/copilot/ToolCall.tsx",
    ].map(readSource);

    for (const source of sources) {
      expect(source).toContain("../ui/collapsible");
      expect(source).not.toContain("useDisclosure");
      expect(source).not.toContain("@clash/web-ui/lib/hooks/useDisclosure");
    }
  });
});
