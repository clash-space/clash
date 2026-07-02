import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("ProjectEditor toolbar primitives", () => {
  it("uses the shared Radix toggle primitive for canvas mode instead of a hand-rolled toggle button", () => {
    const editorSource = readSource("packages/web-ui/src/components/ProjectEditor.tsx");
    const toggleSource = readSource("packages/web-ui/src/components/ui/toggle.tsx");

    expect(toggleSource).toContain("TogglePrimitive.Root");
    expect(editorSource).toContain("./ui/toggle");
    expect(editorSource).toContain("<Toggle");
    expect(editorSource).toContain("pressed={canvasMode === 'hand'}");
    expect(editorSource).toContain("onPressedChange={(pressed) => setCanvasMode(pressed ? 'hand' : 'select')}");
    expect(editorSource).not.toContain("onClick={() => setCanvasMode(prev => prev === 'select' ? 'hand' : 'select')}");
  });
});
