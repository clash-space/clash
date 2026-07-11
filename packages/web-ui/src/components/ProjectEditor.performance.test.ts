import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function projectEditorSource() {
  return readFileSync(new URL("./ProjectEditor.tsx", import.meta.url), "utf8");
}

describe("ProjectEditor canvas performance", () => {
  it("keeps ReactFlow viewport virtualization enabled", () => {
    const source = projectEditorSource();

    expect(source).toMatch(/onlyRenderVisibleElements/);
  });

  it("keeps Loro mutations outside React state updater functions", () => {
    const source = projectEditorSource();
    const sourceFile = ts.createSourceFile(
      "ProjectEditor.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const impureUpdaters: string[] = [];

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === "setNodes" || node.expression.text === "setEdges")
      ) {
        const updater = node.arguments[0];
        if (
          updater &&
          (ts.isArrowFunction(updater) || ts.isFunctionExpression(updater)) &&
          updater.getText(sourceFile).includes("loroSync")
        ) {
          impureUpdaters.push(updater.getText(sourceFile));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(impureUpdaters).toEqual([]);
  });
});
