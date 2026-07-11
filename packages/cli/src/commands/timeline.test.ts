import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import {
  mkdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { timelineDslToYaml } from "@clash/shared-types";
import {
  normalizeTimelineDslForYaml,
  parseTimelineFileForApply,
  resolveTimelineFilePath,
  timelineHash,
} from "../lib/timeline-projection";
import { timelineCommand } from "./timeline";
import { canvasCommand } from "./canvas";

test("registers only the Project Timeline command surface", () => {
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const source = readFileSync(new URL("./timeline.ts", import.meta.url), "utf8");

  assert.match(indexSource, /program\.addCommand\(timelineCommand\)/);
  assert.deepEqual(timelineCommand.commands.map((command) => command.name()), [
    "list",
    "create",
    "attach",
    "detach",
    "copy",
    "pull",
    "apply",
  ]);
  assert.doesNotMatch(source, /archivedTimelineNodeCommand|\.command\("(?:replace|history|content|restore)"\)/);
  assert.doesNotMatch(source, /--if-match|--force|--lock/);
});

test("Timeline ownership mutations use concrete IDs and implicit cwd observations", () => {
  const source = readFileSync(new URL("./timeline.ts", import.meta.url), "utf8");

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
  assert.match(source, /assertAgentHostWritePath/);
});

test("Timeline pull and apply target Timeline entities rather than Canvas nodes", () => {
  const source = readFileSync(new URL("./timeline.ts", import.meta.url), "utf8");
  const pull = timelineCommand.commands.find((command) => command.name() === "pull");
  const apply = timelineCommand.commands.find((command) => command.name() === "apply");

  assert.ok(pull);
  assert.ok(apply);
  assert.equal(pull.options.some((option) => option.long === "--timeline"), true);
  assert.equal(apply.options.some((option) => option.long === "--timeline"), true);
  assert.equal(pull.options.some((option) => option.long === "--node"), false);
  assert.equal(apply.options.some((option) => option.long === "--node"), false);
  assert.match(source, /action: "update_timeline_state"/);
  assert.doesNotMatch(source, /timeline_cas_update|timeline_cow_replace|timelineRevisionIndex/);
});

test("Timeline fallback sync preserves spawned-agent presence", () => {
  const source = readFileSync(new URL("./timeline.ts", import.meta.url), "utf8");

  assert.match(source, /resolveCanvasPresenceOptions/);
  assert.match(source, /\.\.\.resolveCanvasPresenceOptions\(\)/);
});

test("does not retain a hidden node-owned canvas timeline command", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.equal(canvasCommand.commands.some((command) => command.name() === "timeline"), false);
  assert.doesNotMatch(source, /archivedCanvasTimelineCommand|canvas timeline pull|canvas timeline push/);
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
    () => resolveTimelineFilePath({
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
    () => resolveTimelineFilePath({
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
    tracks: [{
      id: "main",
      role: "video",
      items: [{
        id: "shot-1",
        type: "video",
        from: 0,
        durationInFrames: 60,
        sourceNodeId: "source-1",
      }],
    }],
  });
  const yaml = timelineDslToYaml(normalized);
  const parsed = parseTimelineFileForApply(yaml);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.sources, ["source-1"]);
  assert.equal(parsed.dsl.tracks[0]?.items[0]?.from, 0);
  assert.equal(timelineHash(parsed.dsl), timelineHash(normalized));
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
  const source = readFileSync(new URL("./timeline.ts", import.meta.url), "utf8");

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
