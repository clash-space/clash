import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("ProjectEditor keyboard primitives", () => {
  it("uses a mature hotkey hook for global keyboard shortcuts instead of window key listeners", () => {
    const source = readSource("packages/web-ui/src/components/ProjectEditor.tsx");
    const packageJson = readSource("packages/web-ui/package.json");

    expect(packageJson).toContain("react-hotkeys-hook");
    expect(source).toContain("react-hotkeys-hook");
    expect(source).toContain("useHotkeys");
    expect(source).toContain("handleGlobalHotkey");
    expect(source).toContain("handleSpaceKeyUp");
    expect(source).not.toContain("window.addEventListener('keydown'");
    expect(source).not.toContain("window.addEventListener('keyup'");
  });
});
