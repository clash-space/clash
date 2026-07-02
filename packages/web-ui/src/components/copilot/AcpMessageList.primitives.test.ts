import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readCopilotSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components/copilot", file), "utf8");

describe("AcpMessageList primitives", () => {
  it("uses shared popover primitives for the progress panel instead of hand-written dialog markup", () => {
    const source = readCopilotSource("AcpMessageList.tsx");

    expect(source).toContain("../ui/popover");
    expect(source).toContain("Popover");
    expect(source).toContain("PopoverTrigger");
    expect(source).toContain("PopoverContent");
    expect(source).not.toContain('role="dialog"');
  });

  it("uses shared collapsible primitives for raw ACP event expansion", () => {
    const source = readCopilotSource("AcpMessageList.tsx");

    expect(source).toContain("../ui/collapsible");
    expect(source).toContain("Collapsible");
    expect(source).toContain("CollapsibleTrigger");
    expect(source).toContain("CollapsibleContent");
    expect(source).not.toContain("<details");
    expect(source).not.toContain("<summary");
  });
});
