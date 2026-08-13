import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TIMELINE_DSL_FIELD_ANNOTATIONS,
  TIMELINE_OPERATION_CATALOG,
  TIMELINE_OPERATION_REGISTRY,
  timelineDslToYaml,
} from "@clash/shared-types";
import {
  normalizeTimelineDslForYaml,
  parseTimelineFileForApply,
  resolveTimelineFilePath,
  timelineHash,
} from "../lib/timeline-projection";
import {
  TIMELINE_CLI_OPERATION_EXECUTORS,
  prepareTimelineApplyObservation,
  timelineCommand,
} from "./timeline";
import { canvasCommand } from "./canvas";

test("registers only the Project Timeline command surface", () => {
  const programSource = readFileSync(
    new URL("../program.ts", import.meta.url),
    "utf8",
  );
  const source = readFileSync(
    new URL("./timeline.ts", import.meta.url),
    "utf8",
  );

  assert.match(programSource, /program\.addCommand\(timelineCommand\)/);
  const annotatedCommands = Object.values(TIMELINE_OPERATION_CATALOG.agent)
    .flatMap((operation) => operation.surfaceBindings ?? [])
    .filter((binding) => binding.startsWith("cli:timeline "))
    .map((binding) => binding.slice("cli:timeline ".length));
  assert.deepEqual(
    timelineCommand.commands.map((command) => command.name()),
    annotatedCommands,
  );
  assert.doesNotMatch(
    source,
    /archivedTimelineNodeCommand|\.command\("(?:replace|history|content|restore)"\)/,
  );
  assert.doesNotMatch(source, /--if-match|--force|--lock/);
});

test("maps every annotated CLI Timeline operation to its real Commander executor", () => {
  const annotatedBindings = Object.entries(
    TIMELINE_OPERATION_REGISTRY.agent,
  ).flatMap(([operationId, operation]) =>
    (operation.surfaceBindings ?? [])
      .filter((binding) => binding.startsWith("cli:timeline "))
      .map((binding) => [operationId, binding] as const),
  );

  assert.deepEqual(
    Object.keys(TIMELINE_CLI_OPERATION_EXECUTORS).sort(),
    annotatedBindings.map(([operationId]) => operationId).sort(),
  );

  for (const [operationId, binding] of annotatedBindings) {
    const executor =
      TIMELINE_CLI_OPERATION_EXECUTORS[
        operationId as keyof typeof TIMELINE_CLI_OPERATION_EXECUTORS
      ];
    const commandName = binding.slice("cli:timeline ".length);
    const registeredCommand = timelineCommand.commands.find(
      (command) => command.name() === commandName,
    );

    assert.ok(executor, `${operationId} is missing its CLI executor`);
    assert.equal(executor.binding, binding);
    assert.equal(executor.command, registeredCommand);
    assert.equal(
      typeof (executor.command as unknown as { _actionHandler?: unknown })
        ._actionHandler,
      "function",
      `${operationId} does not have a Commander action handler`,
    );
  }
});

test("publishes the machine-readable Timeline DSL contract to agents", () => {
  const schema = timelineCommand.commands.find(
    (command) => command.name() === "schema",
  );

  assert.ok(schema);
  assert.match(schema.description(), /machine-readable/i);
  assert.equal(
    schema.options.some((option) => option.long === "--json"),
    true,
  );
});

test("exposes read-only Timeline DSL validation before apply", () => {
  const validate = timelineCommand.commands.find(
    (command) => command.name() === "validate",
  );

  assert.ok(validate);
  assert.match(validate.description(), /without applying/i);
  assert.equal(
    validate.options.some(
      (option) => option.long === "--file" && option.required,
    ),
    true,
  );
  assert.equal(
    validate.options.some((option) => option.long === "--json"),
    true,
  );
});

test("exposes a durable product render command with completion readback", () => {
  const render = timelineCommand.commands.find(
    (command) => command.name() === "render",
  );

  assert.ok(render);
  assert.match(render.description(), /Remotion|render/i);
  assert.equal(
    render.options.some(
      (option) => option.long === "--timeline" && option.required,
    ),
    true,
  );
  assert.equal(
    render.options.some((option) => option.long === "--no-wait"),
    true,
  );
  assert.equal(
    render.options.some((option) => option.long === "--timeout-ms"),
    true,
  );
  assert.equal(
    render.options.find((option) => option.long === "--timeout-ms")
      ?.defaultValue,
    "1800000",
  );
  assert.equal(
    render.options.some((option) => option.long === "--json"),
    true,
  );
});

test("public Timeline apply validation executes the published structural contract before normalization", () => {
  const invalidInputs = [
    {
      name: "unknown item type",
      yaml: `tracks:\n  - id: visual\n    items:\n      - id: mystery\n        type: mystery\n        from: 0\n        durationInFrames: 10\n`,
      error: /timeline\.dsl\.structure.*tracks\.0\.items\.0\.type/i,
    },
    {
      name: "zero item duration",
      yaml: `tracks:\n  - id: visual\n    items:\n      - id: zero\n        type: image\n        from: 0\n        durationInFrames: 0\n`,
      error: /timeline\.dsl\.structure.*tracks\.0\.items\.0\.durationInFrames/i,
    },
    {
      name: "missing track id",
      yaml: `tracks:\n  - items: []\n`,
      error: /timeline\.dsl\.structure.*tracks\.0\.id/i,
    },
  ] as const;

  for (const invalid of invalidInputs) {
    const parsed = parseTimelineFileForApply(invalid.yaml);
    assert.equal(parsed.ok, false, invalid.name);
    if (parsed.ok) continue;
    assert.match(parsed.error, invalid.error, invalid.name);
  }
});

test("public Timeline apply rejects every published cross-field integrity violation", () => {
  const invalidInputs = [
    {
      name: "duplicate item id",
      yaml: `tracks:\n  - id: visual\n    items:\n      - id: duplicate\n        type: image\n        sourceNodeId: image-1\n        from: 0\n        durationInFrames: 10\n      - id: duplicate\n        type: image\n        sourceNodeId: image-2\n        from: 10\n        durationInFrames: 10\n`,
      ruleId: "timeline.item.duplicate-id",
    },
    {
      name: "unknown track role",
      yaml: `tracks:\n  - id: visual\n    role: video\n    items: []\n`,
      ruleId: "timeline.dsl.structure",
    },
    {
      name: "primary lane audio",
      yaml: `tracks:\n  - id: primary\n    category: primary\n    items:\n      - id: audio\n        type: audio\n        sourceNodeId: audio-1\n        from: 0\n        durationInFrames: 10\n`,
      ruleId: "timeline.track.category-item",
    },
    {
      name: "missing media source",
      yaml: `tracks:\n  - id: visual\n    items:\n      - id: image\n        type: image\n        from: 0\n        durationInFrames: 10\n`,
      ruleId: "timeline.item.source-required",
    },
    {
      name: "fractional absolute frame",
      yaml: `tracks:\n  - id: visual\n    items:\n      - id: image\n        type: image\n        sourceNodeId: image-1\n        from: 0.5\n        durationInFrames: 10\n`,
      ruleId: "timeline.item.frame-integer",
    },
    {
      name: "malformed relative frame",
      yaml: `tracks:\n  - id: visual\n    items:\n      - id: image\n        type: image\n        sourceNodeId: image-1\n        from: prev + nope\n        durationInFrames: 10\n`,
      ruleId: "timeline.item.from-expression",
    },
    {
      name: "foreign type-specific field",
      yaml: `tracks:\n  - id: visual\n    items:\n      - id: image\n        type: image\n        sourceNodeId: image-1\n        from: 0\n        durationInFrames: 10\n        audioGainDb: 2\n`,
      ruleId: "timeline.item.field-applicability",
    },
    {
      name: "dangling transition reference",
      yaml: `tracks:\n  - id: effects\n    category: effect\n    items:\n      - id: dissolve\n        type: transition\n        transitionType: crossfade\n        fromItemId: missing-a\n        toItemId: missing-b\n        from: 5\n        durationInFrames: 4\n`,
      ruleId: "timeline.transition.reference",
    },
  ] as const;

  for (const invalid of invalidInputs) {
    const parsed = parseTimelineFileForApply(invalid.yaml);
    assert.equal(parsed.ok, false, invalid.name);
    if (parsed.ok) continue;
    assert.match(
      parsed.error,
      new RegExp(invalid.ruleId.replaceAll(".", "\\.")),
      invalid.name,
    );
  }
});

test("Timeline ownership mutations use concrete IDs and implicit cwd observations", () => {
  const source = readFileSync(
    new URL("./timeline.ts", import.meta.url),
    "utf8",
  );

  for (const action of [
    "list_timelines",
    "create_timeline",
    "attach_timeline",
    "detach_timeline",
    "copy_timeline_action",
  ]) {
    assert.match(source, new RegExp(`action: "${action}"`));
  }
  assert.match(source, /projectTimelineReadToken/);
  assert.match(source, /recordTimelineObservation/);
  assert.match(source, /requireTimelineObservation/);
  assert.match(source, /observedVersion/);
  assert.match(source, /sendProjectCommand/);
  assert.doesNotMatch(
    source,
    /LoroDoc|LoroSyncClient|WebSocket|connectToProject/,
  );
});

test("Timeline pull and apply target Timeline entities rather than Canvas nodes", () => {
  const source = readFileSync(
    new URL("./timeline.ts", import.meta.url),
    "utf8",
  );
  const pull = timelineCommand.commands.find(
    (command) => command.name() === "pull",
  );
  const apply = timelineCommand.commands.find(
    (command) => command.name() === "apply",
  );

  assert.ok(pull);
  assert.ok(apply);
  assert.equal(
    pull.options.some((option) => option.long === "--timeline"),
    true,
  );
  assert.equal(
    apply.options.some((option) => option.long === "--timeline"),
    true,
  );
  assert.equal(
    pull.options.some((option) => option.long === "--node"),
    false,
  );
  assert.equal(
    apply.options.some((option) => option.long === "--node"),
    false,
  );
  assert.match(source, /action: "update_timeline_state"/);
  assert.match(source, /writeTimelineTranscriptProjection/);
  assert.match(source, /transcriptFilePath/);
  assert.match(source, /transcriptWordCount/);
  assert.doesNotMatch(
    source,
    /timeline_cas_update|timeline_cow_replace|timelineRevisionIndex/,
  );
});

test("Timeline apply auto-pulls a stale latest projection without replaying the local edit", () => {
  const source = readFileSync(
    new URL("./timeline.ts", import.meta.url),
    "utf8",
  );
  const apply = timelineCommand.commands.find(
    (command) => command.name() === "apply",
  );

  assert.ok(apply);
  assert.equal(
    apply.options.some((option) => option.long === "--base-revision"),
    true,
  );
  assert.match(source, /recoverStaleProjection/);
  assert.match(source, /result\.code === "STALE_READ"/);
  assert.match(
    source,
    /timelineDslToYaml\(normalizeTimelineDslForYaml\(latest\.state\)\)/,
  );
  assert.match(source, /staleProjectionRecoveryError\("Timeline"/);
  assert.doesNotMatch(source, /retry.*update_timeline_state/is);
});

test("a stale base performs only host reads and materializes merge inputs", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "clash-timeline-stale-apply-"),
  );
  const editedProjectionPath = join(
    workspaceRoot,
    "timelines",
    "rough-cut.timeline.yaml",
  );
  mkdirSync(join(workspaceRoot, "timelines"), { recursive: true });
  writeFileSync(editedProjectionPath, "tracks:\n  - id: local-edit\n", "utf8");
  const actions: string[] = [];
  const latest = {
    id: "rough-cut",
    name: "Rough Cut",
    revisionId: "revision-2",
    owner: { kind: "project" as const },
    state: { tracks: [{ id: "host-edit", items: [] }] },
  };
  const transport = {
    isRunning: () => true,
    send: async (_projectId: string, command: { action?: string }) => {
      actions.push(String(command.action));
      return {
        timelines: [latest],
        versions: { "rough-cut": "timeline-v1:latest:receipt:signed" },
      };
    },
  };

  await assert.rejects(
    prepareTimelineApplyObservation({
      context: { projectId: "project-1", source: "marker", workspaceRoot },
      timelineId: "rough-cut",
      editedProjectionPath,
      baseRevisionId: "revision-1",
      transport,
    }),
    /STALE_READ.*revision-2.*merge.*did not apply or resubmit/i,
  );

  assert.deepEqual(actions, ["list_timelines", "list_timelines"]);
  assert.equal(
    readFileSync(editedProjectionPath, "utf8"),
    "tracks:\n  - id: local-edit\n",
  );
  assert.match(
    readFileSync(
      join(
        workspaceRoot,
        ".clash/recovery/timeline/rough-cut.latest.timeline.yaml",
      ),
      "utf8",
    ),
    /host-edit/,
  );
});

test("Timeline host commands preserve spawned-agent identity", () => {
  const source = readFileSync(
    new URL("./timeline.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /resolveCanvasPresenceOptions/);
  assert.match(
    source,
    /actorClientType: resolveCanvasPresenceOptions\(\)\.clientType/,
  );
});

test("does not retain a hidden node-owned canvas timeline command", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.equal(
    canvasCommand.commands.some((command) => command.name() === "timeline"),
    false,
  );
  assert.doesNotMatch(
    source,
    /archivedCanvasTimelineCommand|canvas timeline pull|canvas timeline push/,
  );
});

test("resolves Timeline projection paths under cwd using the Timeline identity", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-timeline-path-"));

  assert.equal(
    resolveTimelineFilePath({ cwd, timeline: "episode-1" }),
    join(cwd, "timelines", "episode-1.timeline.yaml"),
  );
  assert.equal(
    resolveTimelineFilePath({ cwd, timeline: "../escape" }),
    join(cwd, "timelines", "..-escape.timeline.yaml"),
  );
  assert.throws(
    () =>
      resolveTimelineFilePath({
        cwd,
        file: join(tmpdir(), "outside.timeline.yaml"),
      }),
    /must stay inside the current project cwd/,
  );
});

test("rejects a Timeline projection path that escapes through a symlink", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-timeline-link-"));
  const outside = await mkdtemp(join(tmpdir(), "clash-timeline-outside-"));
  mkdirSync(join(cwd, "timelines"), { recursive: true });
  symlinkSync(outside, join(cwd, "timelines", "linked"));

  assert.throws(
    () =>
      resolveTimelineFilePath({
        cwd,
        file: "timelines/linked/episode.timeline.yaml",
      }),
    /must not traverse a symlink outside the current project cwd/,
  );
});

test("normalizes and parses agent-edited Timeline YAML deterministically", () => {
  const normalized = normalizeTimelineDslForYaml({
    compositionWidth: 1080,
    compositionHeight: 1920,
    fps: 30,
    durationInFrames: 60,
    tracks: [
      {
        id: "main",
        role: "primary-video",
        items: [
          {
            id: "shot-1",
            type: "video",
            from: 0,
            durationInFrames: 60,
            assetId: "asset-1",
            sourceNodeId: "source-1",
          },
        ],
      },
    ],
  });
  const yaml = timelineDslToYaml(normalized);
  const parsed = parseTimelineFileForApply(yaml);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.sources, ["source-1"]);
  assert.equal(parsed.dsl.tracks[0]?.items[0]?.from, 0);
  assert.equal(timelineHash(parsed.dsl), timelineHash(normalized));
});

test("Timeline apply rejects Host media URLs without a Project Asset identity", () => {
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: visuals
    items:
      - id: shot-1
        type: video
        src: https://host-a.invalid/signed/shot.mp4?token=secret
        from: 0
        durationInFrames: 30
compositionWidth: 1920
compositionHeight: 1080
fps: 30
durationInFrames: 30
`);

  assert.deepEqual(parsed, {
    ok: false,
    error:
      "Timeline item shot-1 must reference a Project Asset before it can be applied; import the media first and set assetId",
  });
});

test("Timeline apply removes runtime media URLs when Project Asset identity is present", () => {
  const parsed = parseTimelineFileForApply(`
tracks:
  - id: visuals
    items:
      - id: shot-1
        type: video
        assetId: asset-video
        src: https://host-a.invalid/signed/shot.mp4?token=secret
        from: 0
        durationInFrames: 30
compositionWidth: 1920
compositionHeight: 1080
fps: 30
durationInFrames: 30
`);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.dsl.tracks[0]?.items[0]?.assetId, "asset-video");
  assert.equal("src" in (parsed.dsl.tracks[0]?.items[0] ?? {}), false);
});

test("Timeline pull/apply normalization preserves supported fields and removes the legacy media index", () => {
  const supportedState = {
    compositionWidth: 1080,
    compositionHeight: 1920,
    fps: 30,
    durationInFrames: 90,
    primaryTrackId: null,
    assetTranscripts: {
      speech: {
        schemaVersion: 1,
        kind: "clash.editor.asset-transcript",
        assetId: "speech",
        text: "hello",
        durationMs: 1000,
        words: [],
      },
    },
    "x-project-extension": { keep: true },
    tracks: [
      {
        id: "voice",
        name: "Voice",
        role: "narration",
        category: "audio",
        hidden: false,
        locked: false,
        "x-track-extension": { keep: true },
        items: [],
      },
    ],
  };
  const state = supportedState;

  const normalized = normalizeTimelineDslForYaml(state);
  const applied = parseTimelineFileForApply(timelineDslToYaml(normalized));

  // Pull can still project a legacy document without losing information, but
  // Apply writes only the Action-binding-backed Timeline shape.
  assert.deepEqual(normalized, state);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.deepEqual(applied.dsl, supportedState);
});

test("Timeline pull/apply normalization automatically preserves future annotated root and track fields", () => {
  type RootFieldAnnotation =
    (typeof TIMELINE_DSL_FIELD_ANNOTATIONS.root)[keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.root];
  type TrackFieldAnnotation =
    (typeof TIMELINE_DSL_FIELD_ANNOTATIONS.track)[keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.track];
  const rootFields = TIMELINE_DSL_FIELD_ANNOTATIONS.root as unknown as Record<
    string,
    RootFieldAnnotation
  >;
  const trackFields = TIMELINE_DSL_FIELD_ANNOTATIONS.track as unknown as Record<
    string,
    TrackFieldAnnotation
  >;
  rootFields.futureRootField = {
    ...TIMELINE_DSL_FIELD_ANNOTATIONS.root.primaryTrackId,
    description:
      "Future root field injected by the registry sync contract test.",
  };
  trackFields.futureTrackField = {
    ...TIMELINE_DSL_FIELD_ANNOTATIONS.track.name,
    description:
      "Future track field injected by the registry sync contract test.",
  };

  try {
    const state = {
      compositionWidth: 1080,
      compositionHeight: 1920,
      fps: 30,
      durationInFrames: 90,
      futureRootField: "root-value",
      tracks: [
        {
          id: "visual",
          futureTrackField: "track-value",
          items: [],
        },
      ],
    };

    const normalized = normalizeTimelineDslForYaml(state);
    const applied = parseTimelineFileForApply(timelineDslToYaml(normalized));

    assert.equal(
      (normalized as unknown as Record<string, unknown>).futureRootField,
      "root-value",
    );
    assert.equal(
      (normalized.tracks[0] as unknown as Record<string, unknown>)
        .futureTrackField,
      "track-value",
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    const pulledAgain = normalizeTimelineDslForYaml(applied.dsl);
    assert.equal(
      (applied.dsl as unknown as Record<string, unknown>).futureRootField,
      "root-value",
    );
    assert.equal(
      (applied.dsl.tracks[0] as unknown as Record<string, unknown>)
        .futureTrackField,
      "track-value",
    );
    assert.equal(
      (pulledAgain as unknown as Record<string, unknown>).futureRootField,
      "root-value",
    );
    assert.equal(
      (pulledAgain.tracks[0] as unknown as Record<string, unknown>)
        .futureTrackField,
      "track-value",
    );
    assert.equal(timelineHash(pulledAgain), timelineHash(normalized));
  } finally {
    delete rootFields.futureRootField;
    delete trackFields.futureTrackField;
  }
});

test("Timeline pull/apply projection preserves item-local transform keyframes", () => {
  const normalized = normalizeTimelineDslForYaml({
    tracks: [
      {
        id: "overlays",
        category: "visual",
        items: [
          {
            id: "logo",
            type: "image",
            assetId: "asset-logo",
            sourceNodeId: "source-logo",
            from: 30,
            durationInFrames: 61,
            properties: {
              x: 0,
              y: 0,
              width: 0.5,
              height: 0.5,
              rotation: 0,
              opacity: 1,
            },
            keyframes: {
              position: [
                { frame: 0, value: [0, 0], interpolation: "linear" },
                { frame: 60, value: [300, 120], interpolation: "hold" },
              ],
              scale: [
                { frame: 0, value: [1, 1], interpolation: "linear" },
                { frame: 60, value: [1.5, 1.5], interpolation: "linear" },
              ],
              rotation: [
                { frame: 0, value: 0, interpolation: "linear" },
                { frame: 60, value: 15, interpolation: "linear" },
              ],
              opacity: [
                { frame: 0, value: 0, interpolation: "linear" },
                { frame: 15, value: 1, interpolation: "linear" },
              ],
            },
          },
        ],
      },
    ],
    durationInFrames: 120,
  });

  const yaml = timelineDslToYaml(normalized);
  const applied = parseTimelineFileForApply(yaml);

  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.deepEqual(
    applied.dsl.tracks[0]?.items[0]?.keyframes,
    normalized.tracks[0]?.items[0]?.keyframes,
  );
  assert.equal(timelineHash(applied.dsl), timelineHash(normalized));
});

test("Timeline pull/apply projection preserves clip masks and mask keyframes", () => {
  const normalized = normalizeTimelineDslForYaml({
    primaryTrackId: "main",
    tracks: [
      {
        id: "main",
        category: "primary",
        items: [
          {
            id: "masked-shot",
            type: "video",
            from: 0,
            durationInFrames: 60,
            assetId: "asset-1",
            sourceNodeId: "source-1",
            mask: {
              shape: "ellipse",
              position: [50, 50],
              size: [70, 70],
              rotation: 0,
              feather: 8,
              inverted: false,
            },
            keyframes: {
              maskPosition: [
                { frame: 0, value: [30, 50], interpolation: "linear" },
                { frame: 59, value: [70, 50], interpolation: "hold" },
              ],
              maskSize: [
                { frame: 0, value: [70, 70], interpolation: "linear" },
              ],
              maskRotation: [{ frame: 30, value: 20, interpolation: "linear" }],
              maskFeather: [{ frame: 59, value: 30, interpolation: "linear" }],
            },
          },
        ],
      },
    ],
    durationInFrames: 60,
  });

  const applied = parseTimelineFileForApply(timelineDslToYaml(normalized));

  assert.equal(normalized.primaryTrackId, "main");
  assert.equal(normalized.tracks[0]?.category, "primary");
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.deepEqual(
    applied.dsl.tracks[0]?.items[0]?.mask,
    normalized.tracks[0]?.items[0]?.mask,
  );
  assert.deepEqual(
    applied.dsl.tracks[0]?.items[0]?.keyframes,
    normalized.tracks[0]?.items[0]?.keyframes,
  );
  assert.equal(applied.dsl.primaryTrackId, "main");
  assert.equal(applied.dsl.tracks[0]?.category, "primary");
});

test("Timeline hashes treat omitted composition defaults as explicit defaults", () => {
  const minimal = {
    tracks: [],
    fps: 30,
    durationInFrames: 60,
  };
  const explicitDefaults = {
    ...minimal,
    compositionWidth: 1920,
    compositionHeight: 1080,
  };

  assert.equal(timelineHash(minimal), timelineHash(explicitDefaults));
});

test("Timeline command source contains no lock or revision-content sidecar API", () => {
  const source = readFileSync(
    new URL("./timeline.ts", import.meta.url),
    "utf8",
  );

  for (const forbidden of [
    "TimelineLock",
    "resolveTimelineLockPath",
    "registerTimelineRevisionIndex",
    "fetchTimelineRevisionContent",
    "restoreTimelineRevisionContent",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
});
