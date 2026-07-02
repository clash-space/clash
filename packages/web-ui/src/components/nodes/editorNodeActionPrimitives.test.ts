import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes", file), "utf8");

describe("editor node action primitives", () => {
  it.each([
    ["ImageEditorNode.tsx", /<Button[\s\S]*onClick=\{handleOpen\}[\s\S]*Edit/],
    ["VideoClipperNode.tsx", /<Button[\s\S]*onClick=\{handleOpen\}[\s\S]*Clip/],
    ["VideoEditorNode.tsx", /<Button[\s\S]*onClick=\{handleRender\}[\s\S]*Render/],
  ])("%s uses the shared Button primitive for its footer action", (file, buttonPattern) => {
    const source = readNodeSource(file);

    expect(source).toContain("../ui/button");
    expect(source).toMatch(buttonPattern);
    expect(source).not.toContain("<button");
  });
});
