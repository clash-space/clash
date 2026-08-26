import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("MessageErrorBoundary primitives", () => {
  it("uses the shared error feedback surface", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/copilot/MessageErrorBoundary.tsx"),
      "utf8",
    );

    expect(source).toContain("../ui/feedback");
    expect(source).toContain('<FeedbackSurface tone="error"');
    expect(source).not.toContain("clash-copilot-alert-error");
  });
});
