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

test("remote worker action secret copy does not point to local vars CLI", () => {
  const actionsSource = commandSource("actions.ts");

  assert.match(actionsSource, /Remote worker action secrets are managed in hosted\/remote Settings/);
  assert.doesNotMatch(actionsSource, /clash vars/);
});
