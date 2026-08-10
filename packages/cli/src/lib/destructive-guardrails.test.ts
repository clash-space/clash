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

test("project purge command exposes confirmation and deleted-project CAS", () => {
  const projectsSource = commandSource("projects.ts");
  const projectPurgeSource = commandBlock(projectsSource, "purge");

  assert.match(projectsSource, /\.command\("purge"\)/);
  assert.match(projectPurgeSource, /\/api\/v1\/projects\/\$\{encodeURIComponent\(projectId\)\}\/purge/);
  assert.match(projectPurgeSource, /\.option\("--yes"/);
  assert.doesNotMatch(projectPurgeSource, /\.option\("--if-match/);
  assert.doesNotMatch(projectPurgeSource, /\.option\("--force"/);
  assert.match(projectPurgeSource, /requireDestructiveConfirmation\([\s\S]+project recovery point \$\{projectId\}/);
  assert.match(projectPurgeSource, /confirm: "purge"/);
  assert.match(projectPurgeSource, /projectWriteHeaders\(\{/);
  assert.match(projectPurgeSource, /observedVersion/);
  assert.doesNotMatch(projectPurgeSource, /force: options\.force === true/);
});

test("project restore command exposes the local recovery endpoint", () => {
  const projectsSource = commandSource("projects.ts");
  const projectGetSource = commandBlock(projectsSource, "get", "delete");
  const projectRestoreSource = commandBlock(projectsSource, "restore", "purge");

  assert.match(projectsSource, /\.command\("restore"\)/);
  assert.match(projectGetSource, /\.option\("--include-deleted"/);
  assert.match(projectGetSource, /includeDeleted=true/);
  assert.match(projectRestoreSource, /\/api\/v1\/projects\/\$\{encodeURIComponent\(projectId\)\}\/restore/);
  assert.doesNotMatch(projectRestoreSource, /\.option\("--if-match/);
  assert.doesNotMatch(projectRestoreSource, /\.option\("--force"/);
  assert.match(projectRestoreSource, /projectWriteHeaders\(\{/);
  assert.match(projectRestoreSource, /observedVersion/);
  assert.doesNotMatch(projectRestoreSource, /force: options\.force === true/);
});

test("project get and delete use implicit cwd observation CAS for agent writes", () => {
  const projectsSource = commandSource("projects.ts");
  const projectGetSource = commandBlock(projectsSource, "get", "delete");
  const projectDeleteSource = commandBlock(projectsSource, "delete", "restore");

  assert.match(projectGetSource, /recordAgentObservation/);
  assert.doesNotMatch(projectGetSource, /Read token:/);
  assert.doesNotMatch(projectDeleteSource, /\.option\("--if-match/);
  assert.doesNotMatch(projectDeleteSource, /\.option\("--force"/);
  assert.match(projectDeleteSource, /projectWriteHeaders\(\{/);
  assert.match(projectsSource, /CLASH_AGENT_MEMBER_ID/);
  assert.match(projectsSource, /"x-clash-client-type"\] = "agent"/);
  assert.match(projectsSource, /observed\.includes\(":receipt:"\)/);
  assert.match(projectsSource, /"x-clash-if-match" : "x-clash-observed-version"/);
});

test("project destructive commands surface cloud recovery policy hints", () => {
  const projectsSource = commandSource("projects.ts");
  const projectDeleteSource = commandBlock(projectsSource, "delete", "restore");
  const projectRestoreSource = commandBlock(projectsSource, "restore", "purge");
  const projectPurgeSource = commandBlock(projectsSource, "purge");

  assert.match(projectsSource, /recoveryPolicy/);
  assert.match(projectsSource, /cloud conflict review/);
  assert.match(projectDeleteSource, /projectRecoveryPolicyHint/);
  assert.match(projectRestoreSource, /projectRecoveryPolicyHint/);
  assert.match(projectPurgeSource, /projectRecoveryPolicyHint/);
});

test("agent-first mutation commands expose no force bypass", () => {
  for (const file of ["actions.ts", "assets.ts", "canvas.ts", "models.ts", "asset-metadata.ts", "projects.ts", "text.ts", "timeline.ts"]) {
    assert.doesNotMatch(commandSource(file), /\.option\("--force"/, `${file} exposes --force`);
  }
});
