import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCliProgram } from "../program";

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(entryPath);
    return entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
      ? [entryPath]
      : [];
  });
}

test("the public CLI does not expose hosted raw task polling", () => {
  const program = createCliProgram();

  assert.equal(
    program.commands.some((command) => command.name() === "tasks"),
    false,
  );
  assert.doesNotMatch(program.helpInformation(), /^\s+tasks\b/m);
});

test("the production CLI has no raw hosted task-result dialect", () => {
  assert.equal(
    existsSync(new URL("./tasks.ts", import.meta.url)),
    false,
    "commands/tasks.ts must stay retired instead of becoming an unregistered bypass",
  );

  const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const offenders = productionTypeScriptFiles(sourceRoot).filter((filePath) =>
    /\b(?:result_url|srcR2Key)\b/.test(readFileSync(filePath, "utf8")),
  );
  assert.deepEqual(
    offenders,
    [],
    "CLI production code must resolve Project Assets instead of exposing hosted storage outputs",
  );
});
