import test from "node:test";
import assert from "node:assert/strict";
import { effectCommand } from "./effects";

test("effect CLI exposes the complete agent authoring lifecycle", () => {
  assert.equal(effectCommand.name(), "effect");
  assert.deepEqual(
    effectCommand.commands.map((command) => command.name()),
    ["create", "validate", "pack", "install"],
  );

  const validate = effectCommand.commands.find((command) => command.name() === "validate");
  assert.ok(validate);
  assert.ok(validate.options.some((option) => option.long === "--json"));
});
