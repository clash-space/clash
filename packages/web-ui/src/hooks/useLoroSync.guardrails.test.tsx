// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLoroSync } from "./useLoroSync";
import { agentReadToken, canvasBatchDeleteReadToken, canvasNodeReadToken, type HostMutationRecord } from "@clash/shared-types";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  binaryType = "arraybuffer";
  bufferedAmount = 0;
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor() {
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.({});
    });
  }

  send(_data: unknown): void {}

  close(code = 1000, reason = "closed"): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: true });
  }
}

describe("useLoroSync guardrails", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("does not let addNode overwrite an existing canvas node", async () => {
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-add-node",
        syncServerUrl: "ws://localhost:7777",
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.addNode("node-1", {
        type: "text",
        position: { x: 0, y: 0 },
        data: { label: "Original", content: "keep me" },
      });
    });

    let rejected: unknown;
    act(() => {
      rejected = result.current.addNode("node-1", {
        type: "video-editor",
        position: { x: 10, y: 10 },
        data: { timelineDsl: { tracks: [] } },
      });
    });

    expect(rejected).toBe(false);
    const persisted = result.current.doc?.getMap("nodes").get("node-1") as {
      type?: string;
      data?: Record<string, unknown>;
    };
    expect(persisted.type).toBe("text");
    expect(persisted.data?.content).toBe("keep me");
    expect(persisted.data?.timelineDsl).toBeUndefined();
  });

  it("emits host mutation envelopes for direct node updates", async () => {
    const mutations: HostMutationRecord[] = [];
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-node-mutation-envelope",
        syncServerUrl: "ws://localhost:7777",
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.addNode("text-1", {
        id: "text-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { label: "Script", content: "before" },
      });
    });

    const before = result.current.doc?.getMap("nodes").get("text-1") as {
      id?: string;
      type?: string;
      position?: unknown;
      data?: Record<string, unknown>;
    };
    const beforeReadToken = canvasNodeReadToken({ id: "text-1", ...before });

    act(() => {
      result.current.updateNode("text-1", {
        data: { label: "Script v2" },
      });
    });

    const after = result.current.doc?.getMap("nodes").get("text-1") as {
      id?: string;
      type?: string;
      position?: unknown;
      data?: Record<string, unknown>;
    };
    const afterReadToken = canvasNodeReadToken({ id: "text-1", ...after });

    expect(mutations).toContainEqual({
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "text-1" },
      beforeReadToken,
      afterReadToken,
      resultEntityId: "text-1",
      forced: false,
      accepted: true,
    });
  });

  it("emits mutation envelopes for node creation and duplicate creation rejection", async () => {
    const mutations: HostMutationRecord[] = [];
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-add-node-mutation-envelope",
        syncServerUrl: "ws://localhost:7777",
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    let created: unknown;
    act(() => {
      created = result.current.addNode("node-1", {
        id: "node-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { label: "Original", content: "keep me" },
      });
    });

    expect(created).toBe(true);
    const current = result.current.doc?.getMap("nodes").get("node-1") as {
      id?: string;
      type?: string;
      position?: unknown;
      data?: Record<string, unknown>;
    };
    const readToken = canvasNodeReadToken({ id: "node-1", ...current });
    expect(mutations).toContainEqual({
      operation: "canvas_add_node",
      entity: { kind: "canvas-node", id: "node-1" },
      afterReadToken: readToken,
      resultEntityId: "node-1",
      forced: false,
      accepted: true,
    });

    let duplicate: unknown;
    act(() => {
      duplicate = result.current.addNode("node-1", {
        id: "node-1",
        type: "image",
        position: { x: 10, y: 10 },
        data: { label: "Overwrite" },
      });
    });

    expect(duplicate).toBe(false);
    expect(mutations).toContainEqual({
      operation: "canvas_add_node",
      entity: { kind: "canvas-node", id: "node-1" },
      beforeReadToken: readToken,
      forced: false,
      accepted: false,
      error: "Node already exists: node-1",
    });
  });

  it("emits mutation envelopes for edge add, update, and delete", async () => {
    const mutations: HostMutationRecord[] = [];
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-edge-mutation-envelope",
        syncServerUrl: "ws://localhost:7777",
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.addNode("source-1", {
        id: "source-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { label: "Source", content: "hello" },
      });
      result.current.addNode("target-1", {
        id: "target-1",
        type: "image",
        position: { x: 200, y: 0 },
        data: { label: "Target", status: "draft" },
      });
    });
    mutations.length = 0;

    let added: unknown;
    act(() => {
      added = result.current.addEdge("edge-1", {
        id: "edge-1",
        source: "source-1",
        target: "target-1",
      });
    });
    expect(added).toBe(true);
    expect(mutations).toContainEqual({
      operation: "canvas_add_edge",
      entity: { kind: "canvas-edge", id: "edge-1" },
      resultEntityId: "edge-1",
      forced: false,
      accepted: true,
    });

    let updated: unknown;
    act(() => {
      updated = result.current.updateEdge("edge-1", {
        label: "primary",
      });
    });
    expect(updated).toBe(true);
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "canvas_update_edge",
      entity: { kind: "canvas-edge", id: "edge-1" },
      resultEntityId: "edge-1",
      forced: false,
      accepted: true,
    }));

    let removed: unknown;
    act(() => {
      removed = result.current.removeEdge("edge-1");
    });
    expect(removed).toBe(true);
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "canvas_delete_edge",
      entity: { kind: "canvas-edge", id: "edge-1" },
      resultEntityId: "edge-1",
      forced: false,
      accepted: true,
    }));
  });

  it("emits rejected mutation envelopes when direct node patches hit guardrails", async () => {
    const mutations: HostMutationRecord[] = [];
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-rejected-mutation-envelope",
        syncServerUrl: "ws://localhost:7777",
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.addNode("text-1", {
        id: "text-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { label: "Script", content: "before" },
      });
      result.current.addNode("render-1", {
        id: "render-1",
        type: "image",
        position: { x: 200, y: 0 },
        data: { label: "Rendered", assetId: "asset-1", status: "completed" },
      });
      result.current.addEdge("edge-1", {
        id: "edge-1",
        source: "text-1",
        target: "render-1",
      });
    });

    const before = result.current.doc?.getMap("nodes").get("text-1") as {
      id?: string;
      type?: string;
      position?: unknown;
      data?: Record<string, unknown>;
    };
    const beforeReadToken = canvasNodeReadToken({ id: "text-1", ...before });

    act(() => {
      result.current.updateNode("text-1", {
        data: { content: "after" },
      });
    });

    expect(result.current.doc?.getMap("nodes").get("text-1")).toMatchObject({
      data: { content: "before" },
    });
    expect(mutations).toContainEqual({
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "text-1" },
      beforeReadToken,
      forced: false,
      accepted: false,
      error:
        "Refusing to patch referenced text content through canvas update. Text node text-1 has downstream node(s): render-1. Use text projection or copy-on-write/replace workflow instead.",
    });
  });

  it("emits mutation envelopes for timeline apply and guarded deletes", async () => {
    const mutations: HostMutationRecord[] = [];
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-timeline-delete-mutation-envelope",
        syncServerUrl: "ws://localhost:7777",
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.addNode("editor-1", {
        id: "editor-1",
        type: "video-editor",
        position: { x: 0, y: 0 },
        data: { label: "Timeline", timelineDsl: { tracks: [] } },
      });
      result.current.addNode("render-1", {
        id: "render-1",
        type: "video",
        position: { x: 200, y: 0 },
        data: { label: "Render", assetId: "asset-render", status: "completed" },
      });
      result.current.addEdge("edge-render", {
        id: "edge-render",
        source: "editor-1",
        target: "render-1",
      });
    });

    const before = result.current.doc?.getMap("nodes").get("editor-1") as {
      id?: string;
      type?: string;
      position?: unknown;
      data?: Record<string, unknown>;
    };
    const beforeReadToken = canvasNodeReadToken({ id: "editor-1", ...before });

    let timelineRejected: unknown;
    act(() => {
      timelineRejected = result.current.applyTimelineDsl("editor-1", {
        tracks: [{ id: "main", items: [] }],
      });
    });

    expect(timelineRejected).toBe(false);
    expect(mutations).toContainEqual({
      operation: "timeline_apply",
      entity: { kind: "timeline", id: "editor-1" },
      beforeReadToken,
      forced: false,
      accepted: false,
      error:
        "Refusing to apply timeline for editor-1. Timeline has materialized downstream checkpoint node(s): render-1. Use copy-on-write/versioned timeline workflow or explicit force instead.",
    });

    let timelineAccepted: unknown;
    act(() => {
      timelineAccepted = result.current.applyTimelineDsl(
        "editor-1",
        { tracks: [{ id: "main", items: [] }] },
        { force: true },
      );
    });
    expect(timelineAccepted).toBe(true);
    const afterTimeline = result.current.doc?.getMap("nodes").get("editor-1") as {
      id?: string;
      type?: string;
      position?: unknown;
      data?: Record<string, unknown>;
    };
    const afterReadToken = canvasNodeReadToken({ id: "editor-1", ...afterTimeline });
    expect(mutations).toContainEqual({
      operation: "timeline_apply",
      entity: { kind: "timeline", id: "editor-1" },
      beforeReadToken,
      afterReadToken,
      resultEntityId: "editor-1",
      forced: true,
      accepted: true,
    });

    let deleteRejected: unknown;
    act(() => {
      deleteRejected = result.current.removeNode("editor-1");
    });
    expect(deleteRejected).toBe(false);
    expect(mutations).toContainEqual({
      operation: "canvas_delete",
      entity: { kind: "canvas-node", id: "editor-1" },
      beforeReadToken: afterReadToken,
      forced: false,
      accepted: false,
      error: "Refusing to delete referenced node editor-1. It has downstream node(s): render-1. Pass --force with --yes only if you intend to orphan those references.",
    });
  });

  it("requires agent runtime patches against existing nodes to carry matching read tokens", async () => {
    const mutations: HostMutationRecord[] = [];
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-agent-runtime-read-proof",
        syncServerUrl: "ws://localhost:7777",
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.addNode("editor-1", {
        id: "editor-1",
        type: "video-editor",
        position: { x: 0, y: 0 },
        data: { label: "Timeline", timelineDsl: { tracks: [] } },
      });
      result.current.addNode("scratch-1", {
        id: "scratch-1",
        type: "text",
        position: { x: 200, y: 0 },
        data: { label: "Scratch", content: "draft" },
      });
    });
    mutations.length = 0;

    const editorBefore = result.current.doc?.getMap("nodes").get("editor-1") as {
      id?: string;
      type?: string;
      position?: unknown;
      data?: Record<string, unknown>;
    };
    const editorReadToken = canvasNodeReadToken({ id: "editor-1", ...editorBefore });

    let missingTimelineProof: unknown;
    act(() => {
      missingTimelineProof = result.current.applyTimelineDsl(
        "editor-1",
        { tracks: [{ id: "main", items: [] }] },
        { actorClientType: "agent" },
      );
    });

    expect(missingTimelineProof).toBe(false);
    expect(result.current.doc?.getMap("nodes").get("editor-1")).toMatchObject({
      data: { timelineDsl: { tracks: [] } },
    });
    expect(mutations).toContainEqual({
      operation: "timeline_apply",
      entity: { kind: "timeline", id: "editor-1" },
      beforeReadToken: editorReadToken,
      forced: false,
      accepted: false,
      error:
        "Missing canvas timeline apply read proof for agent. Run `clash canvas get --json` first and pass its `readToken` with --if-match, or pass --force for an explicit overwrite.",
    });

    let acceptedTimelineProof: unknown;
    act(() => {
      acceptedTimelineProof = result.current.applyTimelineDsl(
        "editor-1",
        { tracks: [{ id: "main", items: [] }] },
        { actorClientType: "agent", ifMatch: editorReadToken },
      );
    });
    expect(acceptedTimelineProof).toBe(true);
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "timeline_apply",
      entity: { kind: "timeline", id: "editor-1" },
      expectedReadToken: editorReadToken,
      beforeReadToken: editorReadToken,
      resultEntityId: "editor-1",
      forced: false,
      accepted: true,
    }));

    const scratchBefore = result.current.doc?.getMap("nodes").get("scratch-1") as {
      id?: string;
      type?: string;
      position?: unknown;
      data?: Record<string, unknown>;
    };
    const scratchReadToken = canvasNodeReadToken({ id: "scratch-1", ...scratchBefore });

    let missingDeleteProof: unknown;
    act(() => {
      missingDeleteProof = result.current.removeNode("scratch-1", { actorClientType: "agent" });
    });

    expect(missingDeleteProof).toBe(false);
    expect(result.current.doc?.getMap("nodes").get("scratch-1")).toBeTruthy();
    expect(mutations).toContainEqual({
      operation: "canvas_delete",
      entity: { kind: "canvas-node", id: "scratch-1" },
      beforeReadToken: scratchReadToken,
      forced: false,
      accepted: false,
      error:
        "Missing canvas delete read proof for agent. Run `clash canvas get --json` first and pass its `readToken` with --if-match, or pass --force for an explicit overwrite.",
    });

    let acceptedDeleteProof: unknown;
    act(() => {
      acceptedDeleteProof = result.current.removeNode("scratch-1", {
        actorClientType: "agent",
        ifMatch: scratchReadToken,
      });
    });

    expect(acceptedDeleteProof).toBe(true);
    expect(result.current.doc?.getMap("nodes").get("scratch-1")).toBeUndefined();
    expect(mutations).toContainEqual({
      operation: "canvas_delete",
      entity: { kind: "canvas-node", id: "scratch-1" },
      expectedReadToken: scratchReadToken,
      beforeReadToken: scratchReadToken,
      resultEntityId: "scratch-1",
      forced: false,
      accepted: true,
    });
  });

  it("requires agent runtime edge mutations to carry matching read tokens", async () => {
    const edgeReadToken = (edgeId: string) => {
      const edge = result.current.doc?.getMap("edges").get(edgeId) as Record<string, unknown>;
      return agentReadToken({ namespace: "edge", subject: { id: edgeId, ...edge } });
    };
    const mutations: HostMutationRecord[] = [];
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-agent-runtime-edge-read-proof",
        syncServerUrl: "ws://localhost:7777",
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.addNode("source-1", {
        id: "source-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { label: "Source", content: "draft" },
      });
      result.current.addNode("target-1", {
        id: "target-1",
        type: "image",
        position: { x: 200, y: 0 },
        data: { label: "Target", status: "draft" },
      });
      result.current.addEdge("edge-1", {
        id: "edge-1",
        source: "source-1",
        target: "target-1",
        type: "default",
      });
    });
    mutations.length = 0;
    const beforeReadToken = edgeReadToken("edge-1");

    let missingUpdateProof: unknown;
    act(() => {
      missingUpdateProof = (result.current.updateEdge as any)("edge-1", { label: "agent edit" }, {
        actorClientType: "agent",
      });
    });
    expect(missingUpdateProof).toBe(false);
    expect(result.current.doc?.getMap("edges").get("edge-1")).not.toMatchObject({ label: "agent edit" });
    expect(mutations).toContainEqual({
      operation: "canvas_update_edge",
      entity: { kind: "canvas-edge", id: "edge-1" },
      beforeReadToken,
      forced: false,
      accepted: false,
      error:
        "Missing canvas edge update read proof for agent. Run `clash canvas edges --json` first and pass its `readToken` with --if-match, or pass --force for an explicit overwrite.",
    });

    let staleUpdateProof: unknown;
    act(() => {
      staleUpdateProof = (result.current.updateEdge as any)("edge-1", { label: "agent edit" }, {
        actorClientType: "agent",
        ifMatch: "edge-v1:stale",
      });
    });
    expect(staleUpdateProof).toBe(false);
    expect(result.current.doc?.getMap("edges").get("edge-1")).not.toMatchObject({ label: "agent edit" });
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "canvas_update_edge",
      entity: { kind: "canvas-edge", id: "edge-1" },
      expectedReadToken: "edge-v1:stale",
      beforeReadToken,
      forced: false,
      accepted: false,
    }));

    let acceptedUpdateProof: unknown;
    act(() => {
      acceptedUpdateProof = (result.current.updateEdge as any)("edge-1", { label: "agent edit" }, {
        actorClientType: "agent",
        ifMatch: beforeReadToken,
      });
    });
    expect(acceptedUpdateProof).toBe(true);
    expect(result.current.doc?.getMap("edges").get("edge-1")).toMatchObject({ label: "agent edit" });
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "canvas_update_edge",
      entity: { kind: "canvas-edge", id: "edge-1" },
      expectedReadToken: beforeReadToken,
      beforeReadToken,
      resultEntityId: "edge-1",
      forced: false,
      accepted: true,
    }));

    const afterUpdateReadToken = edgeReadToken("edge-1");
    let staleDeleteProof: unknown;
    act(() => {
      staleDeleteProof = (result.current.removeEdge as any)("edge-1", {
        actorClientType: "agent",
        ifMatch: beforeReadToken,
      });
    });
    expect(staleDeleteProof).toBe(false);
    expect(result.current.doc?.getMap("edges").get("edge-1")).toBeTruthy();

    let acceptedDeleteProof: unknown;
    act(() => {
      acceptedDeleteProof = (result.current.removeEdge as any)("edge-1", {
        actorClientType: "agent",
        ifMatch: afterUpdateReadToken,
      });
    });
    expect(acceptedDeleteProof).toBe(true);
    expect(result.current.doc?.getMap("edges").get("edge-1")).toBeUndefined();
    expect(mutations).toContainEqual({
      operation: "canvas_delete_edge",
      entity: { kind: "canvas-edge", id: "edge-1" },
      expectedReadToken: afterUpdateReadToken,
      beforeReadToken: afterUpdateReadToken,
      resultEntityId: "edge-1",
      forced: false,
      accepted: true,
    });
  });

  it("requires agent runtime edge creation between existing nodes to carry a graph read token", async () => {
    const edgesReadToken = () => {
      const edgesMap = result.current.doc?.getMap("edges");
      const edges = [...(edgesMap?.entries() ?? [])]
        .map(([edgeId, rawEdge]) => ({ id: edgeId, ...(rawEdge as Record<string, unknown>) }))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      return agentReadToken({ namespace: "edges", subject: { edges } });
    };
    const mutations: HostMutationRecord[] = [];
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-agent-runtime-add-edge-read-proof",
        syncServerUrl: "ws://localhost:7777",
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.addNode("source-1", {
        id: "source-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { label: "Source", content: "draft" },
      });
      result.current.addNode("target-1", {
        id: "target-1",
        type: "image",
        position: { x: 200, y: 0 },
        data: { label: "Target", status: "draft" },
      });
    });
    mutations.length = 0;
    const graphReadToken = edgesReadToken();

    let missingProof: unknown;
    act(() => {
      missingProof = (result.current.addEdge as any)("edge-1", {
        id: "edge-1",
        source: "source-1",
        target: "target-1",
        type: "default",
      }, {
        actorClientType: "agent",
      });
    });
    expect(missingProof).toBe(false);
    expect(result.current.doc?.getMap("edges").get("edge-1")).toBeUndefined();
    expect(mutations).toContainEqual({
      operation: "canvas_add_edge",
      entity: { kind: "canvas-edge", id: "edge-1" },
      beforeReadToken: graphReadToken,
      forced: false,
      accepted: false,
      error:
        "Missing canvas edge add read proof for agent. Run `clash canvas edges --json` first and pass its `readToken` with --if-match, or pass --force for an explicit overwrite.",
    });

    let staleProof: unknown;
    act(() => {
      staleProof = (result.current.addEdge as any)("edge-1", {
        id: "edge-1",
        source: "source-1",
        target: "target-1",
        type: "default",
      }, {
        actorClientType: "agent",
        ifMatch: "edges-v1:stale",
      });
    });
    expect(staleProof).toBe(false);
    expect(result.current.doc?.getMap("edges").get("edge-1")).toBeUndefined();
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "canvas_add_edge",
      entity: { kind: "canvas-edge", id: "edge-1" },
      expectedReadToken: "edges-v1:stale",
      beforeReadToken: graphReadToken,
      forced: false,
      accepted: false,
    }));

    let accepted: unknown;
    act(() => {
      accepted = (result.current.addEdge as any)("edge-1", {
        id: "edge-1",
        source: "source-1",
        target: "target-1",
        type: "default",
      }, {
        actorClientType: "agent",
        ifMatch: graphReadToken,
      });
    });
    expect(accepted).toBe(true);
    expect(result.current.doc?.getMap("edges").get("edge-1")).toMatchObject({
      source: "source-1",
      target: "target-1",
    });
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "canvas_add_edge",
      entity: { kind: "canvas-edge", id: "edge-1" },
      expectedReadToken: graphReadToken,
      beforeReadToken: graphReadToken,
      resultEntityId: "edge-1",
      forced: false,
      accepted: true,
    }));
  });

  it("batch deletes closed subgraphs atomically and rejects external orphaning", async () => {
    const mutations: HostMutationRecord[] = [];
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-batch-delete",
        syncServerUrl: "ws://localhost:7777",
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.addNode("source-1", {
        id: "source-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { label: "Source", content: "source" },
      });
      result.current.addNode("child-1", {
        id: "child-1",
        type: "image",
        position: { x: 200, y: 0 },
        data: { label: "Child", status: "completed" },
      });
      result.current.addNode("external-1", {
        id: "external-1",
        type: "video",
        position: { x: 400, y: 0 },
        data: { label: "External", status: "completed" },
      });
      result.current.addEdge("edge-internal", {
        id: "edge-internal",
        source: "source-1",
        target: "child-1",
      });
    });
    mutations.length = 0;

    let closedDelete: unknown;
    act(() => {
      closedDelete = result.current.removeNodes(["source-1", "child-1"]);
    });
    expect(closedDelete).toBe(true);
    expect(result.current.doc?.getMap("nodes").get("source-1")).toBeUndefined();
    expect(result.current.doc?.getMap("nodes").get("child-1")).toBeUndefined();
    expect(result.current.doc?.getMap("nodes").get("external-1")).toBeTruthy();
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "canvas_batch_delete",
      entity: { kind: "canvas-node-batch", id: "source-1,child-1" },
      resultEntityId: "source-1,child-1",
      forced: false,
      accepted: true,
    }));

    act(() => {
      result.current.addNode("source-2", {
        id: "source-2",
        type: "text",
        position: { x: 0, y: 200 },
        data: { label: "Source 2", content: "source" },
      });
      result.current.addNode("child-2", {
        id: "child-2",
        type: "image",
        position: { x: 200, y: 200 },
        data: { label: "Child 2", status: "completed" },
      });
      result.current.addEdge("edge-internal-2", {
        id: "edge-internal-2",
        source: "source-2",
        target: "child-2",
      });
      result.current.addEdge("edge-external-2", {
        id: "edge-external-2",
        source: "child-2",
        target: "external-1",
      });
    });
    mutations.length = 0;

    let rejectedDelete: unknown;
    act(() => {
      rejectedDelete = result.current.removeNodes(["source-2", "child-2"]);
    });
    expect(rejectedDelete).toBe(false);
    expect(result.current.doc?.getMap("nodes").get("source-2")).toBeTruthy();
    expect(result.current.doc?.getMap("nodes").get("child-2")).toBeTruthy();
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "canvas_batch_delete",
      entity: { kind: "canvas-node-batch", id: "source-2,child-2" },
      forced: false,
      accepted: false,
      error:
        "Refusing to delete referenced node(s). Batch would orphan downstream reference(s): child-2 -> external-1. Pass --force with --yes only if you intend to orphan those references.",
    }));
  });

  it("requires agent batch delete to carry a matching graph-aware read token", async () => {
    const mutations: HostMutationRecord[] = [];
    const { result } = renderHook(() =>
      useLoroSync({
        projectId: "guardrail-agent-batch-delete-read-proof",
        syncServerUrl: "ws://localhost:7777",
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.addNode("agent-source-1", {
        id: "agent-source-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { label: "Agent source", content: "source" },
      });
      result.current.addNode("agent-child-1", {
        id: "agent-child-1",
        type: "image",
        position: { x: 200, y: 0 },
        data: { label: "Agent child", status: "completed" },
      });
      result.current.addEdge("agent-edge-internal", {
        id: "agent-edge-internal",
        source: "agent-source-1",
        target: "agent-child-1",
      });
    });
    mutations.length = 0;

    let rejectedDelete: unknown;
    act(() => {
      rejectedDelete = result.current.removeNodes(["agent-source-1", "agent-child-1"], {
        actorClientType: "agent",
      });
    });

    expect(rejectedDelete).toBe(false);
    expect(result.current.doc?.getMap("nodes").get("agent-source-1")).toBeTruthy();
    expect(result.current.doc?.getMap("nodes").get("agent-child-1")).toBeTruthy();
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "canvas_batch_delete",
      entity: { kind: "canvas-node-batch", id: "agent-source-1,agent-child-1" },
      forced: false,
      accepted: false,
      error:
        "Missing canvas batch delete read proof for agent. Run `clash canvas delete-plan --node <id> --node <id> --json` first and pass its `readToken` with --if-match, or pass --force for an explicit destructive batch delete.",
    }));

    const readBatchNode = (id: string) => {
      const raw = result.current.doc!.getMap("nodes").get(id) as any;
      return {
        id,
        type: raw.type,
        data: raw.data,
        parentId: raw.parentId,
        position: raw.position,
      };
    };
    const readToken = canvasBatchDeleteReadToken({
      nodes: [readBatchNode("agent-source-1"), readBatchNode("agent-child-1")],
      edges: [{ id: "agent-edge-internal", source: "agent-source-1", target: "agent-child-1" }],
    });

    act(() => {
      result.current.addNode("agent-external-1", {
        id: "agent-external-1",
        type: "video",
        position: { x: 400, y: 0 },
        data: { label: "External", status: "completed" },
      });
      result.current.addEdge("agent-edge-external", {
        id: "agent-edge-external",
        source: "agent-child-1",
        target: "agent-external-1",
      });
    });
    mutations.length = 0;

    let staleDelete: unknown;
    act(() => {
      staleDelete = result.current.removeNodes(["agent-source-1", "agent-child-1"], {
        actorClientType: "agent",
        ifMatch: readToken,
      });
    });

    expect(staleDelete).toBe(false);
    expect(result.current.doc?.getMap("nodes").get("agent-source-1")).toBeTruthy();
    expect(result.current.doc?.getMap("nodes").get("agent-child-1")).toBeTruthy();
    expect(mutations.at(-1)).toEqual(expect.objectContaining({
      operation: "canvas_batch_delete",
      entity: { kind: "canvas-node-batch", id: "agent-source-1,agent-child-1" },
      expectedReadToken: readToken,
      forced: false,
      accepted: false,
    }));
    expect(mutations.at(-1)?.error).toContain("Stale canvas batch delete rejected");

    act(() => {
      result.current.removeEdge("agent-edge-external", { force: true });
    });
    const freshReadToken = canvasBatchDeleteReadToken({
      nodes: [readBatchNode("agent-source-1"), readBatchNode("agent-child-1")],
      edges: [{ id: "agent-edge-internal", source: "agent-source-1", target: "agent-child-1" }],
    });
    mutations.length = 0;

    let acceptedDelete: unknown;
    act(() => {
      acceptedDelete = result.current.removeNodes(["agent-source-1", "agent-child-1"], {
        actorClientType: "agent",
        ifMatch: freshReadToken,
      });
    });

    expect(acceptedDelete).toBe(true);
    expect(result.current.doc?.getMap("nodes").get("agent-source-1")).toBeUndefined();
    expect(result.current.doc?.getMap("nodes").get("agent-child-1")).toBeUndefined();
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: "canvas_batch_delete",
      entity: { kind: "canvas-node-batch", id: "agent-source-1,agent-child-1" },
      expectedReadToken: freshReadToken,
      beforeReadToken: freshReadToken,
      resultEntityId: "agent-source-1,agent-child-1",
      forced: false,
      accepted: true,
    }));
  });
});
