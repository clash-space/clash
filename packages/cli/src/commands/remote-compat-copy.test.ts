import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const commandsDir = fileURLToPath(new URL("./", import.meta.url));

function commandSource(file: string): string {
  return readFileSync(join(commandsDir, file), "utf8");
}

test("model provider help does not present vars as the local provider auth path", () => {
  const source = commandSource("models.ts");

  assert.match(source, /Configure a local provider account/);
  assert.doesNotMatch(source, /No model providers configured\.[^`]+`clash vars set <KEY>`/);
});

test("vars copy is scoped to remote worker action secrets", () => {
  const varsSource = commandSource("vars.ts");
  const actionsSource = commandSource("actions.ts");

  assert.match(varsSource, /Manage remote worker action variables/);
  assert.match(varsSource, /only for cloud\/remote worker actions/);
  assert.match(varsSource, /Local custom actions and local providers do not use `clash vars`/);
  assert.match(actionsSource, /Remote worker action secrets: clash vars set <KEY>/);
});
