import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("CloneTrajectoryDialog primitives", () => {
  it("uses the shared Radix-backed Dialog instead of a hand-rolled modal shell", () => {
    const source = readSource(
      "packages/web-ui/src/components/nodes/CloneTrajectoryDialog.tsx",
    );

    expect(source).toContain("../ui/dialog");
    expect(source).not.toContain("createPortal");
    expect(source).not.toContain("useDialogA11y");
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain('aria-modal="true"');
  });

  it("uses shared tooltip primitives instead of browser title attributes for preview affordances", () => {
    const source = readSource(
      "packages/web-ui/src/components/nodes/CloneTrajectoryDialog.tsx",
    );
    const tooltipSource = readSource("packages/web-ui/src/components/ui/tooltip.tsx");

    expect(tooltipSource).toContain("@ariakit/react");
    expect(source).toContain("../ui/tooltip");
    expect(source).toContain('<Tooltip label="Drop this action and everything upstream that only feeds it - its output becomes a reused head">');
    expect(source).toContain('<Tooltip label="Copied into the new trajectory with completed content preserved">');
    expect(source).toContain('<Tooltip label="Cloned as an empty draft placeholder - Build to fill">');
    expect(source).toContain("aria-label={applyLabel}");
    expect(source).not.toContain("title=");
    expect(source).not.toContain("TooltipProvider");
    expect(source).not.toContain("TooltipAnchor");
  });

  it("uses shared button primitives for clone dialog actions", () => {
    const source = readSource(
      "packages/web-ui/src/components/nodes/CloneTrajectoryDialog.tsx",
    );

    expect(source).toContain("../ui/button");
    expect(source).toContain("../ui/icon-button");
    expect(source).toMatch(/<Button[\s\S]*onClick=\{\(e\) => \{ e\.stopPropagation\(\); onDelete\(props\.id\); \}\}[\s\S]*drop stage/);
    expect(source).toMatch(/<IconButton[\s\S]*label="Close clone trajectory dialog"[\s\S]*onClick=\{onCancel\}/);
    expect(source).toMatch(/<Button[\s\S]*onClick=\{onCancel\}[\s\S]*Cancel/);
    expect(source).toMatch(/<Button[\s\S]*onClick=\{handleApply\}[\s\S]*Apply/);
    expect(source).not.toContain("<button");
  });
});
