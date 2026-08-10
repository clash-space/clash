import test from "node:test";
import assert from "node:assert/strict";

async function serverModule(): Promise<Record<string, any>> {
  return import("./server.js").catch(() => ({}));
}

test("registers Timeline headless tools while the GUI is quarantined", async () => {
  const module = await serverModule();
  assert.equal(typeof module.registerTimelinePluginMcp, "function");
  const tools = new Map<
    string,
    { config: any; callback: (input: any) => Promise<any> }
  >();
  const resources = new Map<
    string,
    { uri: string; callback: () => Promise<any> }
  >();
  const fakeServer = {
    registerTool(
      name: string,
      config: any,
      callback: (input: any) => Promise<any>,
    ) {
      tools.set(name, { config, callback });
      return {};
    },
    registerResource(
      name: string,
      uri: string,
      _config: any,
      callback: () => Promise<any>,
    ) {
      resources.set(name, { uri, callback });
      return {};
    },
  };
  const timelines = [
    { id: "rough-cut", name: "Rough Cut", state: { tracks: [] } },
  ];
  const adapter = {
    schema: async () => ({ schemaVersion: 1, features: { clipMask: {} } }),
    validate: async () => ({ ok: true }),
    list: async () => timelines,
    get: async () => timelines[0],
    create: async () => timelines[0],
    save: async () => ({ applied: true, revisionId: "revision-2" }),
    attach: async () => timelines[0],
    detach: async () => timelines[0],
    copy: async () => timelines[0],
    render: async () => ({
      submitted: true,
      completed: true,
      timelineId: "rough-cut",
      sourceTimelineRevisionId: "revision-1",
      renderNodeId: "render-1",
      target: { kind: "project-assets" },
      status: "completed",
    }),
  };

  module.registerTimelinePluginMcp(
    fakeServer,
    adapter,
    "window.__TIMELINE_APP__ = true;",
  );

  assert.deepEqual(
    [...tools.keys()],
    [
      "clash_timeline_schema",
      "clash_timeline_validate",
      "clash_timeline_list",
      "clash_timeline_get",
      "clash_timeline_create",
      "clash_timeline_save",
      "clash_timeline_attach",
      "clash_timeline_detach",
      "clash_timeline_copy",
      "clash_timeline_render",
    ],
  );
  assert.equal(resources.size, 0);
  assert.deepEqual(tools.get("clash_timeline_list")?.config.annotations, {
    readOnlyHint: true,
  });
  assert.deepEqual(tools.get("clash_timeline_schema")?.config.annotations, {
    readOnlyHint: true,
  });
  assert.deepEqual(tools.get("clash_timeline_validate")?.config.annotations, {
    readOnlyHint: true,
  });
  const saveInputSchema = tools
    .get("clash_timeline_save")
    ?.config.inputSchema["~standard"].jsonSchema.input({
      target: "draft-2020-12",
    });
  assert.ok(saveInputSchema.properties.baseRevisionId);
  assert.equal(saveInputSchema.properties.state.type, "object");
  assert.match(
    saveInputSchema.properties.state.description,
    /clash_timeline_schema/i,
  );
  assert.equal(saveInputSchema.definitions, undefined);
  const validateInputSchema = tools
    .get("clash_timeline_validate")
    ?.config.inputSchema["~standard"].jsonSchema.input({
      target: "draft-2020-12",
    });
  assert.ok(
    validateInputSchema.properties.document.anyOf.some(
      (variant: any) =>
        variant.type === "object" &&
        /clash_timeline_schema/i.test(variant.description),
    ),
  );
  assert.equal(validateInputSchema.definitions, undefined);
  const getOutputSchema = tools
    .get("clash_timeline_get")
    ?.config.outputSchema["~standard"].jsonSchema.output({
      target: "draft-2020-12",
    });
  assert.equal(
    getOutputSchema.properties.timeline.properties.state.type,
    "object",
  );
  assert.match(
    getOutputSchema.properties.timeline.properties.state.description,
    /clash_timeline_schema/i,
  );
  assert.equal(getOutputSchema.definitions, undefined);
  assert.equal(
    tools.get("clash_timeline_save")?.config._meta["clash/timelineOperation"]
      .id,
    "timeline.save",
  );
  assert.equal(
    tools.get("clash_timeline_validate")?.config._meta[
      "clash/timelineOperation"
    ].id,
    "timeline.validate",
  );
  assert.match(
    tools.get("clash_timeline_save")?.config.description,
    /complete typed Timeline state/i,
  );
  for (const [name, tool] of tools) {
    assert.match(
      tool.config.description,
      /^Use when: .+ Effect: .+ Returns: .+ Next: .+$/u,
      name,
    );
  }
  assert.match(
    tools.get("clash_timeline_get")?.config.description,
    /stale or read-required/i,
  );
  assert.match(
    tools.get("clash_timeline_save")?.config.description,
    /replaces the entire Timeline state/i,
  );
  assert.match(
    tools.get("clash_timeline_save")?.config.description,
    /automatically pulled latest projection.*merge.*resubmit/i,
  );
  assert.equal(tools.has("clash_canvas_open"), false);
  for (const name of [
    "clash_timeline_list",
    "clash_timeline_schema",
    "clash_timeline_validate",
    "clash_timeline_get",
    "clash_timeline_save",
    "clash_timeline_attach",
  ]) {
    assert.equal(
      tools.get(name)?.config._meta.ui.resourceUri,
      undefined,
      `${name} must not instantiate the Timeline App`,
    );
    assert.equal(tools.get(name)?.config._meta["ui/resourceUri"], undefined);
  }

  const read = await tools.get("clash_timeline_get")!.callback({
    cwd: "/workspace",
    timelineId: "rough-cut",
  });
  assert.equal(read.structuredContent.timeline.id, "rough-cut");
  assert.equal(read.structuredContent.contract.schemaVersion, 6);
  assert.equal(read.structuredContent.validation.ok, true);
});

test("returns complete Timeline validation issues with stable shared rule ids", async () => {
  const module = await serverModule();
  const tools = new Map<string, { callback: (input: any) => Promise<any> }>();
  const fakeServer = {
    registerTool(
      name: string,
      _config: any,
      callback: (input: any) => Promise<any>,
    ) {
      tools.set(name, { callback });
      return {};
    },
    registerResource() {
      return {};
    },
  };
  let adapterCalls = 0;
  const adapter = {
    schema: async () => ({}),
    validate: async () => {
      adapterCalls += 1;
      return { ok: true };
    },
    list: async () => [],
    get: async () => ({
      id: "rough-cut",
      name: "Rough Cut",
      state: { tracks: [] },
    }),
    create: async () => ({}),
    save: async () => {
      adapterCalls += 1;
      return {};
    },
    attach: async () => ({}),
    detach: async () => ({}),
    copy: async () => ({}),
  };
  module.registerTimelinePluginMcp(fakeServer, adapter, "");

  const result = await tools.get("clash_timeline_validate")!.callback({
    document: {
      tracks: [
        {
          id: "visual",
          items: [
            {
              id: "missing-source",
              type: "image",
              from: 0,
              durationInFrames: 10,
            },
          ],
        },
      ],
    },
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "TIMELINE_DSL_INVALID");
  assert.equal(
    result.structuredContent.error.retryTool,
    "clash_timeline_schema",
  );
  assert.ok(
    result.structuredContent.error.issues.some(
      (issue: any) => issue.ruleId === "timeline.item.source-required",
    ),
  );
  assert.equal(adapterCalls, 0);
});

test("rejects pixel-sized item scale before create or save mutates Timeline state", async () => {
  const module = await serverModule();
  const tools = new Map<string, { callback: (input: any) => Promise<any> }>();
  const fakeServer = {
    registerTool(
      name: string,
      _config: any,
      callback: (input: any) => Promise<any>,
    ) {
      tools.set(name, { callback });
      return {};
    },
    registerResource() {
      return {};
    },
  };
  let createCalls = 0;
  let saveCalls = 0;
  const adapter = {
    schema: async () => ({}),
    validate: async () => ({ ok: true }),
    list: async () => [],
    get: async () => ({
      id: "pixel-scale",
      name: "Pixel scale",
      state: { tracks: [] },
    }),
    create: async () => {
      createCalls += 1;
      return {};
    },
    save: async () => {
      saveCalls += 1;
      return {};
    },
    attach: async () => ({}),
    detach: async () => ({}),
    copy: async () => ({}),
  };
  module.registerTimelinePluginMcp(fakeServer, adapter, "");

  const state = {
    tracks: [
      {
        id: "visual",
        items: [
          {
            id: "character",
            type: "image",
            from: 0,
            durationInFrames: 90,
            src: "assets/character.png",
            properties: { x: 0, y: 0, width: 720, height: 1280 },
          },
        ],
      },
    ],
  };
  const results = await Promise.all([
    tools.get("clash_timeline_create")!.callback({
      cwd: "/workspace",
      id: "pixel-scale",
      name: "Pixel scale",
      state,
    }),
    tools.get("clash_timeline_save")!.callback({
      cwd: "/workspace",
      timelineId: "pixel-scale",
      baseRevisionId: "revision-1",
      state,
    }),
  ]);

  for (const result of results) {
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, "TIMELINE_DSL_INVALID");
    assert.equal(
      result.structuredContent.error.retryTool,
      "clash_timeline_schema",
    );
    assert.ok(
      result.structuredContent.error.issues.some(
        (issue: any) =>
          issue.ruleId === "timeline.item.scale-unit" &&
          issue.path.join(".") === "tracks.0.items.0.properties.width",
      ),
    );
  }
  assert.equal(createCalls, 0);
  assert.equal(saveCalls, 0);
});

test("returns stale and validation failures as structured Agent-recoverable errors", async () => {
  const module = await serverModule();
  const tools = new Map<string, { callback: (input: any) => Promise<any> }>();
  const fakeServer = {
    registerTool(
      name: string,
      _config: any,
      callback: (input: any) => Promise<any>,
    ) {
      tools.set(name, { callback });
      return {};
    },
    registerResource() {
      return {};
    },
  };
  const adapter = {
    schema: async () => ({}),
    validate: async () => ({ ok: true }),
    list: async () => [],
    get: async () => ({ id: "rough-cut", name: "Rough Cut", state: {} }),
    create: async () => ({}),
    save: async () => {
      throw new Error("STALE_TIMELINE: Timeline rough-cut changed");
    },
    attach: async () => ({}),
    detach: async () => ({}),
    copy: async () => ({}),
  };

  module.registerTimelinePluginMcp(fakeServer, adapter, "");
  const result = await tools.get("clash_timeline_save")!.callback({
    timelineId: "rough-cut",
    baseRevisionId: "revision-1",
    state: { tracks: [] },
  });

  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "STALE_TIMELINE",
      message: "STALE_TIMELINE: Timeline rough-cut changed",
      retryTool: "clash_timeline_get",
    },
  });
});

test("preserves a stale code wrapped by execFile stderr", async () => {
  const module = await serverModule();

  assert.deepEqual(
    module.timelineToolErrorPayload(
      new Error(
        "Command failed: clash timeline apply --json\nError: STALE_READ: Timeline rough-cut changed after it was read",
      ),
    ),
    {
      code: "STALE_READ",
      message: "STALE_READ: Timeline rough-cut changed after it was read",
      retryTool: "clash_timeline_get",
    },
  );
});

test("exposes an automatic stale pull as structured merge recovery instead of asking MCP to read again", async () => {
  const module = await serverModule();
  const recovery = {
    schemaVersion: 1,
    code: "STALE_READ",
    entityKind: "timeline",
    entityId: "rough-cut",
    currentRevisionId: "revision-2",
    editedProjectionPath: "timelines/rough-cut.timeline.yaml",
    latestProjectionPath:
      ".clash/recovery/timeline/rough-cut.latest.timeline.yaml",
    recoveryReceiptPath: ".clash/recovery/timeline/rough-cut.recovery.json",
    next: "Merge the edited projection into the latest projection, then retry the apply command.",
    resubmitted: false,
  };

  assert.deepEqual(
    module.timelineToolErrorPayload(
      new Error(
        `Command failed\nError: STALE_READ: latest pulled. CLASH_RECOVERY=${JSON.stringify(recovery)}`,
      ),
    ),
    {
      code: "STALE_READ",
      message: "STALE_READ: latest pulled.",
      recovery,
    },
  );
});

test("removes execFile command, temporary paths, and stack frames from agent errors", async () => {
  const module = await serverModule();

  assert.deepEqual(
    module.timelineToolErrorPayload(
      new Error(
        [
          "Command failed: /usr/bin/node /private/tmp/clash-timeline-validate/runtime.cjs timeline validate",
          "Error: TIMELINE_DSL_INVALID: timeline.dsl.structure at tracks.0.id: Required",
          "    at Command.<anonymous> (/private/tmp/clash-timeline-validate/runtime.cjs:10:2)",
        ].join("\n"),
      ),
    ),
    {
      code: "TIMELINE_DSL_INVALID",
      message:
        "TIMELINE_DSL_INVALID: timeline.dsl.structure at tracks.0.id: Required",
      retryTool: "clash_timeline_schema",
    },
  );
});
