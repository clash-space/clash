import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("AgentMotion primitives", () => {
  it("uses a movement primitive for pointer-reactive eyes instead of window pointer listeners", () => {
    const source = readSource("packages/web-ui/src/components/copilot/AgentMotion.tsx");

    expect(source).toContain("@use-gesture/react");
    expect(source).toContain("useMove");
    expect(source).toContain("bindAgentGaze");
    expect(source).toContain("{...bindAgentGaze()}");
    expect(source).not.toContain("window.addEventListener('pointermove'");
    expect(source).not.toContain("window.removeEventListener('pointermove'");
  });
});
