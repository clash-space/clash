import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const readCopilotSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components/copilot", file), "utf8");

describe("copilot collapsible trigger buttons", () => {
  it.each([
    ["ToolCall.tsx", /<Button[\s\S]*t\('copilot\.toolCall\.toggle'\)/],
    ["ThinkingProcess.tsx", /<Button[\s\S]*t\('copilot\.thinking\.label'\)/],
    ["AgentCard.tsx", /<Button[\s\S]*agentName/],
    ["TodoList.tsx", /<Button[\s\S]*completedCount/],
  ])("%s uses the shared Button primitive for its collapsible trigger", (file, triggerPattern) => {
    const source = readCopilotSource(file);

    expect(source).toContain("../ui/button");
    expect(source).toMatch(triggerPattern);
    expect(source).not.toMatch(/<button[\s\S]*CollapsibleTrigger/);
  });

  it("lets Radix own ThinkingProcess disclosure state", () => {
    const source = readCopilotSource("ThinkingProcess.tsx");

    expect(source).toContain("<Collapsible");
    expect(source).toContain("defaultOpen={initialExpanded}");
    expect(source).not.toContain("useState");
    expect(source).not.toContain("isOpen");
    expect(source).not.toContain("setIsOpen");
    expect(source).not.toContain("open={");
    expect(source).not.toContain("onOpenChange");
  });

  it("lets Radix own ToolCall disclosure state", () => {
    const source = readCopilotSource("ToolCall.tsx");

    expect(source).toContain("<Collapsible");
    expect(source).toContain("defaultOpen={initialExpanded}");
    expect(source).not.toContain("useState");
    expect(source).not.toContain("isOpen");
    expect(source).not.toContain("setIsOpen");
    expect(source).not.toContain("open={");
    expect(source).not.toContain("onOpenChange");
    expect(source).not.toContain("copilot.toolCall.expand");
    expect(source).not.toContain("copilot.toolCall.collapse");
  });

  it("lets Radix own AgentCard disclosure state", () => {
    const source = readCopilotSource("AgentCard.tsx");

    expect(source).toContain("<Collapsible");
    expect(source).toContain("defaultOpen={initialExpanded}");
    expect(source).not.toContain("useState");
    expect(source).not.toContain("isOpen");
    expect(source).not.toContain("setIsOpen");
    expect(source).not.toContain("open={");
    expect(source).not.toContain("onOpenChange");
  });
});
