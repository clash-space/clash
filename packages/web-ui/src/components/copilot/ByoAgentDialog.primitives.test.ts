import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ByoAgentDialog primitives", () => {
  it("uses the shared Button primitive for copying the bridge command", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/copilot/ByoAgentDialog.tsx"),
      "utf8",
    );

    expect(source).toContain("../ui/button");
    expect(source).toMatch(/<Button[\s\S]*onClick=\{onCopy\}[\s\S]*Copy command/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{onCopy\}/);
  });
});
