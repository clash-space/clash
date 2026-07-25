import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  LoroSyncClient,
  projectDirectorStageReadToken,
  projectDirectorStageRevisionId,
  projectCanvasReadToken,
  projectTimelineReadToken,
  projectTimelineRevisionId,
} from "@clash/shared-types";
import { canvasBatchDeleteReadToken, canvasNodeReadToken } from "./canvas-update-guardrails";
import {
  buildActionsHostEnv,
  daemonSocketDir,
  getSocketPath,
  handleCommandForTest,
} from "./daemon";
import { textHash, textReadToken } from "./text-projection";

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

test("daemon socket paths cannot escape the socket directory through project ids", () => {
  const env = { CLASH_HOME: "/tmp/clash-daemon-path-test" };
  const socketDir = daemonSocketDir(env);
  const unsafeId = "project/with spaces/" + "x".repeat(240);
  const first = getSocketPath(unsafeId, env);
  const second = getSocketPath(`${unsafeId}-other`, env);

  assert.equal(dirname(first), socketDir);
  assert.match(basename(first), /^[a-f0-9]{32}\.sock$/);
  assert.notEqual(first, second);
  assert.ok(first.length < 100, `Unix socket path is too long: ${first.length}`);
});

test("daemon lifecycle automatically exposes and closes its MCP HTTP endpoint", () => {
  const source = readFileSync(new URL("./daemon.ts", import.meta.url), "utf8");

  assert.match(source, /startClashMcpHttpServer/);
  assert.match(source, /mcpHttp\.url/);
  assert.match(source, /await mcpHttp\.close\(\)/);
});

test("daemon scopes commands to the requested Canvas in one Project replica", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-multi-canvas",
    token: "test",
  });
  client.createNode("main-node", "text", { content: "Main" });
  assert.equal(client.createCanvas({ id: "shots", name: "Shots" }).ok, true);
  client.selectCanvas("shots");
  client.createNode("shots-node", "image", { assetId: "asset-1" });
  client.selectCanvas("main");

  const shots = handleCommandForTest(client, {
    action: "list",
    canvasId: "shots",
  }) as { nodes: Array<{ id: string }> };
  assert.deepEqual(shots.nodes.map((node) => node.id), ["shots-node"]);

  const main = handleCommandForTest(client, {
    action: "list",
    canvasId: "main",
  }) as { nodes: Array<{ id: string }> };
  assert.deepEqual(main.nodes.map((node) => node.id), ["main-node"]);
});

test("daemon moves a node in the requested Canvas without patching node data", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-move-node",
    token: "test",
  });
  client.createNode("note-1", "text", { label: "Opening beat", content: "Rain" });

  assert.deepEqual(handleCommandForTest(client, {
    action: "move",
    canvasId: "main",
    nodeId: "note-1",
    position: { x: 420, y: 180 },
  }), {
    moved: true,
    nodeId: "note-1",
    position: { x: 420, y: 180 },
  });
  assert.deepEqual(client.readNode("note-1")?.position, { x: 420, y: 180 });
  assert.deepEqual(client.readNode("note-1")?.data, {
    label: "Opening beat",
    content: "Rain",
  });
});

test("daemon reads derived upstream edges for graph CAS and batch-delete guardrails", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-derived-edges",
    token: "test",
  });
  client.createNode("source", "text", { content: "Source" });
  client.createNode("target", "image_gen", { prompt: "Use source" });
  client.canvas.insertEdge("source-target", "source", "target", "reference");

  const listed = handleCommandForTest(client, {
    action: "edges",
    canvasId: "main",
  }) as { edges?: Array<{ id: string; source: string; target: string; type: string }> };
  assert.deepEqual(listed.edges, [
    { id: "source-target", source: "source", target: "target", type: "reference" },
  ]);

  const plan = handleCommandForTest(client, {
    action: "batch_delete_plan",
    canvasId: "main",
    nodeIds: ["source"],
  }) as { edges?: Array<{ id: string; source: string; target: string }> };
  assert.deepEqual(plan.edges, [
    { id: "source-target", source: "source", target: "target", type: "reference" },
  ]);

  assert.match(JSON.stringify(handleCommandForTest(client, {
    action: "delete_batch",
    canvasId: "main",
    nodeIds: ["source"],
  })), /downstream/i);
  assert.ok(client.readNode("source"));
});

test("daemon executes against the selected Canvas instead of falling back to main", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-execute-scope",
    token: "test",
  });
  assert.equal(client.createCanvas({ id: "shots", name: "Shots" }).ok, true);
  client.selectCanvas("shots");
  client.createNode("shot-action", "image_gen", {
    prompt: "A product shot",
    content: "A product shot",
    modelId: "gemini-3-pro-image-preview",
  });

  const result = handleCommandForTest(client, {
    action: "execute",
    canvasId: "shots",
    nodeId: "shot-action",
  }) as { error?: string; childNodeId?: string };
  assert.equal(result.error, undefined);
  assert.ok(result.childNodeId);
  assert.ok(client.canvasFor("shots").readNode(result.childNodeId!));
  assert.equal(client.canvasFor("main").readNode(result.childNodeId!), null);
});

test("daemon rejects an unknown Canvas scope without creating it", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-unknown-canvas",
    token: "test",
  });
  client.createNode("main-node", "text", { content: "Main" });

  assert.throws(() => handleCommandForTest(client, {
    action: "list",
    canvasId: "typo",
  }), /Canvas typo not found/);
  assert.deepEqual(client.listCanvases().map((canvas) => canvas.id), ["main"]);
});

test("daemon manages the Project Canvas registry", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-canvas-registry",
    token: "test",
  });
  client.createNode("bootstrap", "text", { content: "Bootstrap" });

  const listed = handleCommandForTest(client, { action: "list_canvases" }) as {
    canvases: Array<{ id: string; name: string; position: number }>;
    versions: Record<string, string>;
  };
  assert.deepEqual(listed.canvases, [{ id: "main", name: "Main", position: 0 }]);
  assert.match(listed.versions.main, /^canvas-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
  const created = handleCommandForTest(client, {
    action: "create_canvas",
    canvasId: "shots",
    name: "Shots",
  }) as {
    canvas: { id: string; name: string; position: number };
    version: string;
    readToken: string;
  };
  assert.deepEqual(created.canvas, {
    canvas: { id: "shots", name: "Shots", position: 1 },
  }.canvas);
  assert.match(created.version, /^canvas-v1:[a-f0-9]{16}$/);
  assert.match(created.readToken, /^canvas-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
  const renamed = handleCommandForTest(client, {
    action: "rename_canvas",
    canvasId: "shots",
    name: "Selects",
  }) as { canvas: unknown; version: string; readToken: string };
  assert.deepEqual(renamed.canvas, { id: "shots", name: "Selects", position: 1 });
  assert.equal(renamed.version, projectCanvasReadToken({ id: "shots", name: "Selects", position: 1 }));
  assert.match(renamed.readToken, /^canvas-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
  assert.deepEqual(handleCommandForTest(client, {
    action: "delete_canvas",
    canvasId: "shots",
  }), {
    deleted: true,
    canvasId: "shots",
  });
});

test("daemon Canvas rename verifies the implicit host receipt", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-canvas-cas",
    token: "test",
  });
  client.createCanvas({ id: "shots", name: "Shots" });
  const observedVersion = projectCanvasReadToken({ id: "shots", name: "Shots", position: 1 });
  const listed = handleCommandForTest(client, { action: "list_canvases" }) as {
    versions: Record<string, string>;
  };
  const readReceipt = listed.versions.shots;
  assert.match(readReceipt, /^canvas-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);

  assert.match(JSON.stringify(handleCommandForTest(client, {
    action: "rename_canvas",
    canvasId: "shots",
    name: "Selects",
    actorClientType: "agent",
  })), /READ_REQUIRED/);
  assert.match(JSON.stringify(handleCommandForTest(client, {
    action: "rename_canvas",
    canvasId: "shots",
    name: "Selects",
    actorClientType: "agent",
    observedVersion: "canvas-v1:stale",
  })), /STALE_READ/);
  assert.match(JSON.stringify(handleCommandForTest(client, {
    action: "rename_canvas",
    canvasId: "shots",
    name: "Selects",
    actorClientType: "agent",
    ifMatch: observedVersion,
  })), /read receipt/);
  assert.match(JSON.stringify(handleCommandForTest(client, {
    action: "rename_canvas",
    canvasId: "shots",
    name: "Selects",
    actorClientType: "agent",
    ifMatch: `${observedVersion}:receipt:forged`,
  })), /Invalid Canvas rename read receipt/);

  const renamed = handleCommandForTest(client, {
    action: "rename_canvas",
    canvasId: "shots",
    name: "Selects",
    actorClientType: "agent",
    ifMatch: readReceipt,
  }) as { canvas: unknown; version: string; readToken: string };
  assert.deepEqual(renamed.canvas, { id: "shots", name: "Selects", position: 1 });
  assert.equal(renamed.version, projectCanvasReadToken({ id: "shots", name: "Selects", position: 1 }));
  assert.match(renamed.readToken, /^canvas-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
});

test("daemon manages standalone and Canvas-owned Timelines", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-timeline-registry",
    token: "test",
  });
  client.createCanvas({ id: "shots", name: "Shots" });

  const created = handleCommandForTest(client, {
    action: "create_timeline",
    timelineId: "timeline-1",
    name: "Episode 1",
    state: { tracks: [] },
  }) as { timeline: unknown; version: string; readToken: string };
  assert.deepEqual(created.timeline, {
    id: "timeline-1",
    name: "Episode 1",
    owner: { kind: "project" },
    revisionId: projectTimelineRevisionId("timeline-1", { tracks: [] }),
    state: { tracks: [] },
  });
  assert.equal(created.version, projectTimelineReadToken({
    id: "timeline-1",
    name: "Episode 1",
    owner: { kind: "project" },
    revisionId: projectTimelineRevisionId("timeline-1", { tracks: [] }),
    state: { tracks: [] },
  }));
  assert.match(created.readToken, /^timeline-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
  assert.equal((handleCommandForTest(client, {
    action: "attach_timeline",
    timelineId: "timeline-1",
    canvasId: "main",
    actionNodeId: "timeline-action-1",
    position: { x: 0, y: 0 },
  }) as { timeline?: { owner?: { canvasId?: string } } }).timeline?.owner?.canvasId, "main");
  assert.equal((handleCommandForTest(client, {
    action: "copy_timeline_action",
    sourceTimelineId: "timeline-1",
    targetCanvasId: "shots",
    newTimelineId: "timeline-2",
    newActionNodeId: "timeline-action-2",
    position: { x: 0, y: 0 },
  }) as { timeline?: { id?: string; owner?: { canvasId?: string } } }).timeline?.id, "timeline-2");
  assert.equal(client.listTimelines().find((timeline) => timeline.id === "timeline-2")?.owner.kind, "canvas-action");

  assert.equal((handleCommandForTest(client, {
    action: "detach_timeline",
    timelineId: "timeline-1",
  }) as { timeline?: { owner?: { kind?: string } } }).timeline?.owner?.kind, "project");
});

test("daemon manages independently revisioned Director Stages", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-director-stage-registry",
    token: "test",
  });
  const state = {
    schemaVersion: 1 as const,
    scene: {
      backgroundColor: "#171816",
      grid: { visible: true, snap: false, size: 1 },
    },
    objects: [],
    cameras: [],
    shots: [],
  };

  const created = handleCommandForTest(client, {
    action: "create_director_stage",
    stageId: "stage-1",
    name: "Courtyard blocking",
    state,
  }) as { stage?: any; version?: string; readToken?: string; error?: string };
  assert.equal(created.error, undefined);
  assert.equal(created.stage?.revisionId, projectDirectorStageRevisionId("stage-1", state));
  assert.equal(created.version, created.stage && projectDirectorStageReadToken(created.stage));
  assert.match(created.readToken ?? "", /:receipt:/);

  const attached = handleCommandForTest(client, {
    action: "attach_director_stage",
    stageId: "stage-1",
    canvasId: "main",
    actionNodeId: "director-stage-action-1",
    position: { x: 0, y: 0 },
  }) as { stage?: { owner?: { kind?: string } }; error?: string };
  assert.equal(attached.error, undefined);
  assert.equal(attached.stage?.owner?.kind, "canvas-action");

  const nextState = {
    ...state,
    scene: {
      ...state.scene,
      grid: { ...state.scene.grid, snap: true },
    },
  };
  const updated = handleCommandForTest(client, {
    action: "update_director_stage_state",
    stageId: "stage-1",
    state: nextState,
  }) as { stage?: any; error?: string };
  assert.equal(updated.error, undefined);
  assert.equal(updated.stage?.revisionId, projectDirectorStageRevisionId("stage-1", nextState));

  const listed = handleCommandForTest(client, {
    action: "list_director_stages",
  }) as { stages?: Array<{ id: string }>; versions?: Record<string, string> };
  assert.deepEqual(listed.stages?.map((stage) => stage.id), ["stage-1"]);
  assert.match(listed.versions?.["stage-1"] ?? "", /:receipt:/);

  const detached = handleCommandForTest(client, {
    action: "detach_director_stage",
    stageId: "stage-1",
  }) as { stage?: { owner?: { kind?: string } }; error?: string };
  assert.equal(detached.error, undefined);
  assert.equal(detached.stage?.owner?.kind, "project");
});

test("daemon Timeline ownership changes verify the implicit host receipt", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-timeline-cas",
    token: "test",
  });
  client.createNode("bootstrap", "text", { content: "Bootstrap" });
  const created = client.createTimeline({
    id: "timeline-1",
    name: "Episode 1",
    state: { tracks: [] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const observedVersion = projectTimelineReadToken(created.timeline);

  const listed = handleCommandForTest(client, { action: "list_timelines" }) as {
    versions?: Record<string, string>;
  };
  const readReceipt = listed.versions?.["timeline-1"] ?? "";
  assert.match(readReceipt, /^timeline-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
  assert.match(JSON.stringify(handleCommandForTest(client, {
    action: "attach_timeline",
    timelineId: "timeline-1",
    canvasId: "main",
    actionNodeId: "timeline-action-1",
    actorClientType: "agent",
  })), /READ_REQUIRED/);
  assert.match(JSON.stringify(handleCommandForTest(client, {
    action: "attach_timeline",
    timelineId: "timeline-1",
    canvasId: "main",
    actionNodeId: "timeline-action-1",
    actorClientType: "agent",
    observedVersion: "timeline-v1:stale",
  })), /STALE_READ/);
  assert.match(JSON.stringify(handleCommandForTest(client, {
    action: "attach_timeline",
    timelineId: "timeline-1",
    canvasId: "main",
    actionNodeId: "timeline-action-1",
    actorClientType: "agent",
    ifMatch: `${observedVersion}:receipt:forged`,
  })), /Invalid Timeline attach read receipt/);

  const attached = handleCommandForTest(client, {
    action: "attach_timeline",
    timelineId: "timeline-1",
    canvasId: "main",
    actionNodeId: "timeline-action-1",
    actorClientType: "agent",
    ifMatch: readReceipt,
  }) as { timeline?: { owner?: { kind?: string } }; version?: string };
  assert.equal(attached.timeline?.owner?.kind, "canvas-action");
  assert.equal(
    attached.version,
    projectTimelineReadToken(attached.timeline as Parameters<typeof projectTimelineReadToken>[0]),
  );
});

test("daemon Timeline state apply advances its revision under implicit CAS", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-timeline-state-cas",
    token: "test",
  });
  const created = client.createTimeline({
    id: "timeline-1",
    name: "Episode 1",
    state: { tracks: [] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const observedVersion = projectTimelineReadToken(created.timeline);

  assert.match(JSON.stringify(handleCommandForTest(client, {
    action: "update_timeline_state",
    timelineId: "timeline-1",
    state: { tracks: [{ id: "dialogue" }] },
    actorClientType: "agent",
  })), /READ_REQUIRED/);
  assert.match(JSON.stringify(handleCommandForTest(client, {
    action: "update_timeline_state",
    timelineId: "timeline-1",
    state: { tracks: [{ id: "dialogue" }] },
    actorClientType: "agent",
    observedVersion: "timeline-v1:stale",
  })), /STALE_READ/);

  const result = handleCommandForTest(client, {
    action: "update_timeline_state",
    timelineId: "timeline-1",
    state: { tracks: [{ id: "dialogue" }] },
    actorClientType: "agent",
    observedVersion,
  }) as { timeline?: Parameters<typeof projectTimelineReadToken>[0]; version?: string };
  assert.equal(
    result.timeline?.revisionId,
    projectTimelineRevisionId("timeline-1", { tracks: [{ id: "dialogue" }] }),
  );
  assert.equal(result.version, result.timeline && projectTimelineReadToken(result.timeline));
});

test("daemon Timeline attach does not create an unknown Canvas", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-timeline-invalid-canvas",
    token: "test",
  });
  client.createNode("bootstrap", "text", { content: "Bootstrap" });
  client.createTimeline({ id: "timeline-1", name: "Episode 1", state: { tracks: [] } });

  const result = handleCommandForTest(client, {
    action: "attach_timeline",
    timelineId: "timeline-1",
    canvasId: "missing",
    actionNodeId: "timeline-action-1",
  });

  assert.match(JSON.stringify(result), /Canvas missing not found/);
  assert.deepEqual(client.listCanvases().map((canvas) => canvas.id), ["main"]);
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

test("daemon direct update requires an observation or legacy read receipt", () => {
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

  const missing = handleCommandForTest(client, {
    action: "update",
    nodeId: "text-1",
    label: "Changed without read proof",
    actorClientType: "agent",
  });
  assert.match(JSON.stringify(missing), /READ_REQUIRED/);
  assert.deepEqual(
    (missing as { mutation?: unknown }).mutation,
    {
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "text-1" },
      accepted: false,
      error: "READ_REQUIRED: Read the target before canvas update.",
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
      accepted: false,
      error: "Stale canvas update rejected (STALE_READ). The target changed after it was read. " +
        "Run `clash canvas get --json` first, then retry the mutation.",
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
    version: (fresh as { version?: string }).version,
    readToken: updatedReadToken,
    mutation: {
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "text-1" },
      expectedReadToken: freshReadToken,
      beforeReadToken: freshBaseReadToken,
      afterReadToken: updatedReadToken,
      resultEntityId: "text-1",
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

  const read = handleCommandForTest(client, {
    action: "get",
    nodeId: "text-1",
    actorClientType: "agent",
  }) as { readToken?: string };
  assert.match(read.readToken ?? "", /^node-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/);
  const baseReadToken = canvasNodeReadToken(client.readNode("text-1")!);

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

test("daemon direct update uses the cwd observation version without a client token", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("text-observed", "text", { label: "Script", content: "before" });

  const read = handleCommandForTest(client, {
    action: "get",
    nodeId: "text-observed",
    actorClientType: "agent",
  }) as { version?: string };
  assert.equal(read.version, canvasNodeReadToken(client.readNode("text-observed")!));

  const accepted = handleCommandForTest(client, {
    action: "update",
    nodeId: "text-observed",
    label: "after read",
    actorClientType: "agent",
    observedVersion: read.version,
  }) as { updated?: boolean; mutation?: { accepted?: boolean } };
  assert.equal(accepted.updated, true);
  assert.equal(accepted.mutation?.accepted, true);

  client.updateNode("text-observed", { label: "concurrent" });
  const stale = handleCommandForTest(client, {
    action: "update",
    nodeId: "text-observed",
    label: "stale write",
    actorClientType: "agent",
    observedVersion: read.version,
  }) as { error?: string; mutation?: { accepted?: boolean } };
  assert.match(stale.error ?? "", /^STALE_READ:/);
  assert.equal(stale.mutation?.accepted, false);
  assert.equal(client.readNode("text-observed")?.data.label, "concurrent");

  const unread = handleCommandForTest(client, {
    action: "update",
    nodeId: "text-observed",
    label: "unread write",
    actorClientType: "agent",
  }) as { error?: string };
  assert.match(unread.error ?? "", /^READ_REQUIRED:/);
});

test("daemon exposes immutable nodes and provides an explicit copy-on-write operation", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("gen-immutable", "image_gen", { label: "Hero", prompt: "original" });
  client.createNode("image-output", "image", { label: "Output", assetId: "asset-1", status: "completed" });
  client.canvas.insertEdge("gen-output", "gen-immutable", "image-output");

  const read = handleCommandForTest(client, {
    action: "get",
    nodeId: "gen-immutable",
    actorClientType: "agent",
  }) as { immutable?: boolean; version?: string };
  assert.equal(read.immutable, true);
  assert.ok(read.version);

  const blocked = handleCommandForTest(client, {
    action: "update",
    nodeId: "gen-immutable",
    data: { prompt: "changed in place" },
    actorClientType: "agent",
    observedVersion: read.version,
  }) as { code?: string; error?: string };
  assert.equal(blocked.code, "IMMUTABLE_NODE");
  assert.equal(blocked.error, "IMMUTABLE_NODE");
  assert.equal(client.readNode("gen-immutable")?.data.prompt, "original");

  const copied = handleCommandForTest(client, {
    action: "copy_node",
    nodeId: "gen-immutable",
    newNodeId: "gen-copy",
    actorClientType: "agent",
    observedVersion: read.version,
  }) as {
    copied?: boolean;
    copyOnWrite?: boolean;
    node?: { id?: string; data?: Record<string, unknown> };
    immutable?: boolean;
    version?: string;
  };
  assert.equal(copied.copied, true);
  assert.equal(copied.copyOnWrite, true);
  assert.equal(copied.node?.id, "gen-copy");
  assert.equal(copied.node?.data?.prompt, "original");
  assert.equal(copied.node?.data?.copyOnWrite, true);
  assert.equal(copied.node?.data?.sourceNodeId, "gen-immutable");
  assert.equal(copied.immutable, false);
  assert.ok(copied.version);
  assert.equal(
    client.canvas.listEdges().some((edge) => edge.source === "gen-immutable" && edge.target === "image-output"),
    true,
  );
  assert.equal(
    client.canvas.listEdges().some((edge) => edge.source === "gen-immutable" && edge.target === "gen-copy"),
    true,
  );
});

test("daemon text projections use implicit observed versions", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("script", "text", { content: "before" });

  const unreadText = handleCommandForTest(client, {
    action: "text_cas_update",
    projectId: "project-1",
    nodeId: "script",
    content: "after",
    actorClientType: "agent",
  }) as { error?: string };
  assert.match(unreadText.error ?? "", /read proof/i);

  const read = handleCommandForTest(client, {
    action: "get",
    projectId: "project-1",
    nodeId: "script",
    actorClientType: "agent",
  }) as { textReadToken?: string };

  const textResult = handleCommandForTest(client, {
    action: "text_cas_update",
    projectId: "project-1",
    nodeId: "script",
    content: "after",
    actorClientType: "agent",
    observedVersion: read.textReadToken,
    ifMatch: read.textReadToken,
  }) as { updated?: boolean; version?: string };
  assert.equal(textResult.updated, true);
  assert.equal(
    textResult.version,
    textReadToken({ projectId: "project-1", nodeId: "script", content: "after" }),
  );
});

test("daemon text apply accepts the opaque receipt returned by text pull", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("script", "text", { content: "before" });

  const read = handleCommandForTest(client, {
    action: "get",
    projectId: "project-1",
    nodeId: "script",
    actorClientType: "agent",
  }) as { textReadToken?: string };
  assert.match(read.textReadToken ?? "", /^text-v1:[a-f0-9]+:receipt:/);

  const result = handleCommandForTest(client, {
    action: "text_cas_update",
    projectId: "project-1",
    nodeId: "script",
    content: "after",
    actorClientType: "agent",
    observedVersion: read.textReadToken,
    ifMatch: read.textReadToken,
  }) as { updated?: boolean; error?: string };

  assert.equal(result.error, undefined);
  assert.equal(result.updated, true);
  assert.equal(client.readNode("script")?.data.content, "after");
});

test("daemon projection apply reports immutable nodes after observation CAS", () => {
  const client = new LoroSyncClient({
    serverUrl: "http://localhost:0",
    projectId: "project-1",
    token: "test",
  });
  client.createNode("script", "text", { content: "before" });
  client.createNode("consumer", "image_gen", { prompt: "use script" });
  client.canvas.insertEdge("script-consumer", "script", "consumer");
  const read = handleCommandForTest(client, {
    action: "get",
    projectId: "project-1",
    nodeId: "script",
    actorClientType: "agent",
  }) as { textReadToken?: string };

  const result = handleCommandForTest(client, {
    action: "text_cas_update",
    projectId: "project-1",
    nodeId: "script",
    content: "after",
    actorClientType: "agent",
    observedVersion: read.textReadToken,
    ifMatch: read.textReadToken,
  }) as { code?: string; error?: string };
  assert.equal(result.code, "IMMUTABLE_NODE");
  assert.equal(result.error, "IMMUTABLE_NODE");
  assert.equal(client.readNode("script")?.data.content, "before");
});

test("daemon direct delete requires fresh agent read proof", () => {
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
      accepted: false,
      error: "Stale canvas delete rejected (STALE_READ). The target changed after it was read. " +
        "Run `clash canvas get --json` first, then retry the mutation.",
    },
  );
  assert.ok(client.readNode("text-1"));

  const fresh = handleCommandForTest(client, {
    action: "get",
    nodeId: "text-1",
    actorClientType: "agent",
  }) as { readToken: string };
  const deleted = handleCommandForTest(client, {
    action: "delete",
    nodeId: "text-1",
    actorClientType: "agent",
    ifMatch: fresh.readToken,
  });
  assert.equal((deleted as { deleted?: boolean }).deleted, true);
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
  assert.match(JSON.stringify(missing), /READ_REQUIRED/);
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
    version: (result as { version?: string }).version,
    readToken: (result as { readToken?: string }).readToken,
    mutation: {
      operation: "asset_cow_replace",
      entity: { kind: "media-node", id: "image-1" },
      expectedReadToken: readToken,
      beforeReadToken: baseReadToken,
      afterReadToken: (result as { readToken?: string }).readToken,
      resultEntityId: "image-2",
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
    observedVersion: syntheticReadToken,
    ifMatch: syntheticReadToken,
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
    observedVersion: read.textReadToken,
    ifMatch: read.textReadToken,
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
  const baseReadToken = textReadToken({
    projectId: "project-1",
    nodeId: "script",
    contentHash: expectedContentHash,
  });
  const read = handleCommandForTest(client, {
    action: "get",
    projectId: "project-1",
    nodeId: "script",
    actorClientType: "agent",
  }) as { textReadToken?: string };

  const result = handleCommandForTest(client, {
    action: "text_cow_replace",
    projectId: "project-1",
    nodeId: "script",
    content: "after",
    label: "Script v2",
    observedVersion: read.textReadToken,
    ifMatch: read.textReadToken,
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
    beforeHash: expectedContentHash,
    expectedReadToken: read.textReadToken,
    beforeReadToken: baseReadToken,
    afterHash: textHash("after"),
    afterReadToken: (result as { mutation?: { afterReadToken?: string } }).mutation?.afterReadToken,
    resultEntityId: "script-v2",
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
  const staleReadToken = textReadToken({
    projectId: "project-1",
    nodeId: "script",
    content: "before",
  });

  const result = handleCommandForTest(client, {
    action: "text_cow_replace",
    projectId: "project-1",
    nodeId: "script",
    content: "after",
    observedVersion: staleReadToken,
    ifMatch: staleReadToken,
    actorClientType: "agent",
    newNodeId: "script-v2",
  }) as { error?: string };

  assert.match(result.error ?? "", /Stale text replace rejected/);
  assert.equal((result as { mutation?: { accepted?: boolean } }).mutation?.accepted, false);
  assert.equal(client.readNode("script-v2"), null);
});
