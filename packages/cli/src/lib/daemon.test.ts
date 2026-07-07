import test from "node:test";
import assert from "node:assert/strict";
import { LoroSyncClient } from "@clash/shared-types";
import { canvasBatchDeleteReadToken, canvasNodeReadToken } from "./canvas-update-guardrails";
import { buildActionsHostEnv, handleCommandForTest } from "./daemon";
import { textHash, textReadToken } from "./text-projection";
import { normalizeTimelineDslForYaml, timelineHash, timelineReadToken } from "./timeline-projection";

test("actions host follows the active daemon server instead of stale bridge credentials", () => {
  const env = buildActionsHostEnv("project-1", "http://127.0.0.1:49321", "local-test-key", {
    runtimeId: "runtime-1",
    apiKey: "persisted-agent-key",
    serverUrl: "http://localhost:3001",
  });

  assert.deepEqual(env, {
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "local-test-key",
    runtimeId: "runtime-1",
    projectId: "project-1",
  });
});

test("daemon ensure_edge rejects new inputs to materialized action checkpoints", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("image-1", "image", { assetId: "asset-1" });
  client.createNode("image-2", "image", { assetId: "asset-2" });
  client.createNode("action-1", "action-badge", { actionType: "image-gen" });
  client.createNode("output-1", "image", { assetId: "asset-output", status: "completed" });
  client.canvas.insertEdge("image-1-action-1", "image-1", "action-1");
  client.canvas.insertEdge("action-1-output-1", "action-1", "output-1");

  const result = handleCommandForTest(client, {
    action: "ensure_edge",
    source: "image-2",
    target: "action-1",
  });

  assert.deepEqual(client.canvas.listEdges().some((edge) => edge.source === "image-2" && edge.target === "action-1"), false);
  assert.match(JSON.stringify(result), /checkpoint input edge/);
});

test("daemon ensure_edge allows inputs while downstream output is only a draft placeholder", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("image-1", "image", { assetId: "asset-1" });
  client.createNode("image-2", "image", { assetId: "asset-2" });
  client.createNode("action-1", "action-badge", { actionType: "image-gen" });
  client.createNode("draft-1", "image", { status: "draft" });
  client.canvas.insertEdge("image-1-action-1", "image-1", "action-1");
  client.canvas.insertEdge("action-1-draft-1", "action-1", "draft-1");

  const result = handleCommandForTest(client, {
    action: "ensure_edge",
    source: "image-2",
    target: "action-1",
  });

  assert.equal((result as { existed?: boolean }).existed, false);
  assert.equal(typeof (result as { edgeId?: unknown }).edgeId, "string");
  assert.equal(client.canvas.listEdges().some((edge) => edge.source === "image-2" && edge.target === "action-1"), true);
});

test("daemon direct update requires matching agent read proof", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("text-1", "text", { label: "Script", content: "before" });
  const nodeBefore = client.readNode("text-1");
  assert.ok(nodeBefore);
  const readToken = (handleCommandForTest(client, {
    action: "get",
    nodeId: "text-1",
    actorClientType: "agent",
  }) as { readToken: string }).readToken;
  const baseReadToken = canvasNodeReadToken(nodeBefore);

  const missing = handleCommandForTest(client, {
    action: "update",
    nodeId: "text-1",
    label: "Changed without read proof",
    actorClientType: "agent",
  });
  assert.match(JSON.stringify(missing), /read proof/);
  assert.deepEqual(
    (missing as { mutation?: unknown }).mutation,
    {
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "text-1" },
      beforeReadToken: baseReadToken,
      forced: false,
      accepted: false,
      error:
        "Missing canvas update read proof for agent. Run `clash canvas get --json` first and pass its `readToken` with --if-match, or pass --force for an explicit overwrite.",
    },
  );
  assert.equal(client.readNode("text-1")?.data.label, "Script");

  client.updateNode("text-1", { label: "Concurrent change" });
  const concurrentToken = canvasNodeReadToken(client.readNode("text-1")!);
  const stale = handleCommandForTest(client, {
    action: "update",
    nodeId: "text-1",
    label: "Changed from stale read",
    actorClientType: "agent",
    ifMatch: readToken,
  });
  assert.match(JSON.stringify(stale), /Stale canvas update rejected/);
  assert.deepEqual(
    (stale as { mutation?: unknown }).mutation,
    {
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "text-1" },
      expectedReadToken: readToken,
      beforeReadToken: concurrentToken,
      forced: false,
      accepted: false,
      error:
        `Stale canvas update rejected. Current read token is ${concurrentToken}, ` +
        `but --if-match was ${baseReadToken}. ` +
        "re-read the target before writing, or pass --force for an explicit overwrite.",
    },
  );
  assert.equal(client.readNode("text-1")?.data.label, "Concurrent change");

  const freshRead = handleCommandForTest(client, {
    action: "get",
    nodeId: "text-1",
    actorClientType: "agent",
  }) as { readToken: string };
  const freshReadToken = freshRead.readToken;
  const freshBaseReadToken = canvasNodeReadToken(client.readNode("text-1")!);
  const fresh = handleCommandForTest(client, {
    action: "update",
    nodeId: "text-1",
    label: "Changed from fresh read",
    actorClientType: "agent",
    ifMatch: freshReadToken,
  });
  const updatedReadToken = (fresh as { readToken?: string }).readToken;
  assert.match(updatedReadToken ?? "", /^node-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
  assert.deepEqual(fresh, {
    updated: true,
    nodeId: "text-1",
    readToken: updatedReadToken,
    mutation: {
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "text-1" },
      expectedReadToken: freshReadToken,
      beforeReadToken: freshBaseReadToken,
      afterReadToken: updatedReadToken,
      resultEntityId: "text-1",
      forced: false,
      accepted: true,
    },
  });
  assert.equal(client.readNode("text-1")?.data.label, "Changed from fresh read");
});

test("daemon direct update requires a host-issued read receipt for agent writes", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("text-1", "text", { label: "Script", content: "before" });
  const baseReadToken = canvasNodeReadToken(client.readNode("text-1")!);

  const read = handleCommandForTest(client, {
    action: "get",
    nodeId: "text-1",
    actorClientType: "agent",
  }) as { readToken?: string };
  assert.match(read.readToken ?? "", /^node-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);

  const syntheticCasOnly = handleCommandForTest(client, {
    action: "update",
    nodeId: "text-1",
    label: "Changed from synthetic hash",
    actorClientType: "agent",
    ifMatch: baseReadToken,
  });
  assert.match(JSON.stringify(syntheticCasOnly), /read receipt/);
  assert.equal(client.readNode("text-1")?.data.label, "Script");

  const accepted = handleCommandForTest(client, {
    action: "update",
    nodeId: "text-1",
    label: "Changed from host read",
    actorClientType: "agent",
    ifMatch: read.readToken,
  }) as { updated?: boolean; mutation?: { expectedReadToken?: string; beforeReadToken?: string } };

  assert.equal(accepted.updated, true);
  assert.equal(accepted.mutation?.expectedReadToken, read.readToken);
  assert.equal(accepted.mutation?.beforeReadToken, baseReadToken);
  assert.equal(client.readNode("text-1")?.data.label, "Changed from host read");
});

test("daemon direct delete requires matching agent read proof unless forced", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("text-1", "text", { label: "Script", content: "before" });
  const read = handleCommandForTest(client, {
    action: "get",
    nodeId: "text-1",
    actorClientType: "agent",
  }) as { readToken: string };
  const readToken = read.readToken;
  const baseReadToken = canvasNodeReadToken(client.readNode("text-1")!);
  client.updateNode("text-1", { label: "Concurrent change" });

  const stale = handleCommandForTest(client, {
    action: "delete",
    nodeId: "text-1",
    actorClientType: "agent",
    ifMatch: readToken,
  });
  assert.match(JSON.stringify(stale), /Stale canvas delete rejected/);
  assert.deepEqual(
    (stale as { mutation?: unknown }).mutation,
    {
      operation: "canvas_delete",
      entity: { kind: "canvas-node", id: "text-1" },
      expectedReadToken: readToken,
      beforeReadToken: canvasNodeReadToken(client.readNode("text-1")!),
      forced: false,
      accepted: false,
      error:
        `Stale canvas delete rejected. Current read token is ${canvasNodeReadToken(client.readNode("text-1")!)}, ` +
        `but --if-match was ${baseReadToken}. ` +
        "re-read the target before writing, or pass --force for an explicit overwrite.",
    },
  );
  assert.ok(client.readNode("text-1"));

  const forcedReadToken = canvasNodeReadToken(client.readNode("text-1")!);
  const forced = handleCommandForTest(client, {
    action: "delete",
    nodeId: "text-1",
    actorClientType: "agent",
    force: true,
  });
  assert.equal((forced as { deleted?: boolean }).deleted, true);
  assert.equal((forced as { forced?: boolean }).forced, true);
  assert.deepEqual(
    (forced as { mutation?: unknown }).mutation,
    {
      operation: "canvas_delete",
      entity: { kind: "canvas-node", id: "text-1" },
      beforeReadToken: forcedReadToken,
      resultEntityId: "text-1",
      forced: true,
      accepted: true,
    },
  );
  assert.equal(client.readNode("text-1"), null);
});

test("daemon batch delete requires a host-issued graph-aware read proof", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("source-1", "text", { label: "Source", content: "source" });
  client.createNode("child-1", "image", { label: "Child", status: "completed" });
  client.canvas.insertEdge("edge-internal", "source-1", "child-1");

  const plan = handleCommandForTest(client, {
    action: "batch_delete_plan",
    nodeIds: ["source-1", "child-1"],
    actorClientType: "agent",
  }) as { nodes: any[]; edges: any[]; readToken: string };
  const baseReadToken = canvasBatchDeleteReadToken({ nodes: plan.nodes, edges: plan.edges });
  assert.match(plan.readToken, /^canvas-batch-delete-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);

  const missing = handleCommandForTest(client, {
    action: "delete_batch",
    nodeIds: ["source-1", "child-1"],
    actorClientType: "agent",
  });
  assert.match(JSON.stringify(missing), /read proof/);
  assert.ok(client.readNode("source-1"));

  const syntheticCasOnly = handleCommandForTest(client, {
    action: "delete_batch",
    nodeIds: ["source-1", "child-1"],
    actorClientType: "agent",
    ifMatch: baseReadToken,
  });
  assert.match(JSON.stringify(syntheticCasOnly), /read receipt/);
  assert.ok(client.readNode("source-1"));

  const accepted = handleCommandForTest(client, {
    action: "delete_batch",
    nodeIds: ["source-1", "child-1"],
    actorClientType: "agent",
    ifMatch: plan.readToken,
  }) as { deleted?: boolean; mutation?: { expectedReadToken?: string; beforeReadToken?: string; resultEntityId?: string } };

  assert.equal(accepted.deleted, true);
  assert.equal(accepted.mutation?.expectedReadToken, plan.readToken);
  assert.equal(accepted.mutation?.beforeReadToken, baseReadToken);
  assert.equal(accepted.mutation?.resultEntityId, "source-1,child-1");
  assert.equal(client.readNode("source-1"), null);
  assert.equal(client.readNode("child-1"), null);
  assert.deepEqual(client.canvas.listEdges(), []);
});

test("daemon asset copy-on-write replace preserves old media references", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("image-1", "image", { label: "Hero", status: "completed", assetId: "asset-old" });
  client.createNode("consumer-1", "image_gen", { prompt: "use hero" });
  client.canvas.insertEdge("image-1-consumer-1", "image-1", "consumer-1");
  const readToken = (handleCommandForTest(client, {
    action: "get",
    nodeId: "image-1",
    actorClientType: "agent",
  }) as { readToken: string }).readToken;
  const baseReadToken = canvasNodeReadToken(client.readNode("image-1")!);

  const result = handleCommandForTest(client, {
    action: "asset_cow_replace",
    nodeId: "image-1",
    assetId: "asset-new",
    newNodeId: "image-2",
    actorClientType: "agent",
    ifMatch: readToken,
  });

  assert.deepEqual(result, {
    replaced: true,
    copyOnWrite: true,
    sourceNodeId: "image-1",
    newNodeId: "image-2",
    nodeId: "image-2",
    sourceAssetId: "asset-old",
    assetId: "asset-new",
    lineageEdge: { source: "image-1", target: "image-2", type: "copy-on-write" },
    readToken: (result as { readToken?: string }).readToken,
    mutation: {
      operation: "asset_cow_replace",
      entity: { kind: "media-node", id: "image-1" },
      expectedReadToken: readToken,
      beforeReadToken: baseReadToken,
      afterReadToken: (result as { readToken?: string }).readToken,
      resultEntityId: "image-2",
      forced: false,
      accepted: true,
    },
  });
  assert.equal(client.readNode("image-1")?.data.assetId, "asset-old");
  assert.equal(client.readNode("image-2")?.type, "image");
  assert.deepEqual(client.readNode("image-2")?.data, {
    label: "Hero (copy)",
    status: "completed",
    assetId: "asset-new",
    copyOnWrite: true,
    copyOnWriteKind: "media-asset-replacement",
    sourceMediaNodeId: "image-1",
    sourceAssetId: "asset-old",
  });
  assert.equal(client.canvas.listEdges().some((edge) => edge.source === "image-1" && edge.target === "consumer-1"), true);
  assert.equal(client.canvas.listEdges().some((edge) => edge.source === "image-2" && edge.target === "consumer-1"), false);
  assert.equal(client.canvas.listEdges().some((edge) => edge.source === "image-1" && edge.target === "image-2"), true);
});

test("daemon asset copy-on-write replace enforces stale agent read proof", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("image-1", "image", { label: "Hero", status: "completed", assetId: "asset-old" });
  const readToken = (handleCommandForTest(client, {
    action: "get",
    nodeId: "image-1",
    actorClientType: "agent",
  }) as { readToken: string }).readToken;
  client.updateNode("image-1", { label: "Concurrent rename" });

  const result = handleCommandForTest(client, {
    action: "asset_cow_replace",
    nodeId: "image-1",
    assetId: "asset-new",
    newNodeId: "image-2",
    actorClientType: "agent",
    ifMatch: readToken,
  });

  assert.match(JSON.stringify(result), /Stale canvas update rejected/);
  assert.equal((result as { mutation?: { accepted?: boolean } }).mutation?.accepted, false);
  assert.equal(client.readNode("image-2"), null);
});

test("daemon text projection writes require a host-issued read receipt for agent writes", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("script", "text", { label: "Script", content: "before" });
  const expectedContentHash = textHash("before");
  const syntheticReadToken = textReadToken({
    projectId: "project-1",
    nodeId: "script",
    contentHash: expectedContentHash,
  });

  const rejected = handleCommandForTest(client, {
    action: "text_cow_replace",
    projectId: "project-1",
    nodeId: "script",
    content: "after",
    expectedContentHash,
    expectedReadToken: syntheticReadToken,
    expectedTextFilePath: "/tmp/project/projections/text/script.md",
    filePath: "/tmp/project/projections/text/script.md",
    actorClientType: "agent",
    newNodeId: "script-v2",
  }) as { error?: string; mutation?: { accepted?: boolean; expectedReadToken?: string } };

  assert.match(rejected.error ?? "", /read receipt/);
  assert.equal(rejected.mutation?.accepted, false);
  assert.equal(rejected.mutation?.expectedReadToken, syntheticReadToken);
  assert.equal(client.readNode("script-v2"), null);

  const read = handleCommandForTest(client, {
    action: "get",
    projectId: "project-1",
    nodeId: "script",
    actorClientType: "agent",
  }) as { textReadToken?: string };
  assert.match(read.textReadToken ?? "", /^text-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);

  const accepted = handleCommandForTest(client, {
    action: "text_cow_replace",
    projectId: "project-1",
    nodeId: "script",
    content: "after",
    expectedContentHash,
    expectedReadToken: read.textReadToken,
    expectedTextFilePath: "/tmp/project/projections/text/script.md",
    filePath: "/tmp/project/projections/text/script.md",
    actorClientType: "agent",
    newNodeId: "script-v2",
  }) as { copyOnWrite?: boolean; readToken?: string; mutation?: { expectedReadToken?: string; beforeReadToken?: string; afterReadToken?: string } };

  assert.equal(accepted.copyOnWrite, true);
  assert.match(accepted.readToken ?? "", /^text-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
  assert.equal(accepted.mutation?.expectedReadToken, read.textReadToken);
  assert.equal(accepted.mutation?.beforeReadToken, syntheticReadToken);
  assert.equal(accepted.mutation?.afterReadToken, accepted.readToken);
  assert.equal(client.readNode("script-v2")?.data.content, "after");
});

test("daemon timeline projection writes require a host-issued read receipt for agent writes", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  const beforeDsl = { tracks: [] };
  const afterDsl = {
    compositionWidth: 1920,
    compositionHeight: 1080,
    fps: 30,
    durationInFrames: 60,
    tracks: [{ id: "main", items: [] }],
  };
  client.createNode("editor-1", "video-editor", { label: "Main Timeline", timelineDsl: beforeDsl });
  const expectedTimelineHash = timelineHash(normalizeTimelineDslForYaml(beforeDsl));
  const syntheticReadToken = timelineReadToken({
    projectId: "project-1",
    nodeId: "editor-1",
    timelineHash: expectedTimelineHash,
  });

  const rejected = handleCommandForTest(client, {
    action: "timeline_cow_replace",
    projectId: "project-1",
    nodeId: "editor-1",
    dsl: afterDsl,
    expectedTimelineHash,
    expectedReadToken: syntheticReadToken,
    expectedTimelineFilePath: "/tmp/project/timelines/main.timeline.yaml",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    actorClientType: "agent",
    newNodeId: "editor-2",
  }) as { error?: string; mutation?: { accepted?: boolean; expectedReadToken?: string } };

  assert.match(rejected.error ?? "", /read receipt/);
  assert.equal(rejected.mutation?.accepted, false);
  assert.equal(rejected.mutation?.expectedReadToken, syntheticReadToken);
  assert.equal(client.readNode("editor-2"), null);

  const read = handleCommandForTest(client, {
    action: "get",
    projectId: "project-1",
    nodeId: "editor-1",
    actorClientType: "agent",
  }) as { timelineReadToken?: string };
  assert.match(read.timelineReadToken ?? "", /^timeline-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);

  const accepted = handleCommandForTest(client, {
    action: "timeline_cow_replace",
    projectId: "project-1",
    nodeId: "editor-1",
    dsl: afterDsl,
    expectedTimelineHash,
    expectedReadToken: read.timelineReadToken,
    expectedTimelineFilePath: "/tmp/project/timelines/main.timeline.yaml",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    actorClientType: "agent",
    newNodeId: "editor-2",
  }) as { copyOnWrite?: boolean; readToken?: string; mutation?: { expectedReadToken?: string; beforeReadToken?: string; afterReadToken?: string } };

  assert.equal(accepted.copyOnWrite, true);
  assert.match(accepted.readToken ?? "", /^timeline-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
  assert.equal(accepted.mutation?.expectedReadToken, read.timelineReadToken);
  assert.equal(accepted.mutation?.beforeReadToken, syntheticReadToken);
  assert.equal(accepted.mutation?.afterReadToken, accepted.readToken);
  assert.deepEqual(client.readNode("editor-2")?.data.timelineDsl, afterDsl);
});

test("daemon timeline force response is explicit", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("editor-1", "video-editor", { timelineDsl: { tracks: [] } });

  const result = handleCommandForTest(client, {
    action: "timeline_cas_update",
    projectId: "project-1",
    nodeId: "editor-1",
    dsl: { tracks: [], compositionWidth: 1920, compositionHeight: 1080, fps: 30, durationInFrames: 30 },
    force: true,
  });

  assert.equal((result as { updated?: boolean }).updated, true);
  assert.equal((result as { forced?: boolean }).forced, true);
  const mutation = (result as { mutation?: { beforeReadToken?: string; afterReadToken?: string } }).mutation;
  assert.match(mutation?.beforeReadToken ?? "", /^timeline-v1:[a-f0-9]{16}$/);
  assert.match(mutation?.afterReadToken ?? "", /^timeline-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
});

test("daemon timeline revision records command actor attribution", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("editor-1", "video-editor", { timelineDsl: { tracks: [] } });

  const result = handleCommandForTest(client, {
    action: "timeline_cas_update",
    projectId: "project-1",
    nodeId: "editor-1",
    dsl: {
      tracks: [],
      compositionWidth: 1920,
      compositionHeight: 1080,
      fps: 30,
      durationInFrames: 30,
    },
    cwd: "/tmp/project",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    force: true,
    actor: {
      actorType: "agent",
      actorUserId: "user-1",
      actorAgentId: "agent-1",
    },
  });

  assert.deepEqual(
    (result as { timelineRevision?: { actor?: unknown } }).timelineRevision?.actor,
    {
      actorType: "agent",
      actorUserId: "user-1",
      actorAgentId: "agent-1",
    },
  );
  assert.deepEqual(
    (result as { mutation?: unknown }).mutation,
    {
      operation: "timeline_cas_update",
      entity: { kind: "timeline", id: "editor-1" },
      actor: {
        actorType: "agent",
        actorUserId: "user-1",
        actorAgentId: "agent-1",
      },
      beforeHash: timelineHash(normalizeTimelineDslForYaml({ tracks: [] })),
      beforeReadToken: (result as { mutation?: { beforeReadToken?: string } }).mutation?.beforeReadToken,
      afterHash: timelineHash({
        tracks: [],
        compositionWidth: 1920,
        compositionHeight: 1080,
        fps: 30,
        durationInFrames: 30,
      }),
      afterReadToken: (result as { mutation?: { afterReadToken?: string } }).mutation?.afterReadToken,
      resultEntityId: "editor-1",
      forced: true,
      accepted: true,
    },
  );
});

test("daemon timeline copy-on-write replace preserves materialized render references", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  const beforeDsl = { tracks: [] };
  const afterDsl = {
    compositionWidth: 1920,
    compositionHeight: 1080,
    fps: 30,
    durationInFrames: 60,
    tracks: [{ id: "main", items: [] }],
  };
  client.createNode("editor-1", "video-editor", { label: "Main Timeline", timelineDsl: beforeDsl });
  client.createNode("render-1", "video", { assetId: "render-asset", status: "completed" });
  client.canvas.insertEdge("editor-1-render-1", "editor-1", "render-1");
  const expectedTimelineHash = timelineHash(normalizeTimelineDslForYaml(beforeDsl));
  const expectedReadToken = timelineReadToken({
    projectId: "project-1",
    nodeId: "editor-1",
    timelineHash: expectedTimelineHash,
  });

  const result = handleCommandForTest(client, {
    action: "timeline_cow_replace",
    projectId: "project-1",
    nodeId: "editor-1",
    dsl: afterDsl,
    label: "Main Timeline v2",
    expectedTimelineHash,
    expectedReadToken,
    expectedTimelineFilePath: "/tmp/project/timelines/main.timeline.yaml",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    cwd: "/tmp/project",
    newNodeId: "editor-2",
    actor: {
      actorType: "agent",
      actorUserId: "user-1",
      actorAgentId: "agent-1",
    },
  }) as {
    copyOnWrite?: boolean;
    sourceNodeId?: string;
    newNodeId?: string;
    sourceTimelineHash?: string;
    timelineHash?: string;
    timelineRevision?: { nodeId?: string; parentRevisionId?: string; actor?: unknown };
  };

  assert.equal(result.copyOnWrite, true);
  assert.equal(result.sourceNodeId, "editor-1");
  assert.equal(result.newNodeId, "editor-2");
  assert.equal(result.sourceTimelineHash, expectedTimelineHash);
  assert.equal(result.timelineHash, timelineHash(afterDsl));
  assert.deepEqual(client.readNode("editor-1")?.data.timelineDsl, beforeDsl);
  const replacement = client.readNode("editor-2");
  assert.equal(replacement?.type, "video-editor");
  assert.equal(replacement?.data.label, "Main Timeline v2");
  assert.deepEqual(replacement?.data.timelineDsl, afterDsl);
  assert.equal(replacement?.data.copyOnWrite, true);
  assert.equal(replacement?.data.sourceTimelineNodeId, "editor-1");
  assert.equal(replacement?.data.sourceTimelineHash, timelineHash(normalizeTimelineDslForYaml(beforeDsl)));
  assert.equal(replacement?.data.timelineHash, timelineHash(afterDsl));
  assert.equal(result.timelineRevision?.nodeId, "editor-2");
  assert.deepEqual(result.timelineRevision?.actor, {
    actorType: "agent",
    actorUserId: "user-1",
    actorAgentId: "agent-1",
  });
  assert.deepEqual((result as { mutation?: unknown }).mutation, {
    operation: "timeline_cow_replace",
    entity: { kind: "timeline", id: "editor-1" },
    actor: {
      actorType: "agent",
      actorUserId: "user-1",
      actorAgentId: "agent-1",
    },
    expectedHash: expectedTimelineHash,
    beforeHash: expectedTimelineHash,
    expectedReadToken,
    beforeReadToken: expectedReadToken,
    afterHash: timelineHash(afterDsl),
    afterReadToken: (result as { mutation?: { afterReadToken?: string } }).mutation?.afterReadToken,
    resultEntityId: "editor-2",
    forced: false,
    accepted: true,
  });
  assert.equal(
    client.canvas.listEdges().some((edge) => edge.source === "editor-1" && edge.target === "render-1"),
    true,
  );
  assert.equal(
    client.canvas.listEdges().some((edge) => edge.source === "editor-2" && edge.target === "render-1"),
    false,
  );
  assert.equal(
    client.canvas.listEdges().some((edge) => edge.source === "editor-1" && edge.target === "editor-2"),
    true,
  );
});

test("daemon timeline copy-on-write replace still enforces stale CAS", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  const beforeDsl = { tracks: [] };
  const changedDsl = { tracks: [{ id: "main", items: [] }] };
  client.createNode("editor-1", "video-editor", { label: "Main Timeline", timelineDsl: changedDsl });

  const result = handleCommandForTest(client, {
    action: "timeline_cow_replace",
    projectId: "project-1",
    nodeId: "editor-1",
    dsl: beforeDsl,
    expectedTimelineHash: timelineHash(normalizeTimelineDslForYaml(beforeDsl)),
    newNodeId: "editor-2",
  }) as { error?: string };

  assert.match(result.error ?? "", /stale timeline/i);
  assert.equal((result as { mutation?: { accepted?: boolean } }).mutation?.accepted, false);
  assert.equal(client.readNode("editor-2"), null);
});

test("daemon text force response is explicit", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("text-1", "text", { content: "before" });

  const result = handleCommandForTest(client, {
    action: "text_cas_update",
    projectId: "project-1",
    nodeId: "text-1",
    content: "after",
    cwd: "/tmp/project",
    filePath: "/tmp/project/projections/text/text-1.md",
    parentRevisionId: "txrev-parent",
    actor: { actorType: "agent", actorUserId: "user-1", actorAgentId: "agent-1" },
    force: true,
  }) as {
    updated?: boolean;
    forced?: boolean;
    textRevision?: {
      kind?: string;
      nodeId?: string;
      parentRevisionId?: string;
      contentHash?: string;
      sourceFilePath?: string;
      actor?: unknown;
    };
    mutation?: { beforeReadToken?: string; afterReadToken?: string };
  };

  assert.equal(result.updated, true);
  assert.equal(result.forced, true);
  assert.equal(result.textRevision?.kind, "clash.text.revision");
  assert.equal(result.textRevision?.nodeId, "text-1");
  assert.equal(result.textRevision?.parentRevisionId, "txrev-parent");
  assert.equal(result.textRevision?.contentHash, textHash("after"));
  assert.equal(result.textRevision?.sourceFilePath, "projections/text/text-1.md");
  assert.deepEqual(result.textRevision?.actor, { actorType: "agent", actorUserId: "user-1", actorAgentId: "agent-1" });
  const mutation = result.mutation;
  assert.match(mutation?.beforeReadToken ?? "", /^text-v1:[a-f0-9]{16}$/);
  assert.match(mutation?.afterReadToken ?? "", /^text-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
  assert.deepEqual(
    (result as { mutation?: unknown }).mutation,
    {
      operation: "text_cas_update",
      entity: { kind: "text", id: "text-1" },
      beforeHash: textHash("before"),
      beforeReadToken: mutation?.beforeReadToken,
      afterHash: textHash("after"),
      afterReadToken: mutation?.afterReadToken,
      resultEntityId: "text-1",
      forced: true,
      accepted: true,
    },
  );
});

test("daemon text copy-on-write replace preserves materialized references", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("script", "text", { label: "Script", content: "before" });
  client.createNode("action-1", "action-badge", { actionType: "image-gen" });
  client.createNode("output-1", "image", { assetId: "asset-output", status: "completed" });
  client.canvas.insertEdge("script-action-1", "script", "action-1");
  client.canvas.insertEdge("action-1-output-1", "action-1", "output-1");
  const expectedContentHash = textHash("before");
  const expectedReadToken = textReadToken({
    projectId: "project-1",
    nodeId: "script",
    contentHash: expectedContentHash,
  });

  const result = handleCommandForTest(client, {
    action: "text_cow_replace",
    projectId: "project-1",
    nodeId: "script",
    content: "after",
    label: "Script v2",
    expectedContentHash,
    expectedReadToken,
    expectedTextFilePath: "/tmp/project/projections/text/script.md",
    cwd: "/tmp/project",
    filePath: "/tmp/project/projections/text/script.md",
    parentRevisionId: "txrev-parent",
    actor: { actorType: "agent", actorUserId: "user-1", actorAgentId: "agent-1" },
    newNodeId: "script-v2",
  }) as {
    copyOnWrite?: boolean;
    sourceNodeId?: string;
    newNodeId?: string;
    sourceContentHash?: string;
    contentHash?: string;
    textRevision?: {
      kind?: string;
      nodeId?: string;
      parentRevisionId?: string;
      contentHash?: string;
      sourceFilePath?: string;
      actor?: unknown;
    };
  };

  assert.equal(result.copyOnWrite, true);
  assert.equal(result.sourceNodeId, "script");
  assert.equal(result.newNodeId, "script-v2");
  assert.equal(result.sourceContentHash, expectedContentHash);
  assert.equal(result.contentHash, textHash("after"));
  assert.equal(result.textRevision?.kind, "clash.text.revision");
  assert.equal(result.textRevision?.nodeId, "script-v2");
  assert.equal(result.textRevision?.parentRevisionId, "txrev-parent");
  assert.equal(result.textRevision?.contentHash, textHash("after"));
  assert.equal(result.textRevision?.sourceFilePath, "projections/text/script.md");
  assert.deepEqual(result.textRevision?.actor, { actorType: "agent", actorUserId: "user-1", actorAgentId: "agent-1" });
  assert.deepEqual((result as { mutation?: unknown }).mutation, {
    operation: "text_cow_replace",
    entity: { kind: "text", id: "script" },
    expectedHash: expectedContentHash,
    beforeHash: expectedContentHash,
    expectedReadToken,
    beforeReadToken: expectedReadToken,
    afterHash: textHash("after"),
    afterReadToken: (result as { mutation?: { afterReadToken?: string } }).mutation?.afterReadToken,
    resultEntityId: "script-v2",
    forced: false,
    accepted: true,
  });
  assert.equal(client.readNode("script")?.data.content, "before");
  const replacement = client.readNode("script-v2");
  assert.equal(replacement?.type, "text");
  assert.equal(replacement?.data.label, "Script v2");
  assert.equal(replacement?.data.content, "after");
  assert.equal(replacement?.data.copyOnWrite, true);
  assert.equal(replacement?.data.sourceTextNodeId, "script");
  assert.equal(replacement?.data.sourceContentHash, textHash("before"));
  assert.equal(replacement?.data.contentHash, textHash("after"));
  assert.deepEqual(replacement?.data.textRevision, result.textRevision);
  assert.equal(
    client.canvas.listEdges().some((edge) => edge.source === "script" && edge.target === "action-1"),
    true,
  );
  assert.equal(
    client.canvas.listEdges().some((edge) => edge.source === "script-v2" && edge.target === "action-1"),
    false,
  );
  assert.equal(
    client.canvas.listEdges().some((edge) => edge.source === "script" && edge.target === "script-v2"),
    true,
  );
});

test("daemon text copy-on-write replace still enforces stale CAS", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("script", "text", { label: "Script", content: "changed" });

  const result = handleCommandForTest(client, {
    action: "text_cow_replace",
    projectId: "project-1",
    nodeId: "script",
    content: "after",
    expectedContentHash: textHash("before"),
    newNodeId: "script-v2",
  }) as { error?: string };

  assert.match(result.error ?? "", /Stale text apply rejected/);
  assert.equal((result as { mutation?: { accepted?: boolean } }).mutation?.accepted, false);
  assert.equal(client.readNode("script-v2"), null);
});
