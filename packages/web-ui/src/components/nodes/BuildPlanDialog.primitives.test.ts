import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("BuildPlanDialog primitives", () => {
  it("uses shared button primitives for close and footer actions", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/nodes/BuildPlanDialog.tsx"),
      "utf8",
    );

    expect(source).toContain("../ui/icon-button");
    expect(source).toContain("../ui/button");
    expect(source).toMatch(/<IconButton[\s\S]*Close build plan dialog/);
    expect(source).toMatch(/<Button[\s\S]*onClick=\{onCancel\}[\s\S]*Cancel/);
    expect(source).toMatch(/<Button[\s\S]*onClick=\{onConfirm\}[\s\S]*Build/);
    expect(source).not.toMatch(/<button[\s\S]*Close build plan dialog/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{onCancel\}/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{onConfirm\}/);
  });
});
