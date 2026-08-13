import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("AttributionLine primitives", () => {
  it("uses the shared tooltip primitive for actor ids instead of browser title attributes", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/nodes/AttributionLine.tsx"),
      "utf8",
    );
    const tooltipSource = readFileSync(
      join(process.cwd(), "packages/gui/src/components/ui/tooltip.tsx"),
      "utf8",
    );

    expect(tooltipSource).toContain("@ariakit/react");
    expect(source).toContain("../ui/tooltip");
    expect(source).toContain("<Tooltip label={`actorUserId=${actorUserId}`}>");
    expect(source).toContain("<Tooltip label={`actorAgentId=${actorAgentId} actorUserId=${actorUserId}`}>");
    expect(source).not.toContain("title={`actorUserId=${actorUserId}`}");
    expect(source).not.toContain("title={`actorAgentId=${actorAgentId} actorUserId=${actorUserId}`}");
    expect(source).not.toContain("TooltipProvider");
    expect(source).not.toContain("TooltipAnchor");
  });
});
