import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("AppFeedback primitives", () => {
  it("uses the shared IconButton primitive for toast dismiss controls", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/AppFeedback.tsx"),
      "utf8",
    );

    expect(source).toContain("./ui/icon-button");
    expect(source).toContain("<IconButton");
    expect(source).not.toMatch(/<button[\s\S]*aria-label="Dismiss notification"/);
  });
});
