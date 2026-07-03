import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readAiElementSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components/ai-elements", file), "utf8");

const readComponentSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components", file), "utf8");

describe("AI element collapsible triggers", () => {
  it.each(["reasoning.tsx", "tool.tsx"])("%s renders trigger chrome through the shared button primitive", (file) => {
    const source = readAiElementSource(file);

    expect(source).toContain("../ui/button");
    expect(source).toContain("CollapsibleTrigger");
    expect(source).toContain("CollapsibleTrigger asChild");
    expect(source).toContain("<Button");
    expect(source).not.toContain("<CollapsibleTrigger\n      className=");
  });

  it("lets Radix collapsible trigger state rotate the reasoning chevron", () => {
    const source = readAiElementSource("reasoning.tsx");

    expect(source).toContain("group/reasoning-trigger");
    expect(source).toContain("group-data-[state=open]/reasoning-trigger:rotate-180");
    expect(source).not.toContain('isOpen ? "rotate-180" : "rotate-0"');
  });

  it("routes controllable state through the shared primitive boundary", () => {
    const primitivePath = join(process.cwd(), "packages/web-ui/src/components/ui/controllable-state.ts");
    const source = readAiElementSource("reasoning.tsx");

    expect(existsSync(primitivePath)).toBe(true);
    expect(readComponentSource("ui/controllable-state.ts")).toContain("@radix-ui/react-use-controllable-state");
    expect(source).toContain("../ui/controllable-state");
    expect(source).toContain("useControllableState");
    expect(source).not.toContain("@radix-ui/react-use-controllable-state");
  });
});
