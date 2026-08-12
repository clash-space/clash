import test from "node:test";
import assert from "node:assert/strict";
import type {
  ProjectHostClient,
  ProjectHostRequest,
  ProjectHostResponse,
} from "@clash/shared-runtime/project-host-client";

function hostClient(
  respond: (request: ProjectHostRequest) => ProjectHostResponse,
  calls: ProjectHostRequest[],
): ProjectHostClient {
  return {
    resolveContext: async ({ projectId, cwd } = {}) => ({
      projectId: projectId ?? "project-marker",
      source: projectId ? "explicit" : "marker",
      ...(cwd ? { workspaceRoot: cwd } : {}),
    }),
    async request<T extends ProjectHostResponse>(request: ProjectHostRequest<T>) {
      calls.push(request);
      return {
        projectId: request.projectId ?? "project-marker",
        value: respond(request) as T,
      };
    },
  };
}

test("Canvas reads and mutations use typed ProjectHost commands with the host receipt", async () => {
  const { createCanvasProjectHostGateway } = await import("./canvas-gateway");
  const calls: ProjectHostRequest[] = [];
  const gateway = createCanvasProjectHostGateway(hostClient((request) => {
    if (request.command.action === "list") {
      return {
        nodes: [{ id: "note-1", type: "text", data: { label: "Beat" } }],
        versions: { "note-1": "host-receipt-note-1" },
      };
    }
    return { updated: true, nodeId: "note-1", readToken: "host-receipt-note-2" };
  }, calls));

  assert.deepEqual(await gateway.invoke("clash_canvas_list", {
    projectId: "project-1",
    canvasId: "main",
  }), [{ id: "note-1", type: "text", data: { label: "Beat" } }]);
  assert.deepEqual(await gateway.invoke("clash_canvas_update", {
    projectId: "project-1",
    canvasId: "main",
    nodeId: "note-1",
    label: "Opening beat",
  }), {
    updated: true,
    nodeId: "note-1",
    readToken: "host-receipt-note-2",
  });
  assert.deepEqual(calls.map(({ command }) => command), [
    { action: "list", canvasId: "main" },
    {
      action: "update",
      canvasId: "main",
      nodeId: "note-1",
      label: "Opening beat",
      actorClientType: "mcp",
      observedVersion: "host-receipt-note-1",
      ifMatch: "host-receipt-note-1",
    },
  ]);
});

test("Canvas mutation without a host observation fails before any request", async () => {
  const { createCanvasProjectHostGateway } = await import("./canvas-gateway");
  const calls: ProjectHostRequest[] = [];
  const gateway = createCanvasProjectHostGateway(hostClient(() => ({ moved: true }), calls));

  await assert.rejects(
    gateway.invoke("clash_canvas_move", {
      projectId: "project-1",
      nodeId: "note-1",
      x: 90,
      y: 140,
    }),
    /READ_REQUIRED.*clash_canvas_(?:get|list)/i,
  );
  assert.deepEqual(calls, []);
});

test("Canvas batch deletion consumes the exact delete-plan receipt", async () => {
  const { createCanvasProjectHostGateway } = await import("./canvas-gateway");
  const calls: ProjectHostRequest[] = [];
  const gateway = createCanvasProjectHostGateway(hostClient((request) => (
    request.command.action === "batch_delete_plan"
      ? { nodeIds: ["a", "b"], nodes: [], edges: [], readToken: "batch-receipt" }
      : { deleted: true, nodeIds: ["a", "b"] }
  ), calls));

  await gateway.invoke("clash_canvas_delete_plan", {
    projectId: "project-1",
    nodeIds: ["b", "a", "a"],
  });
  await gateway.invoke("clash_canvas_delete_batch", {
    projectId: "project-1",
    nodeIds: ["a", "b"],
  });

  assert.deepEqual(calls.map(({ command }) => command), [
    { action: "batch_delete_plan", canvasId: "main", nodeIds: ["a", "b"] },
    {
      action: "delete_batch",
      canvasId: "main",
      nodeIds: ["a", "b"],
      actorClientType: "mcp",
      observedVersion: "batch-receipt",
      ifMatch: "batch-receipt",
    },
  ]);
});

test("Canvas App snapshot composes direct host node and edge reads", async () => {
  const { createCanvasProjectHostGateway } = await import("./canvas-gateway");
  const calls: ProjectHostRequest[] = [];
  const gateway = createCanvasProjectHostGateway(hostClient((request) => (
    request.command.action === "list"
      ? { nodes: [{ id: "note-1" }], versions: { "note-1": "receipt-1" } }
      : { edges: [{ id: "edge-1", source: "note-1", target: "action-1" }], readToken: "edges-receipt" }
  ), calls));

  assert.deepEqual(await gateway.invoke("clash_canvas_open", {
    projectId: "project-1",
    canvasId: "main",
  }), {
    projectId: "project-1",
    canvasId: "main",
    nodes: [{ id: "note-1" }],
    edges: [{ id: "edge-1", source: "note-1", target: "action-1" }],
  });
  assert.deepEqual(calls.map(({ command }) => command), [
    { action: "list", canvasId: "main" },
    { action: "edges", canvasId: "main" },
  ]);
});
