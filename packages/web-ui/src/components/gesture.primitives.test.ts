import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Gesture primitives", () => {
  it("centralizes use-gesture behind shared gesture hooks", () => {
    const gesturePath = join(process.cwd(), "packages/gui/src/components/ui/gesture.ts");

    expect(existsSync(gesturePath)).toBe(true);

    const gestureSource = readFileSync(gesturePath, "utf8");
    expect(gestureSource).toContain("@use-gesture/react");
    expect(gestureSource).toContain("useDragGesture");
    expect(gestureSource).toContain("useMoveGesture");
  });

  it.each([
    "packages/web-ui/src/components/AwarenessLayer.tsx",
    "packages/web-ui/src/components/ChatbotCopilot.tsx",
    "packages/web-ui/src/components/ImageEditorContext.tsx",
    "packages/web-ui/src/components/copilot/AgentMotion.tsx",
  ])("%s routes gesture behavior through the shared primitive", (file) => {
    const source = readSource(file);

    expect(source).toContain("/ui/gesture");
    expect(source).not.toContain("@use-gesture/react");
    expect(source).not.toMatch(/\buseDrag\b/);
    expect(source).not.toMatch(/\buseMove\b/);
  });
});
