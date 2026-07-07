import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { requireDestructiveConfirmation } from "./destructive-guardrails";

const commandsDir = fileURLToPath(new URL("../commands/", import.meta.url));

function commandSource(file: string): string {
  return readFileSync(join(commandsDir, file), "utf8");
}

function commandBlock(source: string, command: string, nextCommand?: string): string {
  const start = source.indexOf(`.command("${command}")`);
  assert.notEqual(start, -1, `${command} command not found`);
  const end = nextCommand ? source.indexOf(`.command("${nextCommand}")`, start + 1) : -1;
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

test("requires explicit confirmation for destructive deletes", () => {
  assert.deepEqual(
    requireDestructiveConfirmation({}, "canvas node abc123"),
    {
      ok: false,
      error: "Refusing to delete canvas node abc123 without --yes.",
    },
  );
  assert.deepEqual(
    requireDestructiveConfirmation({ yes: true }, "canvas node abc123"),
    { ok: true },
  );
});

test("canvas and project delete commands expose --yes confirmation", () => {
  const canvasSource = commandSource("canvas.ts");
  const projectsSource = commandSource("projects.ts");
  const projectDeleteSource = commandBlock(projectsSource, "delete", "restore");

  assert.match(canvasSource, /\.command\("delete"\)[\s\S]+\.option\("--yes"/);
  assert.match(canvasSource, /requireDestructiveConfirmation\([\s\S]+canvas node/);
  assert.match(projectDeleteSource, /\.option\("--yes"/);
  assert.match(projectDeleteSource, /\.option\("--json"/);
  assert.match(projectDeleteSource, /requireDestructiveConfirmation\([\s\S]+project \$\{options\.id\}/);
  assert.match(projectDeleteSource, /recoverable/);
});

test("project restore command exposes the local recovery endpoint", () => {
  const projectsSource = commandSource("projects.ts");
  const projectGetSource = commandBlock(projectsSource, "get", "delete");
  const projectRestoreSource = commandBlock(projectsSource, "restore");

  assert.match(projectsSource, /\.command\("restore"\)/);
  assert.match(projectGetSource, /\.option\("--include-deleted"/);
  assert.match(projectGetSource, /includeDeleted=true/);
  assert.match(projectRestoreSource, /\/api\/v1\/projects\/\$\{encodeURIComponent\(projectId\)\}\/restore/);
  assert.match(projectRestoreSource, /\.option\("--if-match <readToken>"/);
  assert.match(projectRestoreSource, /\.option\("--force"/);
  assert.match(projectRestoreSource, /projectWriteHeaders\(\{/);
  assert.match(projectRestoreSource, /ifMatch: options\.ifMatch/);
  assert.match(projectRestoreSource, /force: options\.force === true/);
});

test("project get and delete expose read-token CAS for agent writes", () => {
  const projectsSource = commandSource("projects.ts");
  const projectGetSource = commandBlock(projectsSource, "get", "delete");
  const projectDeleteSource = commandBlock(projectsSource, "delete", "restore");

  assert.match(projectGetSource, /readToken/);
  assert.match(projectGetSource, /Read token:/);
  assert.match(projectDeleteSource, /\.option\("--if-match <readToken>"/);
  assert.match(projectDeleteSource, /\.option\("--force"/);
  assert.match(projectDeleteSource, /projectWriteHeaders\(\{/);
  assert.match(projectsSource, /CLASH_AGENT_MEMBER_ID/);
  assert.match(projectsSource, /"x-clash-client-type"\] = "agent"/);
  assert.match(projectsSource, /"x-clash-if-match"\] = options\.ifMatch\.trim\(\)/);
});

test("canvas delete exposes explicit --force for downstream references", () => {
  const canvasSource = commandSource("canvas.ts");

  assert.match(canvasSource, /\.command\("delete"\)[\s\S]+\.option\("--force"/);
});
