import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type {
  ProjectHostClient,
  ProjectHostRequest,
  ProjectHostResponse,
} from "@clash/shared-runtime/project-host-client";

function hostClient(
  calls: ProjectHostRequest[],
  respond: (request: ProjectHostRequest) => ProjectHostResponse,
): ProjectHostClient {
  return {
    resolveContext: async ({ projectId, cwd } = {}) => ({
      projectId: projectId ?? "project-marker",
      source: projectId ? "explicit" : "marker",
      ...(cwd ? { workspaceRoot: cwd } : {}),
    }),
    async request<T extends ProjectHostResponse>(request: ProjectHostRequest<T>) {
      calls.push(request);
      return { projectId: request.projectId ?? "project-marker", value: respond(request) as T };
    },
  };
}

const timeline = {
  id: "rough-cut",
  name: "Rough Cut",
  revisionId: "revision-1",
  owner: { kind: "project" },
  state: { tracks: [] },
};

test("Timeline list records the host receipt and save sends it as MCP CAS", async () => {
  const { createTimelineAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const adapter = createTimelineAdapter({
    client: hostClient(calls, (request) => request.command.action === "list_timelines"
      ? { timelines: [timeline], versions: { "rough-cut": "timeline-host-receipt" } }
      : { timeline: { ...timeline, revisionId: "revision-2" }, readToken: "timeline-next-receipt" }),
    writeProjection: async (path, content) => { writes.push({ path, content }); },
  });

  assert.deepEqual(await adapter.get({ cwd: "/workspace", timelineId: "rough-cut" }), timeline);
  const state = { tracks: [], fps: 30, durationInFrames: 90 };
  await adapter.save({
    cwd: "/workspace",
    timelineId: "rough-cut",
    baseRevisionId: "revision-1",
    state,
  });

  assert.equal(writes[0]?.path, join("/workspace", "timelines", "rough-cut.timeline.yaml"));
  assert.deepEqual(calls.map(({ command }) => command), [
    { action: "list_timelines" },
    {
      action: "update_timeline_state",
      timelineId: "rough-cut",
      state,
      actorClientType: "mcp",
      observedVersion: "timeline-host-receipt",
      ifMatch: "timeline-host-receipt",
    },
  ]);
});

test("Timeline mutation without a prior host read fails before writing", async () => {
  const { createTimelineAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  let writes = 0;
  const adapter = createTimelineAdapter({
    client: hostClient(calls, () => ({ timeline })),
    writeProjection: async () => { writes += 1; },
  });

  await assert.rejects(
    adapter.save({
      cwd: "/workspace",
      timelineId: "rough-cut",
      baseRevisionId: "revision-1",
      state: { tracks: [] },
    }),
    /READ_REQUIRED.*clash_timeline_get/i,
  );
  assert.equal(writes, 0);
  assert.deepEqual(calls, []);
});

test("Timeline validation uses the typed host command rather than a CLI process", async () => {
  const { createTimelineAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  const adapter = createTimelineAdapter({
    client: hostClient(calls, () => ({ ok: true, contractFingerprint: "fnv1a32:test" })),
  });

  assert.deepEqual(await adapter.validate({
    projectId: "project-1",
    state: { tracks: [] },
  }), { ok: true, contractFingerprint: "fnv1a32:test" });
  assert.deepEqual(calls.map(({ command }) => command), [
    { action: "validate_timeline", document: { tracks: [] } },
  ]);
});

test("Timeline render submits directly after an observed read", async () => {
  const { createTimelineAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  const adapter = createTimelineAdapter({
    client: hostClient(calls, (request) => request.command.action === "list_timelines"
      ? { timelines: [timeline], versions: { "rough-cut": "timeline-host-receipt" } }
      : {
          submitted: true,
          timelineId: "rough-cut",
          sourceTimelineRevisionId: "revision-1",
          renderNodeId: "render-1",
          target: { kind: "project-assets" },
        }),
  });

  await adapter.get({ projectId: "project-1", timelineId: "rough-cut" });
  assert.deepEqual(await adapter.render({
    projectId: "project-1",
    timelineId: "rough-cut",
    wait: false,
  }), {
    submitted: true,
    completed: false,
    timelineId: "rough-cut",
    sourceTimelineRevisionId: "revision-1",
    renderNodeId: "render-1",
    target: { kind: "project-assets" },
    status: "pending",
  });
  assert.deepEqual(calls.at(-1)?.command, {
    action: "request_timeline_render",
    timelineId: "rough-cut",
    actorClientType: "mcp",
    observedVersion: "timeline-host-receipt",
    ifMatch: "timeline-host-receipt",
  });
});

test("Timeline render waits for the 30-minute default budget", async (t) => {
  const { createTimelineAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  let now = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setTimeout", ((callback: () => void) => {
    now += 700_000;
    callback();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);
  const adapter = createTimelineAdapter({
    client: hostClient(calls, (request) => {
      if (request.command.action === "list_timelines") {
        return { timelines: [timeline], versions: { "rough-cut": "timeline-host-receipt" } };
      }
      if (request.command.action === "request_timeline_render") {
        return {
          submitted: true,
          timelineId: "rough-cut",
          sourceTimelineRevisionId: "revision-1",
          renderNodeId: "render-1",
          target: { kind: "project-assets" },
        };
      }
      return { node: { data: { status: "generating" } } };
    }),
  });

  await adapter.get({ projectId: "project-1", timelineId: "rough-cut" });
  const result = await adapter.render({
    projectId: "project-1",
    timelineId: "rough-cut",
    wait: true,
  });

  assert.equal(result.status, "pending");
  assert.equal(
    calls.filter(({ command }) => command.action === "get").length,
    4,
  );
});
