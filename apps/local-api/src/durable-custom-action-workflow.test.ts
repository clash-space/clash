import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectAsset,
  listActionAssetReferences,
} from "@clash/shared-types";

import { createLocalDurableRun } from "./durable-run-coordinator.js";
import { createSqliteDurableRunJournal } from "./durable-run-journal.js";
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
  it("does not let a legacy generating run reserve the node from its current revision", async () => {
    const dataDir = await temporaryDataDir();
    const doc = customActionDoc({
      prompt: "Current prompt",
      tone: "playful",
      referenceAssetId: "asset-replacement",
    });
    const nodes = doc.getMap("nodes");
    const pending = nodes.get("action-node") as Record<string, any>;
    nodes.set("action-node", {
      ...pending,
      data: { ...pending.data, status: "generating" },
    });
    await createLocalDurableRun({
      ownerId: "local-api",
      journal: createSqliteDurableRunJournal(dataDir),
      clock: { now: () => 100 },
      command: {
        type: "create",
        actionRunId: "local-custom-action-node",
        outputSlot: "text",
        deadlineAt: 10_000,
        executor: {
          targetKind: "action",
          binding,
          actionId: "caption",
          actor: { kind: "agent", id: "agent-1" },
          kind: "text",
          projectId: "project-1",
          nodeId: "action-node",
          provider: "plugin:test.custom-action",
          modelEndpoint: "caption",
          input: {
            values: { prompt: "Legacy prompt", tone: "precise" },
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
        },
      },
    });
    const requests: Array<{ taskId: string; input: { values: unknown } }> = [];
    const invoke = vi.fn(async (request: (typeof requests)[number]) => {
      requests.push(structuredClone(request));
      const values = request.input.values as Record<string, unknown>;
      return {
        protocol: "clash.plugin.result/v1" as const,
        invocationId: `result-${String(values.tone)}`,
        status: "completed" as const,
        outputs: [
          {
            slot: "result",
            kind: "value" as const,
            value:
              values.tone === "playful" ? "Current result" : "Legacy result",
          },
        ],
      };
    });

    await createLocalWorkflowProcessor({
      dataDir,
      executablePluginAction: invoke,
      durableProviderRuns: {
        ownerId: "local-api",
        now: () => 100,
        providerPluginExecutor: async () => {
          throw new Error("Provider path must not be used for a custom Action");
        },
      },
    }).process({ doc, projectId: "project-1" });

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.taskId)).toEqual([
      "local-custom-action-node",
      expect.stringMatching(
        /^project:project-1:node:action-node:revision:[a-f0-9]{64}$/,
      ),
    ]);
    expect(nodes.get("action-node")).toMatchObject({
      data: {
        status: "completed",
        prompt: "Current prompt",
        customActionParams: { tone: "playful" },
        content: "Current result",
      },
    });
  });

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
      outputs: [{ slot: "result", kind: "value" as const, value: "Too late" }],
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

  it("recovers a stale frozen revision without projecting it and immediately submits the current revision", async () => {
    const dataDir = await temporaryDataDir();
    const originalDoc = customActionDoc({
      prompt: "Original prompt",
      tone: "precise",
      referenceAssetId: "asset-original",
    });
    let invocationDoc: LoroDoc | undefined;
    const invocations: Array<{
      taskId: string;
      input: {
        values: Record<string, unknown>;
        references: Array<Record<string, unknown>>;
      };
    }> = [];
    const invoke = vi.fn(async (request: (typeof invocations)[number]) => {
      invocations.push(structuredClone(request));
      expect(invocationDoc).toBeDefined();
      const tone = request.input.values.tone;
      return {
        protocol: "clash.plugin.result/v1" as const,
        invocationId: `custom-result-${String(tone)}`,
        status: "completed" as const,
        outputs: [
          {
            slot: "result",
            kind: "value" as const,
            value: tone === "precise" ? "Stale result" : "Replacement result",
          },
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

    expect(invoke).toHaveBeenCalledTimes(2);
    const staleInvocation = invocations.find(
      (request) => request.input.values.tone === "precise",
    );
    const currentInvocation = invocations.find(
      (request) => request.input.values.tone === "playful",
    );
    expect(staleInvocation).toMatchObject({
      taskId: expect.stringMatching(
        /^project:project-1:node:action-node:revision:[a-f0-9]{64}$/,
      ),
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
    });
    expect(currentInvocation).toMatchObject({
      taskId: expect.stringMatching(
        /^project:project-1:node:action-node:revision:[a-f0-9]{64}$/,
      ),
      input: {
        values: { prompt: "Replacement prompt", tone: "playful" },
        references: [
          expect.objectContaining({
            asset: expect.objectContaining({
              assetId: "asset-replacement",
            }),
          }),
        ],
      },
    });
    expect(currentInvocation?.taskId).not.toBe(staleInvocation?.taskId);
    expect(listActionAssetReferences(recoveredDoc, "asset-original")).toEqual([
      expect.objectContaining({
        direction: "input",
        slot: "image:0",
        projectAssetId: "asset-original",
        owner: expect.objectContaining({
          actionRunId: staleInvocation?.taskId,
        }),
      }),
    ]);
    expect(
      listActionAssetReferences(recoveredDoc, "asset-replacement"),
    ).toEqual([
      expect.objectContaining({
        direction: "input",
        slot: "image:0",
        projectAssetId: "asset-replacement",
        owner: expect.objectContaining({
          actionRunId: currentInvocation?.taskId,
        }),
      }),
    ]);
    expect(recoveredDoc.getMap("nodes").get("action-node")).toMatchObject({
      data: {
        status: "completed",
        prompt: "Replacement prompt",
        customActionParams: { tone: "playful" },
        content: "Replacement result",
      },
    });
  });
});
