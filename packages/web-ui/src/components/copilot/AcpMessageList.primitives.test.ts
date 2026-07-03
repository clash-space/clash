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

  it("lets the progress popover primitive own disclosure state", () => {
    const source = readCopilotSource("AcpMessageList.tsx");
    const panelStart = source.indexOf("export function AcpProgressPanel");
    const panelEnd = source.indexOf("\nexport function AcpMessageList", panelStart);
    const panelSource = source.slice(panelStart, panelEnd);

    expect(panelSource).toContain("<Popover");
    expect(panelSource).toContain("defaultOpen={defaultOpen}");
    expect(panelSource).toContain('label="Toggle progress"');
    expect(panelSource).not.toContain("const [open, setOpen]");
    expect(panelSource).not.toContain("<Popover open=");
    expect(panelSource).not.toContain("onOpenChange={setOpen}");
    expect(panelSource).not.toContain("label={open ?");
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

  it("uses the shared button primitive for raw ACP event expansion triggers", () => {
    const source = readCopilotSource("AcpMessageList.tsx");
    const rawEventStart = source.indexOf("// raw_event fallback");
    const rawEventEnd = source.indexOf("</Collapsible>", rawEventStart);
    const rawEventSource = source.slice(rawEventStart, rawEventEnd);

    expect(rawEventSource).toContain("CollapsibleTrigger asChild");
    expect(rawEventSource).toContain("<Button");
    expect(rawEventSource).toContain("<AcpEventIcon");
    expect(rawEventSource).not.toContain("<CollapsibleTrigger className=");
  });

  it("uses shared collapsible primitives for shell command detail expansion", () => {
    const source = readCopilotSource("AcpMessageList.tsx");

    expect(source).toMatch(/<Collapsible\s+[\s\S]*defaultOpen=\{defaultOpen\}/);
    expect(source).toContain("CollapsibleTrigger asChild");
    expect(source).toContain('data-testid="acp-tool-details"');
    expect(source).toContain("CollapsibleContent");
    expect(source).not.toContain("onClick={() => setOpen((value) => !value)}");
    expect(source).not.toContain("{open ? (\n        <div data-testid=\"acp-tool-details\"");
    expect(source).not.toContain("{open ? (\n        <div className=\"mt-1 space-y-1.5\"");
  });

  it("lets Radix own shell command row disclosure state", () => {
    const source = readCopilotSource("AcpMessageList.tsx");

    for (const functionName of ["ShellCommandEntry", "ShellCommandGroup"]) {
      const start = source.indexOf(`function ${functionName}`);
      const nextFunction = source.indexOf("\nfunction ", start + 1);
      const end = nextFunction === -1 ? source.length : nextFunction;
      const functionSource = source.slice(start, end);

      expect(functionSource).toContain("defaultOpen={defaultOpen}");
      expect(functionSource).not.toContain("const [open, setOpen]");
      expect(functionSource).not.toContain("open={open}");
      expect(functionSource).not.toContain("onOpenChange={setOpen}");
    }
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

  it("lets Radix collapsible trigger state rotate ACP row chevrons", () => {
    const source = readCopilotSource("AcpMessageList.tsx");
    const stateDrivenRotations = source.match(/group-data-\[state=open\]:rotate-90/g) ?? [];

    expect(stateDrivenRotations.length).toBeGreaterThanOrEqual(5);
    expect(source).not.toContain("open && 'rotate-90'");
  });

  it("uses the shared tooltip primitive for truncated ACP labels instead of browser title attributes", () => {
    const source = readCopilotSource("AcpMessageList.tsx");
    const tooltipSource = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/ui/tooltip.tsx"),
      "utf8",
    );

    expect(tooltipSource).toContain("@ariakit/react");
    expect(source).toContain("../ui/tooltip");
    expect(source).toContain("<Tooltip label={label}>");
    expect(source).toContain("<Tooltip label={target}>");
    expect(source).toContain("<Tooltip label={loc.path}");
    expect(source).not.toContain("title={label}");
    expect(source).not.toContain("title={target}");
    expect(source).not.toContain("title={loc.path}");
    expect(source).not.toContain("TooltipProvider");
    expect(source).not.toContain("TooltipAnchor");
  });

  it("uses shared button primitives for ACP row and progress triggers", () => {
    const source = readCopilotSource("AcpMessageList.tsx");

    expect(source).toContain("../ui/button");
    expect(source).toContain("../ui/icon-button");
    expect(source).toMatch(/<Button[\s\S]*ShellEventIcon/);
    expect(source).toMatch(/<Button[\s\S]*AcpEventIcon/);
    expect(source).toMatch(/<IconButton[\s\S]*Toggle progress/);
    expect(source).not.toMatch(/<button[\s\S]*ShellEventIcon/);
    expect(source).not.toMatch(/<button[\s\S]*AcpEventIcon/);
    expect(source).not.toMatch(/<button[\s\S]*Toggle progress/);
  });
});
