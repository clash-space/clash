import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * The attach -> edit -> apply loop as an agent actually drives it, through the
 * shipped binary. CAS evidence stays in the linked worktree observation file;
 * no version token is part of the public command or result contract.
 */

const cliEntry = fileURLToPath(new URL("../index.ts", import.meta.url));
const cliTsconfig = fileURLToPath(
  new URL("../../tsconfig.dev.json", import.meta.url),
);
const tsxImport = createRequire(import.meta.url).resolve("tsx");
const projection = "projections/metadata/asset-talk.media.description.json";

function runCli(
  cwd: string,
  args: string[],
  options: { agent?: boolean } = {},
) {
  return spawnSync(
    process.execPath,
    ["--import", tsxImport, cliEntry, ...args],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        CLASH_LOCAL_DATA_DIR: join(cwd, ".data"),
        CLASH_AGENT_MEMBER_ID: options.agent === false ? "" : "agent-1",
        TSX_TSCONFIG_PATH: cliTsconfig,
      },
    },
  );
}

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "clash-metadata-loop-"));
  await mkdir(join(cwd, ".clash"), { recursive: true });
  await writeFile(
    join(cwd, ".clash", "project.toml"),
    'schema_version = 1\nproject_id = "project-1"\n',
    "utf8",
  );
  await mkdir(join(cwd, "assets"), { recursive: true });
  await writeFile(
    join(cwd, "assets", "manifest.json"),
    JSON.stringify({
      assets: [{ id: "asset-talk", type: "video", metadata: {} }],
    }),
    "utf8",
  );
  await writeFile(
    join(cwd, "description.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "media.description",
      text: "A host waves at the camera.",
      sourceHash: `sha256:${"a".repeat(64)}`,
    }),
    "utf8",
  );
  return cwd;
}

function attach(cwd: string, options: { agent?: boolean } = {}) {
  const set = runCli(
    cwd,
    [
      "assets",
      "metadata",
      "set",
      "--asset",
      "asset-talk",
      "--kind",
      "media.description",
      "--metadata",
      "description.json",
      "--json",
    ],
    options,
  );
  assert.equal(set.status, 0, set.stderr || set.stdout);
  return JSON.parse(set.stdout) as Record<string, unknown>;
}

async function editProjection(cwd: string, text: string) {
  const doc = JSON.parse(await readFile(join(cwd, projection), "utf8"));
  const target = doc.metadata ?? doc;
  target.text = text;
  await writeFile(join(cwd, projection), JSON.stringify(doc, null, 2), "utf8");
}

test("apply help exposes no public CAS-token or mutation-bypass option", async () => {
  const cwd = await workspace();
  const help = runCli(cwd, ["assets", "metadata", "apply", "--help"]);

  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.doesNotMatch(
    help.stdout,
    /--expect-version|--if-match|--read-token|--force/,
  );
});

test("an external CAS token cannot bypass a missing worktree observation", async () => {
  const cwd = await workspace();
  attach(cwd);
  const observations = JSON.parse(
    await readFile(join(cwd, ".clash", "observed.json"), "utf8"),
  ) as { versions: Record<string, unknown> };
  const version = observations.versions[`asset-metadata:${projection}`];
  if (typeof version !== "string") {
    assert.fail("attach must record its internal worktree observation");
  }

  await editProjection(cwd, "A host waves, then sits down.");
  await rm(join(cwd, ".clash", "observed.json"));

  const apply = runCli(cwd, [
    "assets",
    "metadata",
    "apply",
    "--file",
    projection,
    "--expect-version",
    version,
    "--json",
  ]);
  assert.notEqual(
    apply.status,
    0,
    "a caller-supplied token must not authorize apply",
  );
  assert.match(
    apply.stderr || apply.stdout,
    /unknown option.*--expect-version/i,
  );

  const get = runCli(cwd, [
    "assets",
    "metadata",
    "get",
    "--asset",
    "asset-talk",
    "--kind",
    "media.description",
    "--json",
  ]);
  assert.equal(get.status, 0, get.stderr || get.stdout);
  assert.match(JSON.parse(get.stdout).text, /waves at the camera/);
});

test("the implicit observation closes the attach-edit-apply loop without exposing a token", async () => {
  const cwd = await workspace();
  const attached = attach(cwd);
  assert.equal("version" in attached, false);

  await editProjection(cwd, "A host waves, then sits down.");
  const apply = runCli(cwd, [
    "assets",
    "metadata",
    "apply",
    "--file",
    projection,
    "--json",
  ]);
  assert.equal(apply.status, 0, apply.stderr || apply.stdout);
  const result = JSON.parse(apply.stdout) as Record<string, unknown>;
  assert.equal(result.applied, true);
  assert.equal("version" in result, false);

  const get = runCli(cwd, [
    "assets",
    "metadata",
    "get",
    "--asset",
    "asset-talk",
    "--kind",
    "media.description",
    "--json",
  ]);
  assert.equal(get.status, 0, get.stderr || get.stdout);
  assert.match(JSON.parse(get.stdout).text, /sits down/);
});

test("a linked CLI uses the same implicit observation without an agent-tag permission gate", async () => {
  const cwd = await workspace();
  const attached = attach(cwd, { agent: false });
  assert.equal("version" in attached, false);

  await editProjection(cwd, "A human and an agent share one CAS loop.");
  const apply = runCli(
    cwd,
    ["assets", "metadata", "apply", "--file", projection, "--json"],
    { agent: false },
  );
  assert.equal(apply.status, 0, apply.stderr || apply.stdout);
  assert.equal(JSON.parse(apply.stdout).applied, true);

  const observations = JSON.parse(
    await readFile(join(cwd, ".clash", "observed.json"), "utf8"),
  ) as { versions: Record<string, unknown> };
  assert.equal(
    typeof observations.versions[`asset-metadata:${projection}`],
    "string",
  );
});

test("a stale worktree observation is refused with a re-read instruction", async () => {
  const cwd = await workspace();
  attach(cwd);

  const manifestPath = join(cwd, "assets", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.assets[0].metadata["media.description"].text =
    "Changed by another writer.";
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await editProjection(cwd, "A stale edit must not win.");

  const apply = runCli(cwd, [
    "assets",
    "metadata",
    "apply",
    "--file",
    projection,
    "--json",
  ]);
  assert.notEqual(
    apply.status,
    0,
    "a stale observation must not authorize apply",
  );
  assert.match(
    apply.stderr || apply.stdout,
    /STALE_READ:.*Read the current metadata again/s,
  );

  const get = runCli(cwd, [
    "assets",
    "metadata",
    "get",
    "--asset",
    "asset-talk",
    "--kind",
    "media.description",
    "--json",
  ]);
  assert.match(
    JSON.parse(get.stdout).text,
    /another writer/,
    "the refused write must not have landed",
  );
});

test("applying without an observation is refused rather than silently forced", async () => {
  const cwd = await workspace();
  attach(cwd);
  await editProjection(cwd, "Unproven edit.");
  await rm(join(cwd, ".clash", "observed.json"));

  const apply = runCli(cwd, [
    "assets",
    "metadata",
    "apply",
    "--file",
    projection,
    "--json",
  ]);
  assert.notEqual(apply.status, 0, "an unproven apply must not land");
  assert.match(
    apply.stderr || apply.stdout,
    /READ_REQUIRED:.*Read asset-metadata/s,
  );
});
