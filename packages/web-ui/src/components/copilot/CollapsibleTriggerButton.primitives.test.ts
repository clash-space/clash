import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const readCopilotSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components/copilot", file), "utf8");

describe("copilot collapsible trigger buttons", () => {
  it.each([
    ["ToolCall.tsx", /<Button[\s\S]*aria-label=\{isOpen/],
    ["ThinkingProcess.tsx", /<Button[\s\S]*t\('copilot\.thinking\.label'\)/],
    ["AgentCard.tsx", /<Button[\s\S]*agentName/],
    ["TodoList.tsx", /<Button[\s\S]*completedCount/],
  ])("%s uses the shared Button primitive for its collapsible trigger", (file, triggerPattern) => {
    const source = readCopilotSource(file);

    expect(source).toContain("../ui/button");
    expect(source).toMatch(triggerPattern);
    expect(source).not.toMatch(/<button[\s\S]*CollapsibleTrigger/);
  });
});
