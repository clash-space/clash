// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { CustomActionDefinitionSchema } from "@clash/shared-types";
import { describe, expect, it, vi } from "vitest";

import { useSpawnPendingAsset } from "./useSpawnPendingAsset";

vi.mock("@clash/web-ui/lib/betterAuthClient", () => ({
  default: {
    useSession: () => ({ data: { user: { id: "user-1" } } }),
  },
}));

describe("useSpawnPendingAsset", () => {
  it("uses an upgraded Custom Action binding when the next output is created", async () => {
    const oldBinding = {
      pluginId: "clash.codex-imagegen",
      version: "0.1.0",
      exportId: "generate-image",
      schemaHash: `sha256:${"a".repeat(64)}` as const,
    };
    const currentBinding = {
      ...oldBinding,
      version: "0.1.1",
      schemaHash: `sha256:${"b".repeat(64)}` as const,
    };
    const customDef = CustomActionDefinitionSchema.parse({
      id: "codex-imagegen",
      name: "Codex ImageGen",
      outputType: "image",
      presentation: { type: "form" },
      parameters: [],
      runtime: "local",
      version: currentBinding.version,
      pluginBinding: currentBinding,
    });
    const customActionParams = {};
    const modelParams = {};
    const refNodeIds: string[] = [];
    const getNodes = () => [
      {
        id: "action-1",
        type: "action-badge",
        position: { x: 0, y: 0 },
        data: {},
      },
    ];
    const addNodeWithAutoLayout = (node: any) => ({
      ...node,
      position: { x: 340, y: 0 },
    });
    const addNodeWithLayout = (node: any, position: any) => ({
      ...node,
      position,
    });
    const input = {
      actionBadgeId: "action-1",
      actionType: "custom:codex-imagegen",
      isCustom: true,
      customDef,
      customActionParams,
      modelId: "",
      modelParams,
      selectedModel: undefined,
      content: "A cat",
      lyrics: "",
      dataPrompt: undefined,
      projectId: "project-1",
      refNodeIds,
      getNodes,
      addNodeWithAutoLayout,
      addNodeWithLayout,
      addEdges: vi.fn(),
      setNodes: vi.fn(),
      loroSync: null,
    };
    const { result, rerender } = renderHook(
      ({ pluginBinding }) =>
        useSpawnPendingAsset({ ...input, pluginBinding }),
      { initialProps: { pluginBinding: oldBinding } },
    );

    rerender({ pluginBinding: currentBinding });
    const output = await result.current.spawnPending({ assetId: "output-1" });

    expect(output?.data.pluginBinding).toEqual(currentBinding);
  });
});
