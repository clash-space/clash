import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readComponent = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components", file), "utf8");

describe("editor modal action primitives", () => {
  it.each(["ImageEditorContext.tsx", "VideoClipperContext.tsx"])(
    "%s uses shared Button primitives for modal actions",
    (file) => {
      const source = readComponent(file);

      expect(source).toContain("./ui/button");
      expect(source).toMatch(/<Button[\s\S]*onClick=\{onClose\}/);
      expect(source).toMatch(/<Button[\s\S]*onClick=\{handleApply\}/);
      expect(source).not.toContain("<button");
    },
  );
});
