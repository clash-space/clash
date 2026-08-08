import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const emptyState = {
  schemaVersion: 1 as const,
  scene: {
    backgroundColor: "#171816",
    grid: { visible: true, snap: false, size: 1 },
  },
  objects: [],
  cameras: [],
  shots: [],
};

test("registers an agent-first Director Stage command surface", async () => {
  const module = await import("./director").catch(() => ({})) as Record<string, unknown>;
  assert.equal(typeof module.directorCommand, "object");
  const command = module.directorCommand as {
    commands: Array<{
      name(): string;
      commands: Array<{
        name(): string;
        options?: Array<{ long?: string; argChoices?: string[] }>;
      }>;
    }>;
  };
  assert.deepEqual(command.commands.map((candidate) => candidate.name()), [
    "list",
    "create",
    "attach",
    "detach",
    "capture",
    "pull",
    "apply",
    "object",
    "camera",
    "scene",
    "keyframe",
    "action",
  ]);
  assert.deepEqual(
    command.commands.find((candidate) => candidate.name() === "object")?.commands.map(
      (candidate) => candidate.name(),
    ),
    ["add", "update", "remove", "group", "ungroup", "attach", "detach", "add-horse", "add-rider-horse"],
  );
  assert.deepEqual(
    command.commands.find((candidate) => candidate.name() === "camera")?.commands.map(
      (candidate) => candidate.name(),
    ),
    ["add", "update", "remove"],
  );
  assert.deepEqual(
    command.commands.find((candidate) => candidate.name() === "scene")?.commands.map(
      (candidate) => candidate.name(),
    ),
    ["update"],
  );
  assert.deepEqual(
    command.commands.find((candidate) => candidate.name() === "keyframe")?.commands.map(
      (candidate) => candidate.name(),
    ),
    ["upsert", "remove"],
  );
  assert.deepEqual(
    command.commands.find((candidate) => candidate.name() === "action")?.commands.map(
      (candidate) => candidate.name(),
    ),
    ["upsert", "remove"],
  );
  const actionUpsert = command.commands
    .find((candidate) => candidate.name() === "action")
    ?.commands.find((candidate) => candidate.name() === "upsert");
  assert.equal(
    actionUpsert?.options?.find((option) => option.long === "--action")?.argChoices?.includes("ride"),
    true,
  );
  assert.equal(
    actionUpsert?.options?.find((option) => option.long === "--action")?.argChoices?.includes("interact"),
    true,
  );

  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  assert.match(indexSource, /program\.addCommand\(directorCommand\)/);
});

test("Director Stage mutations use the shared command reducer and implicit read proof", async () => {
  const sourceUrl = new URL("./director.ts", import.meta.url);
  assert.equal(existsSync(fileURLToPath(sourceUrl)), true, "director.ts must exist");
  const source = readFileSync(sourceUrl, "utf8");

  assert.match(source, /applyDirectorStageCommand/);
  assert.match(source, /projectDirectorStageReadToken/);
  assert.match(source, /recordDirectorStageObservation/);
  assert.match(source, /requireDirectorStageObservation/);
  assert.match(source, /action: "list_director_stages"/);
  assert.match(source, /action: "create_director_stage"/);
  assert.match(source, /action: "update_director_stage_state"/);
  assert.match(source, /action: "attach_director_stage"/);
  assert.match(source, /action: "detach_director_stage"/);
  assert.match(source, /--body-shape/);
  assert.match(source, /bodyShape/);
  for (const kind of ["prop", "set", "vehicle", "light"]) {
    assert.match(source, new RegExp(`"${kind}"`));
  }
  for (const option of ["--prop-type", "--set-type", "--vehicle-type", "--light-type", "--intensity", "--range", "--angle"]) {
    assert.match(source, new RegExp(option));
  }
  assert.doesNotMatch(source, /--if-match|--force|--lock/);
});

test("Director apply auto-pulls a stale latest projection without replaying the local edit", async () => {
  const module = await import("./director") as unknown as { directorCommand: {
    commands: readonly { name(): string; options: readonly { long?: string }[] }[];
  } };
  const source = readFileSync(new URL("./director.ts", import.meta.url), "utf8");
  const apply = module.directorCommand.commands.find((command) => command.name() === "apply");

  assert.ok(apply);
  assert.equal(apply.options.some((option) => option.long === "--base-revision"), true);
  assert.match(source, /recoverStaleProjection/);
  assert.match(source, /result\.code === "STALE_READ"/);
  assert.match(source, /directorStageCanonicalJson\(latest\.state\)/);
  assert.match(source, /staleProjectionRecoveryError\("Director Stage"/);
  assert.doesNotMatch(source, /retry.*update_director_stage_state/is);
});

test("resolves and validates Director Stage JSON projections inside cwd", async () => {
  const projection = await import("../lib/director-stage-projection").catch(() => ({})) as Record<string, unknown>;
  assert.equal(typeof projection.resolveDirectorStageFilePath, "function");
  assert.equal(typeof projection.parseDirectorStageFileForApply, "function");
  assert.equal(typeof projection.directorStageCanonicalJson, "function");

  const cwd = await mkdtemp(join(tmpdir(), "clash-director-stage-path-"));
  const resolvePath = projection.resolveDirectorStageFilePath as (input: {
    cwd: string;
    stage?: string;
    file?: string;
  }) => string;
  assert.equal(
    resolvePath({ cwd, stage: "courtyard" }),
    join(cwd, "director-stages", "courtyard.director-stage.json"),
  );
  assert.throws(
    () => resolvePath({ cwd, file: join(tmpdir(), "outside.director-stage.json") }),
    /must stay inside the current project cwd/,
  );

  const canonical = (projection.directorStageCanonicalJson as (state: unknown) => string)(emptyState);
  const parsed = (projection.parseDirectorStageFileForApply as (raw: string) => {
    ok: boolean;
    state?: unknown;
  })(canonical);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state, emptyState);
});
