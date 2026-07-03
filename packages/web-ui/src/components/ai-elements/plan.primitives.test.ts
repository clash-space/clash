import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readAiElementSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components/ai-elements", file), "utf8");

describe("PlanBar primitives", () => {
  it("uses shared popover primitives for the expanded checklist instead of hand-written dialog markup", () => {
    const source = readAiElementSource("plan.tsx");

    expect(source).toContain("../ui/popover");
    expect(source).toContain("../ui/button");
    expect(source).toContain("Popover");
    expect(source).toContain("PopoverTrigger");
    expect(source).toContain("PopoverContent");
    expect(source).not.toContain("aria-expanded={open}");
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain("<button");
  });
});
