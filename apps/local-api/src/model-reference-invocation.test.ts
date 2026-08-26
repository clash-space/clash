import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectAsset, MODEL_CARDS } from "@clash/shared-types";

import { createLocalWorkflowProcessor } from "./local-processor.js";
import type {
  ExternalAigcService,
  ProviderPluginExecutionPlan,
} from "./local-aigc.js";

const temporaryDirectories: string[] = [];

async function temporaryDataDir(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "clash-model-reference-invocation-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const binding = {
  pluginId: "test.provider",
  version: "1.0.0",
  exportId: "execute",
  schemaHash: `sha256:${"d".repeat(64)}`,
} as const;

const plan: ProviderPluginExecutionPlan = {
  binding,
  accountId: "private-account",
  assetInputs: [],
  kind: "model",
  projectId: "project-1",
  nodeId: "node-1",
  provider: "test-provider",
  modelEndpoint: "model-v1",
  input: {
    values: {
      modelId: "tripo-auto-rig",
      upstreamModel: "model-v1",
      prompt: "",
      modelParams: {},
    },
    references: [],
  },
};

function aigc(
  planProviderPlugin: ExternalAigcService["planProviderPlugin"],
): ExternalAigcService {
  return {
    planProviderPlugin,
    generateImage: vi.fn(),
    generateVideo: vi.fn(),
    generateAudio: vi.fn(),
    generateText: vi.fn(),
  } as unknown as ExternalAigcService;
}

/** A pending Tripo Auto-Rig node (model-to-model): `kind: 'model'`, no prompt, driven
 *  entirely by `referenceModelAssetIds`. */
function pendingAutoRigDoc(referenceModelAssetIds: string[]): LoroDoc {
  const doc = new LoroDoc();
  doc.getMap("nodes").set("node-1", {
    id: "node-1",
    type: "model",
    position: { x: 0, y: 0 },
    data: {
      status: "pending",
      actionType: "model-gen",
      modelId: "tripo-auto-rig",
      prompt: "",
      ...(referenceModelAssetIds.length > 0
        ? { referenceModelAssetIds }
        : {}),
    },
  });
  return doc;
}

describe("model-to-model reference wiring end-to-end (Tripo H3.1 -> Tripo Auto-Rig)", () => {
  it("fails closed with the min=1 model-reference error when no model is attached", async () => {
    const dataDir = await temporaryDataDir();
    const doc = pendingAutoRigDoc([]);
    const planner = vi.fn(async () => plan);
    const processor = createLocalWorkflowProcessor({
      dataDir,
      modelCards: async () => MODEL_CARDS,
      aigc: aigc(planner),
    });

    await processor.process({ doc, projectId: "project-1" });

    expect((doc.getMap("nodes").get("node-1") as any).data).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/at least 1 reference model/i),
    });
    expect(planner).not.toHaveBeenCalled();
  });

  it("rejects a second attached model reference past the declared max=1 bound", async () => {
    const dataDir = await temporaryDataDir();
    const doc = pendingAutoRigDoc(["mesh-a", "mesh-b"]);
    for (const assetId of ["mesh-a", "mesh-b"]) {
      expect(
        createProjectAsset(doc, {
          id: assetId,
          kind: "model",
          source: {
            kind: "owned",
            resourceId: `sha256:${assetId === "mesh-a" ? "a".repeat(64) : "b".repeat(64)}`,
          },
          lifecycle: { state: "active" },
          metadata: { contentType: "model/gltf-binary" },
        }),
      ).toMatchObject({ ok: true });
    }
    const planner = vi.fn(async () => plan);
    const processor = createLocalWorkflowProcessor({
      dataDir,
      modelCards: async () => MODEL_CARDS,
      aigc: aigc(planner),
    });

    await processor.process({ doc, projectId: "project-1" });

    expect((doc.getMap("nodes").get("node-1") as any).data).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/at most 1 reference model/i),
    });
    expect(planner).not.toHaveBeenCalled();
  });

  it("materializes referenceModelAssetIds into a 'model' slot reference passed to the provider plugin", async () => {
    const dataDir = await temporaryDataDir();
    const doc = pendingAutoRigDoc(["mesh-a"]);
    expect(
      createProjectAsset(doc, {
        id: "mesh-a",
        kind: "model",
        source: {
          kind: "owned",
          resourceId: `sha256:${"a".repeat(64)}`,
        },
        lifecycle: { state: "active" },
        metadata: { contentType: "model/gltf-binary" },
      }),
    ).toMatchObject({ ok: true });
    const planner = vi.fn(async () => plan);
    const processor = createLocalWorkflowProcessor({
      dataDir,
      modelCards: async () => MODEL_CARDS,
      aigc: aigc(planner),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: async () => ({
          status: "accepted",
          binding,
          pollState: { taskId: "provider-task" },
        }),
      },
    });

    await processor.process({ doc, projectId: "project-1" });

    expect(planner).toHaveBeenCalledWith(
      expect.objectContaining({
        references: expect.arrayContaining([
          expect.objectContaining({
            slot: "model",
            index: 0,
            asset: expect.objectContaining({ assetId: "mesh-a" }),
          }),
        ]),
      }),
      "model",
    );
  });
});
