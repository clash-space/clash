import test from "node:test";
import assert from "node:assert/strict";

import { modelParamsFromEntries } from "./canvas";

test("coerces CLI model params with the selected Model Card candidate types", () => {
  // Durations are numeric seconds on every card, so a CLI string is coerced to a
  // number. `--param duration=10` must not become the string "10", because a
  // consumer comparing `value === 10` would miss it.
  assert.deepEqual(modelParamsFromEntries("kling-3", [
    ["duration", "10"],
    ["generate_audio", "false"],
  ]), {
    duration: 10,
    generate_audio: false,
  });
  assert.deepEqual(modelParamsFromEntries("veo-3.1-fast", [
    ["duration", "6"],
  ]), {
    duration: 6,
  });
  // The other direction still has to work: `safety_tolerance` genuinely declares
  // string candidates, so a numeric input is coerced to a string.
  assert.deepEqual(modelParamsFromEntries("flux-2-pro", [
    ["safety_tolerance", "3"],
  ]), {
    safety_tolerance: "3",
  });
});
