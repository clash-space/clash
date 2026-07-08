import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { timelineDslHash, timelineDslToYaml } from "@clash/shared-types";
import {
  assertTimelineCas,
  assertTimelineNotMaterializedReferenced,
  createTimelineAppliedRevision,
  createTimelineLock,
  createTimelineSourceProvenance,
  fetchTimelineRevisionHistory,
  parseTimelineFileForApply,
  parseTimelineLock,
  registerTimelineRevisionIndex,
  resolveTimelineFilePath,
  resolveTimelineLockPath,
  timelineHash,
  timelineCommand,
  timelineYamlFromNode,
} from "./timeline";

test("registers a top-level timeline command for agent-editable timeline files", () => {
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  assert.match(indexSource, /import \{ timelineCommand \} from "\.\/commands\/timeline"/);
  assert.match(indexSource, /program\.addCommand\(timelineCommand\)/);
  assert.equal(timelineCommand.name(), "timeline");
  assert.deepEqual(timelineCommand.commands.map((command) => command.name()), ["pull", "apply", "replace", "history", "content"]);
  const timelineSource = readFileSync(new URL("./timeline.ts", import.meta.url), "utf8");
  const daemonSource = readFileSync(new URL("../lib/daemon.ts", import.meta.url), "utf8");
  assert.match(timelineSource, /\.command\("replace"\)/);
  assert.match(timelineSource, /action: "timeline_cow_replace"/);
  assert.match(timelineSource, /actorClientType: resolveCanvasPresenceOptions\(\)\.clientType/);
  assert.match(timelineSource, /readToken: node\.readToken/);
  assert.match(timelineSource, /readToken: result\.readToken/);
  assert.match(timelineSource, /assertAgentHostWritePath/);
  assert.match(daemonSource, /case "timeline_cow_replace"/);
  assert.match(daemonSource, /timeline_cow_replace requires timeline dsl/);
});

test("timeline fallback sync preserves spawned-agent presence", () => {
  const source = readFileSync(new URL("./timeline.ts", import.meta.url), "utf8");

  assert.match(source, /import \{[^}]*resolveCanvasPresenceOptions[^}]*\} from "\.\/canvas"/s);
  assert.match(source, /\.\.\.resolveCanvasPresenceOptions\(\)/);
});

test("keeps legacy canvas timeline push behind the same CAS guard", () => {
  const canvasSource = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(canvasSource, /\.command\("push"\)/);
  assert.match(canvasSource, /\.option\("--force"/);
  assert.match(canvasSource, /resolveTimelineLockPath/);
  assert.match(canvasSource, /assertTimelineCas/);
  assert.match(canvasSource, /createTimelineAppliedRevision/);
  assert.match(canvasSource, /writeFileSync\(lockPath, JSON\.stringify\(refreshedLock/);
});

test("timeline apply refreshes the lock sidecar with an applied revision milestone", () => {
  const source = readFileSync(new URL("./timeline.ts", import.meta.url), "utf8");

  assert.match(source, /createTimelineAppliedRevision/);
  assert.match(source, /appliedRevision: timelineRevision/);
  assert.match(source, /writeFileSync\(lockPath, JSON\.stringify\(refreshedLock/);
});

test("timeline apply resolves actor attribution for revision milestones", () => {
  const source = readFileSync(new URL("./timeline.ts", import.meta.url), "utf8");

  assert.match(source, /import \{[^}]*resolveCanvasActor[^}]*\} from "\.\/canvas"/s);
  assert.match(source, /const actor = await resolveCanvasActor\(\);/);
  assert.match(source, /actor,/);
});

test("resolves the default agent-editable timeline YAML path under the cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-timeline-path-"));

  assert.equal(resolveTimelineFilePath({ cwd }), join(cwd, "timelines", "main.timeline.yaml"));
  assert.equal(resolveTimelineLockPath({ cwd }), join(cwd, "timelines", "main.timeline.lock.json"));
  assert.equal(
    resolveTimelineFilePath({ cwd, timeline: "episode 01 / hook" }),
    join(cwd, "timelines", "episode-01-hook.timeline.yaml"),
  );
  assert.equal(
    resolveTimelineLockPath({ cwd, timeline: "episode 01 / hook" }),
    join(cwd, "timelines", "episode-01-hook.timeline.lock.json"),
  );
  assert.equal(resolveTimelineFilePath({ cwd, file: "cuts/main.yaml" }), join(cwd, "cuts", "main.yaml"));
  assert.equal(resolveTimelineLockPath({ cwd, file: "cuts/main.yaml" }), join(cwd, "cuts", "main.lock.json"));
  assert.throws(
    () => resolveTimelineFilePath({ cwd: "/tmp/project", file: "../outside.timeline.yaml" }),
    /Projection file path must stay inside the current project cwd/,
  );
  assert.throws(
    () => resolveTimelineFilePath({ cwd: "/tmp/project", file: "/tmp/other-project/main.timeline.yaml" }),
    /Projection file path must stay inside the current project cwd/,
  );
});

test("rejects symlinked timeline lock sidecars that resolve outside cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-timeline-lock-"));
  const cwd = join(root, "project");
  const outside = join(root, "outside");
  const timelinesDir = join(cwd, "timelines");
  mkdirSync(timelinesDir, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "main.timeline.lock.json"), "{}\n", "utf8");
  symlinkSync(join(outside, "main.timeline.lock.json"), join(timelinesDir, "main.timeline.lock.json"));

  assert.throws(
    () => resolveTimelineLockPath({ cwd }),
    /Projection lock sidecar path must not traverse a symlink outside the current project cwd/,
  );
});

test("serializes a video-editor node timelineDsl as YAML without legacy timing keys", () => {
  const yaml = timelineYamlFromNode({
    type: "video-editor",
    data: {
      timelineDsl: {
        compositionWidth: 1080,
        compositionHeight: 1920,
        fps: 30,
        durationInFrames: 90,
        tracks: [
          {
            id: "main",
            name: "Main",
            items: [
              {
                id: "scene-001-video",
                type: "video",
                start: 10,
                end: 70,
                trackId: "legacy-track",
                sourceNodeId: "scene-001",
              },
            ],
          },
        ],
      },
    },
  });

  assert.match(yaml, /compositionWidth: 1080/);
  assert.match(yaml, /id: scene-001-video/);
  assert.match(yaml, /from: 10/);
  assert.match(yaml, /durationInFrames: 60/);
  assert.doesNotMatch(yaml, /start:/);
  assert.doesNotMatch(yaml, /end:/);
  assert.doesNotMatch(yaml, /trackId:/);
});

test("serializes fallback timeline item ids deterministically for stable CAS locks", () => {
  const node = {
    type: "video-editor",
    data: {
      timelineDsl: {
        tracks: [
          {
            id: "main",
            items: [
              {
                type: "video",
                from: 0,
                durationInFrames: 30,
                sourceNodeId: "scene-001",
              },
            ],
          },
        ],
      },
    },
  };

  const firstYaml = timelineYamlFromNode(node);
  const secondYaml = timelineYamlFromNode(node);

  assert.equal(firstYaml, secondYaml);
  assert.match(firstYaml, /id: item-main-0/);
});

test("preserves semantic track roles and composition specs in timeline YAML projections", () => {
  const yaml = timelineYamlFromNode({
    type: "video-editor",
    data: {
      timelineDsl: {
        compositionWidth: 1080,
        compositionHeight: 1920,
        fps: 30,
        durationInFrames: 120,
        tracks: [
          {
            id: "overlays",
            name: "MG Overlays",
            role: "overlay",
            items: [
              {
                id: "overlay-lower-third",
                type: "composition",
                from: 30,
                durationInFrames: 90,
                compositionKind: "motion-graphics",
                runtime: "html",
                compositionId: "lower-third",
                sourcePath: "projections/mg/lower-third/index.html",
                renderedAssetPath: "assets/overlays/lower-third.webm",
                spec: {
                  id: "lower-third",
                  width: 1080,
                  height: 1920,
                  fps: 30,
                  durationInFrames: 90,
                  layers: [],
                },
              },
            ],
          },
          {
            id: "subtitles",
            name: "Subtitles",
            role: "subtitle",
            items: [
              {
                id: "caption-main",
                type: "caption",
                from: 0,
                durationInFrames: 60,
                cues: [{ id: "cue-1", startFrame: 0, durationInFrames: 60, text: "大家好" }],
              },
            ],
          },
        ],
      },
    },
  });

  assert.match(yaml, /role: overlay/);
  assert.match(yaml, /role: subtitle/);
  assert.match(yaml, /type: composition/);
  assert.match(yaml, /compositionKind: motion-graphics/);
  assert.match(yaml, /sourcePath: projections\/mg\/lower-third\/index\.html/);
  assert.match(yaml, /spec:/);
  assert.match(yaml, /type: caption/);
  assert.match(yaml, /text: 大家好/);
});

test("parses an edited timeline YAML into the resolved timelineDsl applied to canvas", () => {
  const result = parseTimelineFileForApply(`
compositionWidth: 1080
compositionHeight: 1920
fps: 30
durationInFrames: 90
tracks:
  - id: main
    name: Main
    items:
      - id: scene-001-video
        type: video
        from: start
        durationInFrames: 30
        sourceNodeId: scene-001
      - id: scene-002-video
        type: video
        from: prev
        durationInFrames: 60
        sourceNodeId: scene-002
`);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.dsl.tracks[0].items.map((item) => item.from), [0, 30]);
  assert.deepEqual(result.sources, ["scene-001", "scene-002"]);
});

test("creates a CAS lock for the pulled timeline file", async () => {
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: main
    items:
      - id: scene-001-video
        type: video
        from: start
        durationInFrames: 30
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const lock = await createTimelineLock({
    projectId: "project-1",
    nodeId: "editor-1",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    dsl: parsed.dsl,
    pulledAt: "2026-07-05T00:00:00.000Z",
  });

  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.kind, "clash.timeline.lock");
  assert.equal(lock.projectionKind, "timeline");
  assert.deepEqual(lock.entity, { kind: "video-editor-node", id: "editor-1" });
  assert.equal(lock.projectId, "project-1");
  assert.equal(lock.nodeId, "editor-1");
  assert.equal(lock.filePath, "/tmp/project/timelines/main.timeline.yaml");
  assert.equal(lock.contentHash, lock.timelineHash);
  assert.match(lock.timelineHash, /^[a-f0-9]{16}$/);
  assert.match(lock.readToken ?? "", /^timeline-v1:[a-f0-9]{16}$/);
});

test("timeline CAS lock preserves a host-issued read receipt when pull came through the daemon", () => {
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: main
    items: []
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const readToken = "timeline-v1:1234567890abcdef:receipt:host-issued";
  const lock = createTimelineLock({
    projectId: "project-1",
    nodeId: "editor-1",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    dsl: parsed.dsl,
    readToken,
    pulledAt: "2026-07-05T00:00:00.000Z",
  });

  assert.equal(lock.readToken, readToken);
  assert.deepEqual(parseTimelineLock(JSON.stringify(lock)), lock);
});

test("parses legacy timeline CAS locks into the generic projection envelope", () => {
  const legacyLock = {
    schemaVersion: 1,
    kind: "clash.timeline.lock",
    projectId: "project-1",
    nodeId: "editor-1",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    timelineHash: "1234567890abcdef",
    hashAlgorithm: "sha256-64",
    pulledAt: "2026-07-05T00:00:00.000Z",
  };

  assert.deepEqual(parseTimelineLock(JSON.stringify(legacyLock)), {
    ...legacyLock,
    projectionKind: "timeline",
    entity: { kind: "video-editor-node", id: "editor-1" },
    contentHash: "1234567890abcdef",
  });
});

test("rejects timeline CAS locks with mismatched generic entity identity", () => {
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: main
    items: []
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const lock = createTimelineLock({
    projectId: "project-1",
    nodeId: "editor-1",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    dsl: parsed.dsl,
    pulledAt: "2026-07-05T00:00:00.000Z",
  });

  assert.throws(
    () => parseTimelineLock(JSON.stringify({
      ...lock,
      entity: { kind: "video-editor-node", id: "editor-2" },
    })),
    /Invalid projection lock file/,
  );
});

test("rejects timeline apply when the projection file does not match the lock", () => {
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: main
    items:
      - id: scene-001-video
        type: video
        from: start
        durationInFrames: 30
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const lock = createTimelineLock({
    projectId: "project-1",
    nodeId: "editor-1",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    dsl: parsed.dsl,
    pulledAt: "2026-07-05T00:00:00.000Z",
  });

  const result = assertTimelineCas({
    projectId: "project-1",
    nodeId: "editor-1",
    lock,
    currentDsl: parsed.dsl,
    filePath: "/tmp/project/timelines/other.timeline.yaml",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Projection file path does not match timeline CAS lock/);
});

test("records applied timeline revisions as lock-sidecar milestones backed by Loro frontiers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-timeline-revision-"));
  const filePath = join(cwd, "timelines", "main.timeline.yaml");
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: main
    items:
      - id: scene-001-video
        type: video
        from: start
        durationInFrames: 30
        sourceNodeId: scene-001
      - id: title-card
        type: composition
        from: prev
        durationInFrames: 30
        runtime: html
        compositionKind: motion-graphics
        compositionId: lower-third
        sourcePath: projections/mg/lower-third/index.html
        renderedAssetPath: assets/overlays/lower-third.webm
        spec:
          id: lower-third
          width: 1080
          height: 1920
          fps: 30
          durationInFrames: 30
          layers: []
      - id: caption-main
        type: text
        from: start
        durationInFrames: 60
        textNodeId: script-001
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const previousRevision = createTimelineAppliedRevision({
    projectId: "project-1",
    nodeId: "editor-1",
    cwd,
    filePath,
    dsl: parsed.dsl,
    createdAt: "2026-07-06T00:00:00.000Z",
    loroFrontiers: [{ peer: "1", counter: 3 }],
  });
  const revision = createTimelineAppliedRevision({
    projectId: "project-1",
    nodeId: "editor-1",
    cwd,
    filePath,
    dsl: parsed.dsl,
    parentRevisionId: previousRevision.revisionId,
    createdAt: "2026-07-06T00:01:00.000Z",
    loroFrontiers: [{ peer: "1", counter: 4 }],
  });

  assert.equal(revision.schemaVersion, 1);
  assert.equal(revision.kind, "clash.timeline.revision");
  assert.equal(revision.timelineId, "timeline:project-1:editor-1");
  assert.equal(revision.parentRevisionId, previousRevision.revisionId);
  assert.equal(revision.timelineHash, timelineHash(parsed.dsl));
  assert.equal(revision.sourceFilePath, "timelines/main.timeline.yaml");
  assert.equal(revision.sourceFileHash, revision.timelineHash);
  assert.deepEqual(revision.loroFrontiers, [{ peer: "1", counter: 4 }]);
  assert.deepEqual(revision.dependencies, {
    sourceNodeIds: ["scene-001"],
    assetIds: [],
    componentIds: ["lower-third"],
    textNodeIds: ["script-001"],
  });

  const lock = createTimelineLock({
    projectId: "project-1",
    nodeId: "editor-1",
    filePath,
    dsl: parsed.dsl,
    pulledAt: "2026-07-06T00:01:00.000Z",
    appliedRevision: revision,
  });
  const parsedLock = parseTimelineLock(JSON.stringify(lock));
  assert.deepEqual(parsedLock.appliedRevision, revision);

  const provenance = createTimelineSourceProvenance({
    cwd,
    filePath,
    dsl: parsed.dsl,
    appliedRevision: revision,
  });
  assert.deepEqual(provenance, {
    sourceTimelineId: "timeline:project-1:editor-1",
    sourceTimelinePath: "timelines/main.timeline.yaml",
    sourceTimelineHash: revision.timelineHash,
    sourceTimelineRevisionId: revision.revisionId,
    sourceTimelineRevisionStatus: "applied",
    sourceTimelineFrontiers: [{ peer: "1", counter: 4 }],
  });
});

test("timeline applied revisions preserve optional actor attribution", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-timeline-actor-"));
  const filePath = join(cwd, "timelines", "main.timeline.yaml");
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: main
    items:
      - id: scene-001-video
        type: video
        from: start
        durationInFrames: 30
        sourceNodeId: scene-001
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const revision = createTimelineAppliedRevision({
    projectId: "project-1",
    nodeId: "editor-1",
    cwd,
    filePath,
    dsl: parsed.dsl,
    createdAt: "2026-07-06T00:00:00.000Z",
    actor: {
      actorType: "agent",
      actorUserId: "user-1",
      actorAgentId: "agent-1",
    },
  });

  assert.deepEqual(revision.actor, {
    actorType: "agent",
    actorUserId: "user-1",
    actorAgentId: "agent-1",
  });

  const lock = createTimelineLock({
    projectId: "project-1",
    nodeId: "editor-1",
    filePath,
    dsl: parsed.dsl,
    appliedRevision: revision,
  });
  assert.deepEqual(parseTimelineLock(JSON.stringify(lock)).appliedRevision?.actor, revision.actor);
});

test("registers timeline revisions through the host index API when available", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-timeline-index-"));
  const filePath = join(cwd, "timelines", "main.timeline.yaml");
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: main
    items:
      - id: scene-001-video
        type: video
        from: start
        durationInFrames: 30
        sourceNodeId: scene-001
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const revision = createTimelineAppliedRevision({
    projectId: "project-1",
    nodeId: "editor-1",
    cwd,
    filePath,
    dsl: parsed.dsl,
    createdAt: "2026-07-07T00:00:00.000Z",
  });
  const calls: Array<{ path: string; contentType: string | null; body: unknown }> = [];

  const content = timelineDslToYaml(parsed.dsl);

  const result = await registerTimelineRevisionIndex(revision, content, async (path, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      path,
      contentType: headers.get("content-type"),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify({ revision }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.deepEqual(result, { indexed: true });
  assert.deepEqual(calls, [{
    path: "/api/v1/timeline-revisions",
    contentType: "application/json",
    body: { revision, content },
  }]);
});

test("keeps timeline apply compatible when the host timeline revision index is unavailable", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-timeline-index-missing-"));
  const filePath = join(cwd, "timelines", "main.timeline.yaml");
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: main
    items: []
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const revision = createTimelineAppliedRevision({
    projectId: "project-1",
    nodeId: "editor-1",
    cwd,
    filePath,
    dsl: parsed.dsl,
    createdAt: "2026-07-07T00:00:00.000Z",
  });

  const result = await registerTimelineRevisionIndex(revision, timelineDslToYaml(parsed.dsl), async () =>
    new Response("missing", { status: 404 }),
  );

  assert.deepEqual(result, {
    indexed: false,
    status: 404,
    error: "timeline revision index API unavailable",
  });
});

test("fetches timeline revision history through the host API", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-timeline-history-"));
  const filePath = join(cwd, "timelines", "main.timeline.yaml");
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: main
    items: []
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const revision = createTimelineAppliedRevision({
    projectId: "project-1",
    nodeId: "editor-1",
    cwd,
    filePath,
    dsl: parsed.dsl,
    createdAt: "2026-07-07T00:00:00.000Z",
  });
  const revisionWithContent = {
    ...revision,
    content: {
      kind: "timeline-revision-content",
      timelineHash: revision.timelineHash,
      mediaType: "application/yaml",
      url: `/api/v1/projects/project-1/timeline-revisions/${revision.revisionId}/content`,
      immutable: true,
    },
  };
  const calls: Array<{ path: string; method: string | undefined }> = [];

  const result = await fetchTimelineRevisionHistory("project-1", { nodeId: "editor-1", limit: 2 }, async (path, init) => {
    calls.push({ path, method: init?.method });
    return new Response(JSON.stringify({ revisions: [revisionWithContent] }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.deepEqual(result, { revisions: [revisionWithContent] });
  assert.deepEqual(calls, [{
    path: "/api/v1/projects/project-1/timeline-revisions?nodeId=editor-1&limit=2",
    method: "GET",
  }]);
});

test("fetches timeline revision content through the host API", async () => {
  const module = await import("./timeline");
  assert.equal(typeof module.fetchTimelineRevisionContent, "function");
  const calls: Array<{ path: string; method: string | undefined }> = [];

  const result = await module.fetchTimelineRevisionContent("project-1", "tlrev-1", async (path, init) => {
    calls.push({ path, method: init?.method });
    return new Response("tracks: []\n", { status: 200, headers: { "content-type": "application/yaml" } });
  });

  assert.equal(result, "tracks: []\n");
  assert.deepEqual(calls, [{
    path: "/api/v1/projects/project-1/timeline-revisions/tlrev-1/content",
    method: "GET",
  }]);
});

test("uses the shared timeline hash semantics for CAS locks", async () => {
  const dsl = {
    tracks: [{ id: "main", items: [{ id: "shot-a", type: "video", from: 30, durationInFrames: 60 }] }],
    fps: 30,
  };
  const sameTimelineWithAuthoringMemo = {
    tracks: [
      {
        id: "main",
        items: [{ id: "shot-a", type: "video", from: 30, durationInFrames: 60, fromExpr: "prev+0" }],
      },
    ],
    fps: 30,
  };

  assert.equal(timelineHash(dsl), await timelineDslHash(dsl));
  assert.equal(timelineHash(sameTimelineWithAuthoringMemo), await timelineDslHash(dsl));
});

test("rejects timeline apply when materialized downstream renders depend on it", () => {
  const result = assertTimelineNotMaterializedReferenced({
    nodeId: "editor-1",
    nodes: [
      { id: "editor-1", type: "video-editor", data: { timelineDsl: { tracks: [] } } },
      { id: "render-1", type: "video", data: { status: "completed", assetId: "render-asset" } },
    ],
    edges: [{ source: "editor-1", target: "render-1" }],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /materialized downstream/);
    assert.match(result.error, /render-1/);
  }
});

test("allows timeline apply through draft downstream placeholders or explicit force", () => {
  assert.deepEqual(
    assertTimelineNotMaterializedReferenced({
      nodeId: "editor-1",
      nodes: [
        { id: "editor-1", type: "video-editor", data: { timelineDsl: { tracks: [] } } },
        { id: "draft-render", type: "video", data: { status: "draft" } },
      ],
      edges: [{ source: "editor-1", target: "draft-render" }],
    }),
    { ok: true },
  );

  assert.deepEqual(
    assertTimelineNotMaterializedReferenced({
      nodeId: "editor-1",
      nodes: [
        { id: "editor-1", type: "video-editor", data: { timelineDsl: { tracks: [] } } },
        { id: "render-1", type: "video", data: { status: "completed", assetId: "render-asset" } },
      ],
      edges: [{ source: "editor-1", target: "render-1" }],
      force: true,
    }),
    { ok: true },
  );
});

test("rejects timeline apply when the canvas timeline changed after pull", async () => {
  const pulled = parseTimelineFileForApply(`
tracks:
  - id: main
    items:
      - id: scene-001-video
        type: video
        from: start
        durationInFrames: 30
`);
  const current = parseTimelineFileForApply(`
tracks:
  - id: main
    items:
      - id: scene-001-video
        type: video
        from: start
        durationInFrames: 45
`);
  assert.equal(pulled.ok, true);
  assert.equal(current.ok, true);
  if (!pulled.ok || !current.ok) return;
  const lock = await createTimelineLock({
    projectId: "project-1",
    nodeId: "editor-1",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    dsl: pulled.dsl,
    pulledAt: "2026-07-05T00:00:00.000Z",
  });

  const result = await assertTimelineCas({
    projectId: "project-1",
    nodeId: "editor-1",
    lock,
    currentDsl: current.dsl,
    force: false,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /stale timeline/i);
  assert.match(result.error, /clash timeline pull/i);
});

test("allows forced timeline apply even when the CAS lock is stale", async () => {
  const pulled = parseTimelineFileForApply("tracks: []\n");
  const current = parseTimelineFileForApply(`
tracks:
  - id: main
    items:
      - id: scene-001-video
        type: video
        from: 0
        durationInFrames: 45
`);
  assert.equal(pulled.ok, true);
  assert.equal(current.ok, true);
  if (!pulled.ok || !current.ok) return;
  const lock = await createTimelineLock({
    projectId: "project-1",
    nodeId: "editor-1",
    filePath: "/tmp/project/timelines/main.timeline.yaml",
    dsl: pulled.dsl,
    pulledAt: "2026-07-05T00:00:00.000Z",
  });

  const result = await assertTimelineCas({
    projectId: "project-1",
    nodeId: "editor-1",
    lock,
    currentDsl: current.dsl,
    force: true,
  });

  assert.deepEqual(result, { ok: true });
});
