import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ActivityToast primitives", () => {
  it("uses the shared IconButton primitive for icon-only toast actions", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/ActivityToast.tsx"),
      "utf8",
    );

    expect(source).toContain("./ui/icon-button");
    expect(source).toContain("<IconButton");
    expect(source).not.toMatch(/<button[\s\S]*aria-label="Go to node"/);
  });
});
