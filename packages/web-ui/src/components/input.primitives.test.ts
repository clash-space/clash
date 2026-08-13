import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Input primitives", () => {
  it.each([
    "packages/web-ui/src/components/ProjectEditor.tsx",
    "packages/web-ui/src/components/SettingsClient.tsx",
    "packages/web-ui/src/components/ImageEditorContext.tsx",
    "packages/web-ui/src/components/MarketplaceClient.tsx",
    "packages/web-ui/src/components/copilot/ChatInput.tsx",
    "packages/web-ui/src/components/nodes/ActionBadge.tsx",
    "packages/web-ui/src/components/nodes/AudioNode.tsx",
    "packages/web-ui/src/components/nodes/GroupNode.tsx",
    "packages/web-ui/src/components/nodes/ImageNode.tsx",
    "packages/web-ui/src/components/nodes/PromptNode.tsx",
    // TextNode renders no input control at all -- editing happens in the shared
    // editor surface -- so requiring the Input primitive here asserted nothing.
    "packages/web-ui/src/components/nodes/VideoNode.tsx",
  ])("%s uses the shared Input primitive instead of raw input controls", (file) => {
    const inputPath = join(process.cwd(), "packages/gui/src/components/ui/input.tsx");
    const inputSource = existsSync(inputPath) ? readFileSync(inputPath, "utf8") : "";
    const source = readSource(file);

    expect(existsSync(inputPath)).toBe(true);
    expect(inputSource).toContain("forwardRef");
    expect(source).toContain("/ui/input");
    expect(source).toContain("<Input");
    // Raw text-like inputs must go through the primitive. `type="color"` and
    // `type="file"` have no shared primitive and are native swatch/picker
    // controls, so a blanket ban only forced them to be smuggled in elsewhere.
    const rawInputs = source.match(/<input\b[\s\S]*?>/g) ?? [];
    const unexempt = rawInputs.filter(
      (tag) => !/type="(?:color|file)"/u.test(tag),
    );
    expect(unexempt, `raw inputs without a primitive: ${unexempt.join(" | ")}`).toEqual([]);
  });
});
