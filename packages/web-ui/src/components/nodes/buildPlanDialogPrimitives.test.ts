import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("BuildPlanDialog primitives", () => {
  it("uses the shared Radix-backed Dialog instead of a hand-rolled modal shell", () => {
    const source = readSource(
      "packages/web-ui/src/components/nodes/BuildPlanDialog.tsx",
    );

    expect(source).toContain("../ui/dialog");
    expect(source).not.toContain("createPortal");
    expect(source).not.toContain("useDialogA11y");
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain('aria-modal="true"');
  });

  it("keeps shared Dialog customizable enough for canvas-layer modals", () => {
    const source = readSource("packages/web-ui/src/components/ui/dialog.tsx");

    expect(source).toContain("overlayClassName");
    expect(source).toContain("containerClassName");
    expect(source).toContain("contentClassName");
  });
});
