import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readRouteSource = (file: string) =>
  readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

describe("auth route primitives", () => {
  it.each(["auth.cli.tsx"])(
    "%s routes action buttons through the shared button primitive",
    (file) => {
      const source = readRouteSource(file);

      expect(source).toContain("@clash/gui/components/ui/button");
      expect(source).toContain("@clash/gui/components/ui/feedback");
      expect(source).toContain("<Button");
      expect(source).toContain("<InlineAlert");
      expect(source).not.toContain("<button");
    },
  );
});
