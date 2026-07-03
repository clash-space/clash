import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Codex copilot preview primitives", () => {
  it("routes composer controls through shared button primitives", () => {
    const source = readFileSync(
      join(process.cwd(), "apps/web/app/routes/__codex-copilot-preview.tsx"),
      "utf8",
    );

    expect(source).toContain("@clash/web-ui/components/ui/button");
    expect(source).toContain("@clash/web-ui/components/ui/icon-button");
    expect(source).toContain("<Button");
    expect(source).toContain("<IconButton");
    expect(source).not.toContain("<button");
  });
});
