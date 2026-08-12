import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("delegates model-card parameter coercion to the local-api project host", () => {
  const cliSource = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");
  const hostSource = readFileSync(
    new URL("../../../../apps/local-api/src/project-command-host.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(cliSource, /MODEL_CARDS|coerceModelParameterInput|modelParamsFromEntries/);
  assert.match(cliSource, /action: "add",[\s\S]*params:/);
  assert.match(hostSource, /function hostModelParams/);
  assert.match(hostSource, /coerceModelParameterInput/);
});
