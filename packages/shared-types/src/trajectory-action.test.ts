import { describe, expect, it } from "vitest";

import * as sharedTypes from "./index.js";

type CompileTrajectoryAction = (input: {
  targetNodeIds: string[];
  nodes: Array<{
    id: string;
    type?: string;
    data?: Record<string, unknown>;
  }>;
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    type?: string;
  }>;
}) => unknown;

type BindTrajectoryActionInputs = (
  action: {
    inputs: Array<{ slot: string; nodeId: string; valueType: string }>;
  },
  inputRefs: Array<{ slot: string; nodeId: string }>,
) => unknown;

const compileTrajectoryAction = (
  sharedTypes as typeof sharedTypes & {
    compileTrajectoryAction?: CompileTrajectoryAction;
  }
).compileTrajectoryAction;

const bindTrajectoryActionInputs = (
  sharedTypes as typeof sharedTypes & {
    bindTrajectoryActionInputs?: BindTrajectoryActionInputs;
  }
).bindTrajectoryActionInputs;

describe("compileTrajectoryAction", () => {
  it("turns a source image and image editor trajectory into an Action boundary", () => {
    const result = compileTrajectoryAction?.({
      targetNodeIds: ["edited"],
      nodes: [
        {
          id: "source",
          type: "image",
          data: { assetId: "asset-source", status: "completed" },
        },
        {
          id: "editor",
          type: "image-editor",
          data: { editParams: { rotation: 90 } },
        },
        {
          id: "edited",
          type: "image",
          data: { assetId: "asset-edited", status: "completed" },
        },
      ],
      edges: [
        { id: "source-editor", source: "source", target: "editor" },
        { id: "editor-edited", source: "editor", target: "edited" },
      ],
    });

    expect(result).toEqual({
      ok: true,
      action: {
        targetNodeIds: ["edited"],
        graph: {
          nodeIds: ["source", "editor", "edited"],
          edges: [
            { id: "source-editor", source: "source", target: "editor" },
            { id: "editor-edited", source: "editor", target: "edited" },
          ],
        },
        inputs: [{ slot: "input:0", nodeId: "source", valueType: "image" }],
        steps: [
          {
            nodeId: "editor",
            inputNodeIds: ["source"],
            outputNodeIds: ["edited"],
          },
        ],
        outputs: [{ slot: "output:0", nodeId: "edited", valueType: "image" }],
      },
    });
  });

  it("stops at source material instead of absorbing unrelated upstream nodes", () => {
    const result = compileTrajectoryAction?.({
      targetNodeIds: ["edited"],
      nodes: [
        { id: "unrelated", type: "image", data: { status: "completed" } },
        { id: "source", type: "image", data: { status: "completed" } },
        { id: "editor", type: "image-editor", data: {} },
        { id: "edited", type: "image", data: { status: "completed" } },
      ],
      edges: [
        { id: "unrelated-source", source: "unrelated", target: "source" },
        { id: "source-editor", source: "source", target: "editor" },
        { id: "editor-edited", source: "editor", target: "edited" },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        graph: {
          nodeIds: ["source", "editor", "edited"],
          edges: [
            { id: "source-editor", source: "source", target: "editor" },
            { id: "editor-edited", source: "editor", target: "edited" },
          ],
        },
        inputs: [{ slot: "input:0", nodeId: "source", valueType: "image" }],
      },
    });
  });

  it("lets a text input node be rebound without changing the source Action", () => {
    const compiled = compileTrajectoryAction?.({
      targetNodeIds: ["generated"],
      nodes: [
        { id: "source", type: "image", data: { status: "completed" } },
        {
          id: "prompt",
          type: "text",
          data: { content: "A warm afternoon" },
        },
        { id: "generator", type: "action-badge", data: {} },
        { id: "generated", type: "image", data: { status: "completed" } },
      ],
      edges: [
        { source: "source", target: "generator" },
        { source: "prompt", target: "generator" },
        { source: "generator", target: "generated" },
      ],
    });

    expect(compiled).toMatchObject({
      ok: true,
      action: {
        inputs: [
          { slot: "input:0", nodeId: "source", valueType: "image" },
          { slot: "input:1", nodeId: "prompt", valueType: "text" },
        ],
      },
    });
    if (!compiled || typeof compiled !== "object" || !("action" in compiled)) {
      throw new Error("Expected a compiled Trajectory Action");
    }

    const bound = bindTrajectoryActionInputs?.(
      compiled.action as {
        inputs: Array<{ slot: string; nodeId: string; valueType: string }>;
      },
      [{ slot: "input:1", nodeId: "replacement-prompt" }],
    );

    expect(bound).toEqual({
      ok: true,
      inputRefs: [
        { slot: "input:0", nodeId: "source" },
        { slot: "input:1", nodeId: "replacement-prompt" },
      ],
    });
    expect(
      (compiled.action as { inputs: Array<{ nodeId: string }> }).inputs[1]
        ?.nodeId,
    ).toBe("prompt");
  });
});
