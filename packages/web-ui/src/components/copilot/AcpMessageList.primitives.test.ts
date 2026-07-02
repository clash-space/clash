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
    expect(source).not.toContain("aria-expanded={open}");
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

  it("uses shared collapsible primitives for shell command detail expansion", () => {
    const source = readCopilotSource("AcpMessageList.tsx");

    expect(source).toMatch(/<Collapsible\s+[\s\S]*open=\{open\}[\s\S]*onOpenChange=\{setOpen\}/);
    expect(source).toContain("CollapsibleTrigger asChild");
    expect(source).toContain('data-testid="acp-tool-details"');
    expect(source).toContain("CollapsibleContent");
    expect(source).not.toContain("onClick={() => setOpen((value) => !value)}");
    expect(source).not.toContain("{open ? (\n        <div data-testid=\"acp-tool-details\"");
    expect(source).not.toContain("{open ? (\n        <div className=\"mt-1 space-y-1.5\"");
  });

  it("uses shared collapsible primitives for thought and generic tool detail expansion", () => {
    const source = readCopilotSource("AcpMessageList.tsx");

    expect(source).toMatch(/<Collapsible\s+[\s\S]*data-testid="acp-thought-row"/);
    expect(source).toMatch(/<Collapsible\s+[\s\S]*data-testid="acp-tool-row"/);
    expect(source).toContain('data-testid="acp-thought-details"');
    expect(source).toContain('data-testid="acp-tool-details"');
    expect(source).not.toContain("onClick={hasBody ? () => setOpen((value) => !value) : undefined}");
    expect(source).not.toContain("aria-expanded={hasBody ? open : undefined}");
    expect(source).not.toContain("{hasBody && open ? (");
  });
});
