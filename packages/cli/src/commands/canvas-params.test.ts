import test from "node:test";
import assert from "node:assert/strict";

import { modelParamsFromEntries } from "./canvas";

test("coerces CLI model params with the selected Model Card candidate types", () => {
  assert.deepEqual(modelParamsFromEntries("kling-3", [
    ["duration", "10"],
    ["generate_audio", "false"],
  ]), {
    duration: "10",
    generate_audio: false,
  });
  assert.deepEqual(modelParamsFromEntries("veo-3.1-fast", [
    ["duration", "6"],
  ]), {
    duration: 6,
  });
});
