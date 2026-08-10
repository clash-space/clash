import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * The attach -> edit -> apply loop as an agent actually drives it, through the
 * shipped binary. Outside a linked agent worktree there is no implicit cwd
 * observation, so the explicit CAS token is the only way to close the loop --
 * which makes it load-bearing, not a convenience.
 */

const cliEntry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const projection = "projections/metadata/asset-talk.media.description.json";

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CLASH_LOCAL_DATA_DIR: join(cwd, ".data") },
  });
}

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "clash-metadata-loop-"));
  await mkdir(join(cwd, "assets"), { recursive: true });
  await writeFile(
    join(cwd, "assets", "manifest.json"),
    JSON.stringify({ assets: [{ id: "asset-talk", type: "video", metadata: {} }] }),
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

function attach(cwd: string) {
  const set = runCli(cwd, [
    "assets", "metadata", "set",
    "--asset", "asset-talk",
    "--kind", "media.description",
    "--metadata", "description.json",
    "--json",
  ]);
  assert.equal(set.status, 0, set.stderr || set.stdout);
  return JSON.parse(set.stdout) as { version: string };
}

async function editProjection(cwd: string, text: string) {
  const doc = JSON.parse(await readFile(join(cwd, projection), "utf8"));
  const target = doc.metadata ?? doc;
  target.text = text;
  await writeFile(join(cwd, projection), JSON.stringify(doc, null, 2), "utf8");
}

test("the CAS token returned by attach can actually be spent on apply", async () => {
  const cwd = await workspace();
  const { version } = attach(cwd);
  assert.match(version, /^asset-metadata-v1:/);

  await editProjection(cwd, "A host waves, then sits down.");

  // Regression: this option used to be spelled --version, which Commander's
  // global version flag intercepted -- apply printed the CLI version and
  // exited 0 without writing anything.
  const apply = runCli(cwd, [
    "assets", "metadata", "apply", "--file", projection, "--expect-version", version, "--json",
  ]);
  assert.equal(apply.status, 0, apply.stderr || apply.stdout);
  assert.doesNotMatch(apply.stdout, /^\d+\.\d+\.\d+\s*$/, "apply must not answer with the CLI version");
  assert.equal(JSON.parse(apply.stdout).applied, true);

  const get = runCli(cwd, [
    "assets", "metadata", "get", "--asset", "asset-talk", "--kind", "media.description", "--json",
  ]);
  assert.equal(get.status, 0, get.stderr || get.stdout);
  assert.match(JSON.parse(get.stdout).text, /sits down/);
});

test("a spent CAS token is refused on replay", async () => {
  const cwd = await workspace();
  const { version } = attach(cwd);

  await editProjection(cwd, "First edit wins.");
  assert.equal(
    runCli(cwd, ["assets", "metadata", "apply", "--file", projection, "--expect-version", version, "--json"]).status,
    0,
  );

  await editProjection(cwd, "Second edit from a stale read.");
  const replay = runCli(cwd, [
    "assets", "metadata", "apply", "--file", projection, "--expect-version", version, "--json",
  ]);
  assert.notEqual(replay.status, 0, "replaying a spent token must be refused");
  assert.match(replay.stderr || replay.stdout, /stale|version/i);

  const get = runCli(cwd, [
    "assets", "metadata", "get", "--asset", "asset-talk", "--kind", "media.description", "--json",
  ]);
  assert.match(JSON.parse(get.stdout).text, /First edit wins/, "the refused write must not have landed");
});

test("applying without any CAS token is refused rather than silently forced", async () => {
  const cwd = await workspace();
  attach(cwd);
  await editProjection(cwd, "Unproven edit.");

  const apply = runCli(cwd, ["assets", "metadata", "apply", "--file", projection, "--json"]);
  assert.notEqual(apply.status, 0, "an unproven apply must not land");
  assert.match(apply.stderr || apply.stdout, /READ_REQUIRED/);
});
