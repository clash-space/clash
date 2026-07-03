import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readAiElementSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components/ai-elements", file), "utf8");

describe("AI element collapsible triggers", () => {
  it.each(["reasoning.tsx", "tool.tsx"])("%s renders trigger chrome through the shared button primitive", (file) => {
    const source = readAiElementSource(file);

    expect(source).toContain("../ui/button");
    expect(source).toContain("CollapsibleTrigger");
    expect(source).toContain("CollapsibleTrigger asChild");
    expect(source).toContain("<Button");
    expect(source).not.toContain("<CollapsibleTrigger\n      className=");
  });
});
