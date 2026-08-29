import { readFileSync } from "node:fs";
import { BezierEdge, type EdgeTypes } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { sourceMatches } from "../test-support/source-match";

describe("ProjectEditor canvas edge types", () => {
  it("renders persisted copy-on-write lineage edges without React Flow fallback", async () => {
    const editorModule = (await import("./ProjectEditor")) as unknown as {
      projectCanvasEdgeTypes?: EdgeTypes;
    };
    const source = readFileSync(
      new URL("./ProjectEditor.tsx", import.meta.url),
      "utf8",
    );

    expect(editorModule.projectCanvasEdgeTypes?.["copy-on-write"]).toBe(
      BezierEdge,
    );
    expect(editorModule.projectCanvasEdgeTypes?.reference).toBe(BezierEdge);
    expect(
      sourceMatches(
        source,
        /<ReactFlow[\s\S]*?edgeTypes=\{projectCanvasEdgeTypes\}/,
      ),
      "ProjectEditor must pass the persisted semantic edge mapping to React Flow",
    ).toBe(true);
  });

  it("logs each React Flow error only once instead of flooding Electron IPC", async () => {
    const editorModule = (await import("./ProjectEditor")) as unknown as {
      createProjectCanvasErrorHandler?: (
        log: (message: string) => void,
      ) => (id: string, message: string) => void;
    };
    const messages: string[] = [];

    expect(editorModule.createProjectCanvasErrorHandler).toBeTypeOf("function");
    const onError = editorModule.createProjectCanvasErrorHandler?.((message) =>
      messages.push(message),
    );
    onError?.("003", 'Node type "model" not found.');
    onError?.("003", 'Node type "model" not found.');
    onError?.("011", 'Edge type "future-lineage" not found.');

    expect(messages).toEqual([
      '[React Flow 003] Node type "model" not found.',
      '[React Flow 011] Edge type "future-lineage" not found.',
    ]);
  });
});
