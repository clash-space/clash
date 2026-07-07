import test from "node:test";
import assert from "node:assert/strict";
import { auditCommand } from "./audit";

test("audit mutations command exposes filtered local mutation evidence", () => {
  const mutations = auditCommand.commands.find((command) => command.name() === "mutations");
  assert.ok(mutations, "mutations command not found");

  assert.ok(mutations.options.some((option) => option.long === "--operation"));
  assert.ok(mutations.options.some((option) => option.long === "--entity"));
  assert.ok(mutations.options.some((option) => option.long === "--limit"));
  assert.ok(mutations.options.some((option) => option.long === "--json"));
});
