import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("ConfirmDialog primitives", () => {
  it("uses the shared Radix-backed alert dialog shell", () => {
    const source = readSource("packages/web-ui/src/components/ConfirmDialog.tsx");
    const shell = readSource(
      "packages/web-ui/src/components/ui/alert-dialog.tsx",
    );

    expect(source).toContain("./ui/alert-dialog");
    expect(source).not.toContain("AlertDialogPrimitive");
    expect(source).not.toContain("fixed inset-0 z-[10000]");

    expect(shell).toContain("AlertDialogPrimitive.Root");
    expect(shell).toContain("AlertDialogPrimitive.Overlay");
    expect(shell).toContain("AlertDialogPrimitive.Content");
    expect(shell).toContain("AlertDialogPrimitive.Action");
    expect(shell).toContain("AlertDialogPrimitive.Cancel");
  });
});
