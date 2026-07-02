import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("AwarenessLayer primitives", () => {
  it("uses a mature movement primitive for cursor awareness instead of window mousemove listeners", () => {
    const source = readSource("packages/web-ui/src/components/AwarenessLayer.tsx");

    expect(source).toContain("@use-gesture/react");
    expect(source).toContain("useMove");
    expect(source).toContain("moveTargetRef");
    expect(source).not.toContain("window.addEventListener('mousemove'");
    expect(source).not.toContain("window.removeEventListener('mousemove'");
  });
});
