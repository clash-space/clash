import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readRouteSource = (file: string) =>
  readFileSync(join(process.cwd(), "apps/web/app/routes", file), "utf8");

describe("auth route primitives", () => {
  it.each(["auth.cli.tsx", "connect-daemon.tsx"])(
    "%s routes action buttons through the shared button primitive",
    (file) => {
      const source = readRouteSource(file);

      expect(source).toContain("@clash/web-ui/components/ui/button");
      expect(source).toContain("<Button");
      expect(source).not.toContain("<button");
    },
  );
});
