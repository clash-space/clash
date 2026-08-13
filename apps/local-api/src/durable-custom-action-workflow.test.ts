import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectAsset,
  listActionAssetReferences,
} from "@clash/shared-types";

import { createLocalWorkflowProcessor } from "./local-processor.js";

const temporaryDirectories: string[] = [];

async function temporaryDataDir(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "clash-durable-custom-action-"),
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
  pluginId: "test.custom-action",
  version: "1.0.0",
  exportId: "execute",
  schemaHash: `sha256:${"a".repeat(64)}`,
} as const;

function customActionDoc(input: {
  prompt: string;
  tone: string;
  referenceAssetId: string;
}): LoroDoc {
  const doc = new LoroDoc();
  for (const assetId of ["asset-original", "asset-replacement"]) {
    expect(
      createProjectAsset(doc, {
        id: assetId,
        kind: "image",
        source: {
          kind: "owned",
          resourceId: `sha256:${
            assetId === "asset-original" ? "b".repeat(64) : "c".repeat(64)
          }`,
        },
        lifecycle: { state: "active" },
        metadata: { contentType: "image/png" },
      }),
    ).toMatchObject({ ok: true });
  }
  doc.getMap("nodes").set("action-node", {
    id: "action-node",
    type: "text",
    position: { x: 0, y: 0 },
    data: {
      status: "pending",
      actionType: "custom:caption",
      customActionId: "caption",
      customActionParams: { tone: input.tone },
      outputType: "text",
      prompt: input.prompt,
      referenceImageAssetIds: [input.referenceAssetId],
      pluginBinding: binding,
      actorType: "agent",
      actorAgentId: "agent-1",
    },
  });
  return doc;
}

describe("durable executable custom Action", () => {
  it("does not invoke after the claimed attempt budget has expired", async () => {
    const dataDir = await temporaryDataDir();
    const doc = customActionDoc({
      prompt: "Expiring prompt",
      tone: "precise",
      referenceAssetId: "asset-original",
    });
    let clockReads = 0;
    const invoke = vi.fn(async () => ({
      protocol: "clash.plugin.result/v1" as const,
      invocationId: "late-custom-result",
      status: "completed" as const,
      outputs: [
        { slot: "result", kind: "value" as const, value: "Too late" },
      ],
    }));

    await createLocalWorkflowProcessor({
      dataDir,
      executablePluginAction: invoke,
      durableProviderRuns: {
        ownerId: "host-1",
        providerPluginExecutor: async () => {
          throw new Error("Provider path must not be used for a custom Action");
        },
        // Recovery, creation, and the engine's pre-claim deadline check observe time 0.
        // The adapter then observes the absolute deadline immediately before dispatch.
        now: () => (++clockReads >= 6 ? 100 : 0),
      },
      providerGenerationDeadlineMs: 100,
    }).process({ doc, projectId: "project-1" });

    expect(invoke).not.toHaveBeenCalled();
    expect(doc.getMap("nodes").get("action-node")).toMatchObject({
      data: { status: "failed" },
    });
  });

  it("starts a new durable run when the same node becomes pending again", async () => {
    const dataDir = await temporaryDataDir();
    const doc = customActionDoc({
      prompt: "First prompt",
      tone: "precise",
      referenceAssetId: "asset-original",
    });
    const taskIds: string[] = [];
    const invoke = vi.fn(async (request: { taskId: string }) => {
      taskIds.push(request.taskId);
      return {
        protocol: "clash.plugin.result/v1" as const,
        invocationId: `custom-result-${taskIds.length}`,
        status: "completed" as const,
        outputs: [
          {
            slot: "result",
            kind: "value" as const,
            value: taskIds.length === 1 ? "First result" : "Second result",
          },
        ],
      };
    });

    await createLocalWorkflowProcessor({
      dataDir,
      executablePluginAction: invoke,
    }).process({ doc, projectId: "project-1" });

    const completed = doc.getMap("nodes").get("action-node") as Record<
      string,
      any
    >;
    doc.getMap("nodes").set("action-node", {
      ...completed,
      data: {
        ...completed.data,
        status: "pending",
        prompt: "Second prompt",
      },
    });

    await createLocalWorkflowProcessor({
      dataDir,
      executablePluginAction: invoke,
    }).process({ doc, projectId: "project-1" });

    expect(doc.getMap("nodes").get("action-node")).toMatchObject({
      data: { status: "completed", content: "Second result" },
    });
    expect(taskIds).toHaveLength(2);
    expect(taskIds[1]).not.toBe(taskIds[0]);
  });

  it("invokes from the frozen journal input after a checkpoint crash and node edits", async () => {
    const dataDir = await temporaryDataDir();
    const originalDoc = customActionDoc({
      prompt: "Original prompt",
      tone: "precise",
      referenceAssetId: "asset-original",
    });
    let invocationDoc: LoroDoc | undefined;
    const invoke = vi.fn(async () => {
      expect(invocationDoc).toBeDefined();
      expect(
        listActionAssetReferences(invocationDoc!, "asset-original"),
      ).toEqual([
        expect.objectContaining({
          direction: "input",
          slot: "image:0",
          projectAssetId: "asset-original",
        }),
      ]);
      return {
        protocol: "clash.plugin.result/v1" as const,
        invocationId: "custom-result",
        status: "completed" as const,
        outputs: [
          { slot: "result", kind: "value" as const, value: "Frozen result" },
        ],
      };
    });
    const first = createLocalWorkflowProcessor({
      dataDir,
      executablePluginAction: invoke,
    });

    await first.process({
      doc: originalDoc,
      projectId: "project-1",
      checkpoint: async () => {
        throw new Error("simulated crash before Project snapshot commit");
      },
    });

    expect(invoke).not.toHaveBeenCalled();

    // The recovered Project snapshot can contain later draft edits. They must not rewrite the
    // owner-private ActionRun that was durably frozen before the first checkpoint failed.
    const recoveredDoc = customActionDoc({
      prompt: "Replacement prompt",
      tone: "playful",
      referenceAssetId: "asset-replacement",
    });
    const recovered = createLocalWorkflowProcessor({
      dataDir,
      executablePluginAction: invoke,
    });
    invocationDoc = recoveredDoc;

    await recovered.process({
      doc: recoveredDoc,
      projectId: "project-1",
      checkpoint: async () => undefined,
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        binding,
        taskId: "local-custom-action-node",
        projectId: "project-1",
        nodeId: "action-node",
        input: {
          values: { prompt: "Original prompt", tone: "precise" },
          references: [
            {
              slot: "image",
              index: 0,
              asset: {
                assetId: "asset-original",
                uri: "clash-asset://asset-original",
                kind: "image",
              },
            },
          ],
        },
        actor: { kind: "agent", id: "agent-1" },
        timeoutMs: expect.any(Number),
      }),
    );
    expect(listActionAssetReferences(recoveredDoc, "asset-original")).toEqual([
      expect.objectContaining({
        direction: "input",
        slot: "image:0",
        projectAssetId: "asset-original",
        owner: expect.objectContaining({
          actionRunId: "local-custom-action-node",
        }),
      }),
    ]);
    expect(recoveredDoc.getMap("nodes").get("action-node")).toMatchObject({
      data: { status: "completed", content: "Frozen result" },
    });
  });
});
