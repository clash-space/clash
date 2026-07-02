import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readCopilotSource = (file: string) =>
  readFileSync(join(process.cwd(), "packages/web-ui/src/components/copilot", file), "utf8");

describe("copilot proposal action primitives", () => {
  it("uses shared Button primitives for approval card actions", () => {
    const source = readCopilotSource("ApprovalCard.tsx");

    expect(source).toContain("../ui/button");
    expect(source).toMatch(/<Button[\s\S]*onClick=\{onApprove\}/);
    expect(source).toMatch(/<Button[\s\S]*onClick=\{onReject\}/);
    expect(source).not.toContain("<motion.button");
  });

  it("uses shared Button primitives for node proposal actions", () => {
    const source = readCopilotSource("NodeProposalCard.tsx");

    expect(source).toContain("../ui/button");
    expect(source).toMatch(/<Button[\s\S]*onClick=\{onReject\}/);
    expect(source).toMatch(/<Button[\s\S]*onClick=\{onAccept\}/);
    expect(source).toMatch(/<Button[\s\S]*onClick=\{onAcceptAndRun\}/);
    expect(source).not.toContain("<motion.button");
  });
});
