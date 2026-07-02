import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("BillingClient primitives", () => {
  it("uses the shared Button primitive for top-up checkout controls", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/BillingClient.tsx"),
      "utf8",
    );

    expect(source).toContain("./ui/button");
    expect(source).toMatch(/<Button[\s\S]*onClick=\{handle\}[\s\S]*pack\.credits/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{handle\}[\s\S]*pack\.credits/);
  });

  it("uses the shared Button primitive for plan checkout controls", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/BillingClient.tsx"),
      "utf8",
    );

    expect(source).toContain("./ui/button");
    expect(source).toMatch(/<Button[\s\S]*onClick=\{handle\}[\s\S]*free \? "Default plan"/);
    expect(source).not.toMatch(/<button[\s\S]*onClick=\{handle\}[\s\S]*free \? "Default plan"/);
  });
});
