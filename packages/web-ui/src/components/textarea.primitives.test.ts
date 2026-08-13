import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Textarea primitives", () => {
  it.each([
    "packages/web-ui/src/components/SettingsClient.tsx",
    "packages/web-ui/src/components/nodes/ImageNode.tsx",
    "packages/web-ui/src/components/nodes/VideoNode.tsx",
    "packages/web-ui/src/components/nodes/StoryboardNode.tsx",
  ])("%s uses the shared Textarea primitive instead of raw textarea controls", (file) => {
    const textareaPath = join(process.cwd(), "packages/gui/src/components/ui/textarea.tsx");
    const textareaSource = existsSync(textareaPath) ? readFileSync(textareaPath, "utf8") : "";
    const source = readSource(file);

    expect(existsSync(textareaPath)).toBe(true);
    expect(textareaSource).toContain("forwardRef");
    expect(source).toContain("/ui/textarea");
    expect(source).toContain("<Textarea");
    expect(source).not.toContain("<textarea");
  });
});
