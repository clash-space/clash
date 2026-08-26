import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ActivityToast adapter", () => {
  it("routes activity through the shared AppFeedback system", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/ActivityToast.tsx"),
      "utf8",
    );

    expect(source).toContain("./AppFeedback");
    expect(source).toContain("feedback.notify");
    expect(source).not.toContain("AnimatePresence");
    expect(source).not.toContain("fixed bottom");
  });
});
