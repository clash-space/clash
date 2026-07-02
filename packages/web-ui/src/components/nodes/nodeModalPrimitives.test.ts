import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
  readFileSync(
    join(process.cwd(), "packages/web-ui/src/components/nodes", file),
    "utf8",
  );

describe("node modal primitives", () => {
  it("uses a shared Dialog-backed node modal shell for editable node dialogs", () => {
    const shell = readNodeSource("NodeModalDialog.tsx");

    expect(shell).toContain("../ui/dialog");
    expect(shell).toContain("Dialog");
  });

  it.each(["TextNode.tsx", "PromptNode.tsx", "AudioNode.tsx"])(
    "%s does not hand-roll its modal shell",
    (file) => {
      const source = readNodeSource(file);

      expect(source).toContain("./NodeModalDialog");
      expect(source).not.toContain("createPortal");
      expect(source).not.toContain("AnimatePresence");
      expect(source).not.toContain("<motion.div");
    },
  );

  it.each(["TextNode.tsx", "PromptNode.tsx"])(
    "%s uses shared primitives for modal actions",
    (file) => {
      const source = readNodeSource(file);

      expect(source).toContain("../ui/button");
      expect(source).toContain("../ui/icon-button");
      expect(source).toMatch(/<Button[\s\S]*onClick=\{handleSave\}/);
      expect(source).toMatch(/<IconButton[\s\S]*onClick=\{handleCancel\}/);
      expect(source).not.toMatch(/<button[\s\S]*onClick=\{handleSave\}/);
      expect(source).not.toMatch(/<button[\s\S]*onClick=\{handleCancel\}/);
    },
  );
});
