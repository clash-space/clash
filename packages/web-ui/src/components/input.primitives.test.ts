import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const inputConsumers: Array<{ file: string; ownerFile?: string }> = [
  { file: "packages/web-ui/src/components/ProjectEditor.tsx" },
  { file: "packages/web-ui/src/components/SettingsClient.tsx" },
  { file: "packages/web-ui/src/components/ImageEditorContext.tsx" },
  {
    file: "packages/web-ui/src/components/MarketplaceClient.tsx",
    ownerFile: "packages/web-ui/src/components/SearchFilterToolbar.tsx",
  },
  { file: "packages/web-ui/src/components/copilot/ChatInput.tsx" },
  { file: "packages/web-ui/src/components/nodes/ActionBadge.tsx" },
  { file: "packages/web-ui/src/components/nodes/AudioNode.tsx" },
  { file: "packages/web-ui/src/components/nodes/GroupNode.tsx" },
  { file: "packages/web-ui/src/components/nodes/ImageNode.tsx" },
  { file: "packages/web-ui/src/components/nodes/PromptNode.tsx" },
  // TextNode renders no input control at all -- editing happens in the shared
  // editor surface -- so requiring the Input primitive here asserted nothing.
  { file: "packages/web-ui/src/components/nodes/VideoNode.tsx" },
];

describe("Input primitives", () => {
  it.each(inputConsumers)("$file uses or delegates to the shared Input primitive", ({ file, ownerFile }) => {
    const inputPath = join(process.cwd(), "packages/gui/src/components/ui/input.tsx");
    const inputSource = existsSync(inputPath) ? readFileSync(inputPath, "utf8") : "";
    const source = readSource(file);
    const ownerSource = ownerFile ? readSource(ownerFile) : source;

    expect(existsSync(inputPath)).toBe(true);
    expect(inputSource).toContain("forwardRef");
    expect(ownerSource).toContain("/ui/input");
    expect(ownerSource).toContain("<Input");
    if (ownerFile) {
      expect(source).toContain("./SearchFilterToolbar");
      expect(source).toContain("<SearchFilterToolbar");
    }
    // Raw text-like inputs must go through the primitive. `type="color"` and
    // `type="file"` have no shared primitive and are native swatch/picker
    // controls, so a blanket ban only forced them to be smuggled in elsewhere.
    const rawInputs = source.match(/<input\b[\s\S]*?>/g) ?? [];
    const unexempt = rawInputs.filter(
      (tag) => !/type="(?:color|file)"/u.test(tag),
    );
    expect(unexempt, `raw inputs without a primitive: ${unexempt.join(" | ")}`).toEqual([]);

    const rawOwnerInputs = ownerSource.match(/<input\b[\s\S]*?>/g) ?? [];
    expect(rawOwnerInputs, `delegated raw inputs: ${rawOwnerInputs.join(" | ")}`).toEqual([]);
  });
});
