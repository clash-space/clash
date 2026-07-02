import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("UserMessage primitives", () => {
  it("uses the shared tooltip primitive for inline thumbnails instead of an image title attribute", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/copilot/UserMessage.tsx"),
      "utf8",
    );
    const tooltipSource = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/ui/tooltip.tsx"),
      "utf8",
    );

    expect(tooltipSource).toContain("@ariakit/react");
    expect(source).toContain("../ui/tooltip");
    expect(source).toContain("<Tooltip label={tooltipLabel}>");
    expect(source).not.toContain("title={nodeId ? `${title} — click to focus, double-click to preview` : title}");
    expect(source).not.toContain("TooltipProvider");
    expect(source).not.toContain("TooltipAnchor");
  });
});
