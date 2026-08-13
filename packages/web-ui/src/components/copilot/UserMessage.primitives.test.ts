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
      join(process.cwd(), "packages/gui/src/components/ui/tooltip.tsx"),
      "utf8",
    );

    expect(tooltipSource).toContain("@ariakit/react");
    expect(source).toContain("../ui/tooltip");
    expect(source).toContain("<Tooltip label={tooltipLabel}>");
    expect(source).not.toContain("title={nodeId ? `${title} — click to focus, double-click to preview` : title}");
    expect(source).not.toContain("TooltipProvider");
    expect(source).not.toContain("TooltipAnchor");
  });

  it("uses the shared button primitive for inline thumbnail actions instead of clickable images", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/copilot/UserMessage.tsx"),
      "utf8",
    );
    const thumbnailStart = source.indexOf("function InlineThumbnail");
    const thumbnailEnd = source.indexOf("export function UserMessage", thumbnailStart);
    const thumbnailSource = source.slice(thumbnailStart, thumbnailEnd);

    expect(source).toContain("../ui/button");
    expect(thumbnailSource).toContain("<Button");
    expect(thumbnailSource).toContain("onClick={(e) =>");
    expect(thumbnailSource).toContain("onDoubleClick={(e) =>");
    expect(thumbnailSource).not.toMatch(/<img[\s\S]{0,500}onClick=/);
    expect(thumbnailSource).not.toMatch(/<img[\s\S]{0,500}onDoubleClick=/);
  });
});
